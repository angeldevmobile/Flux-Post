import { useState } from "react";
import { Sparkles, Copy, Check, Timer, Bug } from "lucide-react";
import { useRequestStore } from "@/stores/request";
import { useSettingsStore } from "@/stores/settings";
import { generateTests, debugAssist } from "@/lib/tauri";

const STATUS_COLOR = (s: number) =>
  s >= 200 && s < 300 ? "#22C55E" : s >= 300 && s < 400 ? "#F59E0B" : "#EF4444";

function formatBytes(n: number) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

function tryPrettyJson(raw: string) {
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

type RespTab = "Body" | "Headers" | "Cookies";

export function ResponsePanel() {
  const { response, error, isLoading, getRequest } = useRequestStore();
  const {
    claudeApiKey, claudeModel,
    autoGenerateTests, aiDebugAssist: debugAssistEnabled,
    trackUsage,
  } = useSettingsStore();

  const [tab, setTab] = useState<RespTab>("Body");
  const [copied, setCopied] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);

  const isError = response ? response.status >= 400 : false;

  async function handleGenerateTests() {
    if (!response || !autoGenerateTests) return;
    setAiLoading(true); setAiResult(null);
    try {
      const req = getRequest();
      const result = await generateTests(
        { method: req.method, url: req.url, body: req.body },
        { status: response.status, body: response.body },
        claudeApiKey,
        claudeModel,
      );
      setAiResult(result);
      trackUsage("tests");
    } catch (e) { setAiResult(`Error: ${e}`); }
    finally { setAiLoading(false); }
  }

  async function handleDebugAssist() {
    if (!response || !debugAssistEnabled) return;
    setAiLoading(true); setAiResult(null);
    try {
      const req = getRequest();
      const result = await debugAssist(
        { method: req.method, url: req.url, headers: req.headers, body: req.body },
        { status: response.status, body: response.body },
        claudeApiKey,
        claudeModel,
      );
      setAiResult(result);
      trackUsage("debugs");
    } catch (e) { setAiResult(`Error: ${e}`); }
    finally { setAiLoading(false); }
  }

  function handleCopy() {
    if (!response) return;
    navigator.clipboard.writeText(response.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const showAiPanel = autoGenerateTests || debugAssistEnabled;
  const TABS: RespTab[] = ["Body", "Headers", "Cookies"];

  return (
    <div className="flex flex-col shrink-0 h-full overflow-hidden" style={{ width: 420, background: "var(--color-bg)" }}>
      {/* Response header */}
      <div className="flex items-center gap-2 shrink-0 px-4" style={{ height: 52, borderBottom: "1px solid var(--color-border)" }}>
        <span className="flex-1 text-[12px] font-medium" style={{ color: "var(--color-fg-3)" }}>Response</span>

        {response && (
          <>
            <div className="flex items-center gap-1.5 px-2.5 rounded"
              style={{ height: 24, background: `${STATUS_COLOR(response.status)}18` }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: STATUS_COLOR(response.status) }} />
              <span className="font-semibold" style={{ fontSize: 11, fontFamily: "Geist Mono, monospace", color: STATUS_COLOR(response.status) }}>
                {response.status} {response.statusText}
              </span>
            </div>
            <div className="flex items-center gap-1 px-2.5 rounded"
              style={{ height: 24, background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
              <Timer size={11} style={{ color: "var(--color-fg-3)" }} />
              <span style={{ fontSize: 11, fontFamily: "Geist Mono, monospace", color: "var(--color-fg-2)" }}>{response.durationMs}ms</span>
            </div>
            <div className="flex items-center px-2.5 rounded"
              style={{ height: 24, background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
              <span style={{ fontSize: 11, fontFamily: "Geist Mono, monospace", color: "var(--color-fg-2)" }}>{formatBytes(response.size)}</span>
            </div>
            <button onClick={handleCopy} className="transition-colors ml-1" style={{ color: "var(--color-fg-3)" }} title="Copy">
              {copied ? <Check size={14} className="text-[#22C55E]" /> : <Copy size={14} />}
            </button>
          </>
        )}

        {isLoading && <span className="text-[12px] animate-pulse" style={{ color: "var(--color-fg-3)" }}>Sending...</span>}
        {!response && !isLoading && !error && (
          <span className="text-[12px]" style={{ color: "var(--color-fg-4)" }}>Send a request to see the response</span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center shrink-0 px-4" style={{ height: 36, borderBottom: "1px solid var(--color-border)" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="relative px-3 h-full text-[12px] transition-colors"
            style={{ color: tab === t ? "var(--color-fg)" : "var(--color-fg-3)" }}>
            {t}
            {tab === t && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: "var(--color-accent)" }} />}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="rounded-lg p-3 text-[12px]" style={{ background: "#EF444415", border: "1px solid #EF444430", color: "#EF4444" }}>
            {error}
          </div>
        )}
        {tab === "Body" && response && (
          <pre className="text-[12px] whitespace-pre-wrap break-all"
            style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg)", lineHeight: 1.6 }}>
            {tryPrettyJson(response.body)}
          </pre>
        )}
        {tab === "Headers" && response && (
          <div className="flex flex-col gap-1">
            {Object.entries(response.headers).map(([k, v]) => (
              <div key={k} className="flex gap-2 text-[12px]">
                <span className="shrink-0" style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>{k}:</span>
                <span className="break-all" style={{ color: "var(--color-fg-2)" }}>{v}</span>
              </div>
            ))}
          </div>
        )}
        {tab === "Cookies" && <p className="text-[12px]" style={{ color: "var(--color-fg-3)" }}>No cookies</p>}
      </div>

      {/* AI Panel — only shown if at least one AI feature is enabled */}
      {showAiPanel && (
        <div className="shrink-0 flex flex-col gap-2 p-3"
          style={{ background: isError ? "rgba(239,68,68,0.06)" : "var(--color-accent-10)", borderTop: "1px solid var(--color-border)" }}>
          <div className="flex items-center gap-1.5">
            {isError
              ? <Bug size={14} className="text-red" />
              : <Sparkles size={14} style={{ color: "var(--color-accent)" }} />}
            <span className="flex-1 text-[12px] font-semibold" style={{ color: "var(--color-fg)" }}>
              {isError ? "AI Debug Assist" : "AI Test Generator"}
            </span>
            <span className="text-[10px]" style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg-4)" }}>{claudeModel}</span>
          </div>
          <p className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>
            {isError
              ? "Claude will explain the error and suggest fixes"
              : "Generate assertions from this response automatically"}
          </p>
          {aiResult && (
            <pre className="text-[11px] rounded-lg p-2 overflow-x-auto whitespace-pre-wrap"
              style={{
                background: isError ? "#EF444415" : "var(--color-accent-10)",
                border: `1px solid ${isError ? "#EF444430" : "var(--color-accent-20)"}`,
                color: isError ? "#EF4444" : "var(--color-accent)",
                fontFamily: "Geist Mono, monospace",
              }}>
              {aiResult}
            </pre>
          )}
          <div className="flex gap-2">
            {isError && debugAssistEnabled && (
              <button
                onClick={handleDebugAssist}
                disabled={!response || aiLoading}
                className="flex items-center justify-center gap-1.5 flex-1 rounded-md font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ height: 32, fontSize: 12, background: "#EF4444" }}>
                <Bug size={13} />
                {aiLoading ? "Analyzing..." : "Debug with AI"}
              </button>
            )}
            {autoGenerateTests && (
              <button
                onClick={handleGenerateTests}
                disabled={!response || aiLoading}
                className="flex items-center justify-center gap-1.5 rounded-md font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ height: 32, fontSize: 12, background: "var(--color-accent)", flex: isError ? "0 0 auto" : 1, padding: "0 12px" }}>
                <Sparkles size={13} />
                {aiLoading ? "Generating..." : isError ? "Tests" : "Generate Tests"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
