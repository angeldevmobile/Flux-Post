import { useState } from "react";
import { Sparkles, Copy, Check, Timer, Bug, ImageIcon, Terminal, Trash2, Wrench, Loader2, Zap } from "lucide-react";
import { useRequestStore } from "@/stores/request";
import { useSettingsStore, useUsingOwnKey } from "@/stores/settings";
import { generateTests, debugAssist, fixAssertion, type AssertionFix } from "@/lib/tauri";
import { handleQuotaError } from "@/lib/aiError";
import { CodeEditor } from "@/components/CodeEditor";
import { useConsoleStore } from "@/stores/console";
import type { LogLevel } from "@/stores/console";
import { useTestResultsStore } from "@/stores/testResults";

const EXAMPLE_REQUESTS = [
  { method: "GET", url: "https://jsonplaceholder.typicode.com/posts/1" },
  { method: "GET", url: "https://api.github.com/users/octocat" },
  { method: "GET", url: "https://httpbin.org/get" },
] as const;

const STATUS_COLOR = (s: number) =>
  s >= 200 && s < 300 ? "#22C55E" : s >= 300 && s < 400 ? "#F59E0B" : "#EF4444";

function formatBytes(n: number) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

function formatBody(body: string, lang: string): string {
  if (lang === "json") {
    try { return JSON.stringify(JSON.parse(body), null, 2); } catch { /* keep raw */ }
  }
  return body;
}

type ResponseLang = "json" | "html" | "xml" | "plaintext";

function detectLang(headers: Record<string, string>): ResponseLang {
  const ct = (headers["content-type"] ?? headers["Content-Type"] ?? "").toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("html")) return "html";
  if (ct.includes("xml")) return "xml";
  return "plaintext";
}

type RespTab = "Body" | "Headers" | "Cookies" | "Tests" | "Console" | "Timeline";

const LOG_COLOR: Record<LogLevel, string> = {
  log: "var(--color-fg-2)",
  info: "#60A5FA",
  warn: "#F59E0B",
  error: "#EF4444",
};

function ConsolePanel() {
  const { entries, clear } = useConsoleStore();
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 shrink-0 px-3"
        style={{ height: 32, borderBottom: "1px solid var(--color-border)" }}>
        <Terminal size={12} style={{ color: "var(--color-fg-3)" }} />
        <span className="flex-1 text-[11px]" style={{ color: "var(--color-fg-3)" }}>
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
        <button onClick={clear} title="Clear console"
          className="flex items-center justify-center rounded transition-colors"
          style={{ width: 22, height: 22, color: "var(--color-fg-4)" }}
          onMouseEnter={e => (e.currentTarget.style.color = "#EF4444")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--color-fg-4)")}>
          <Trash2 size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 && (
          <p className="text-[11px] p-4" style={{ color: "var(--color-fg-4)" }}>
            No output yet. Use <code style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-accent)" }}>console.log()</code> in your scripts.
          </p>
        )}
        {entries.map(e => (
          <div key={e.id} className="flex items-start gap-2 px-3 py-1"
            style={{ borderBottom: "1px solid var(--color-border)" }}>
            <span className="text-[10px] shrink-0 mt-0.5 font-bold uppercase"
              style={{ color: LOG_COLOR[e.level], fontFamily: "Geist Mono, monospace", width: 32 }}>
              {e.level}
            </span>
            <span className="text-[11px] shrink-0" style={{ color: "var(--color-fg-4)", fontFamily: "Geist Mono, monospace" }}>
              [{e.source}]
            </span>
            <pre className="text-[11px] flex-1 whitespace-pre-wrap break-all"
              style={{ fontFamily: "Geist Mono, monospace", color: LOG_COLOR[e.level] }}>
              {e.message}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

interface DebugSuggestion {
  kind: "header" | "param" | "body";
  key: string;
  value: string;
  label: string;
}

interface DebugResult {
  what: string;
  cause: string;
  steps: string[];
  suggestions?: DebugSuggestion[];
}

export function ResponsePanel() {
  const { response, error, isLoading, getRequest, setMethod, setUrl,
          headers, setHeaders, params, setParams, setBody, setBodyType } = useRequestStore();
  const {
    claudeApiKey, claudeModel,
    autoGenerateTests, aiDebugAssist: debugAssistEnabled,
    trackUsage,
  } = useSettingsStore();
  const usingOwnKey = useUsingOwnKey();

  const { results: testResults } = useTestResultsStore();
  const [tab, setTab] = useState<RespTab>("Body");
  const [copied, setCopied] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [debugResult, setDebugResult] = useState<DebugResult | null>(null);
  const [debugRaw, setDebugRaw] = useState<string | null>(null);
  const [fixLoading, setFixLoading] = useState<Record<number, boolean>>({});
  const [fixes, setFixes] = useState<Record<number, AssertionFix>>({});
  const [appliedSuggestions, setAppliedSuggestions] = useState<Set<string>>(new Set());
  const [appliedFixes, setAppliedFixes] = useState<Set<number>>(new Set());

  const isError = response ? response.status >= 400 : false;
  const isBinary = response?.bodyEncoding === "base64";
  const isImage = isBinary && (response?.headers["content-type"] ?? "").toLowerCase().startsWith("image/");
  const lang = response ? detectLang(response.headers) : "plaintext";
  const formattedBody = response && !isBinary ? formatBody(response.body, lang) : "";

  // Monaco body: text response in the Body tab with no error
  const useMonaco = tab === "Body" && !!response && !isBinary && !error;

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
    } catch (e) { if (!handleQuotaError(e)) setAiResult(`Error: ${e}`); }
    finally { setAiLoading(false); }
  }

  async function handleFixAssertion(index: number, testName: string) {
    if (!response) return;
    setFixLoading(prev => ({ ...prev, [index]: true }));
    try {
      const req = getRequest();
      const fix = await fixAssertion(
        testName,
        response.status,
        response.body,
        req.method,
        req.url,
        req.body,
        claudeApiKey,
        claudeModel,
      );
      setFixes(prev => ({ ...prev, [index]: fix }));
    } catch (e) {
      if (!handleQuotaError(e)) {
        setFixes(prev => ({ ...prev, [index]: { kind: "assertion", value: "", explanation: String(e) } }));
      }
    } finally {
      setFixLoading(prev => ({ ...prev, [index]: false }));
    }
  }

  async function handleDebugAssist() {
    if (!response || !debugAssistEnabled) return;
    setAiLoading(true); setDebugResult(null); setDebugRaw(null);
    setAppliedSuggestions(new Set());
    try {
      const req = getRequest();
      const result = await debugAssist(
        { method: req.method, url: req.url, headers: req.headers, body: req.body },
        { status: response.status, body: response.body },
        claudeApiKey,
        claudeModel,
      );
      try {
        const parsed = JSON.parse(result) as DebugResult;
        setDebugResult(parsed);
      } catch {
        setDebugRaw(result);
      }
      trackUsage("debugs");
    } catch (e) { if (!handleQuotaError(e)) setDebugRaw(`Error: ${e}`); }
    finally { setAiLoading(false); }
  }

  function applyDebugSuggestion(s: DebugSuggestion, id: string) {
    if (s.kind === "header") {
      setHeaders([...headers, { id: crypto.randomUUID(), key: s.key, value: s.value, enabled: true }]);
    } else if (s.kind === "param") {
      setParams([...params, { id: crypto.randomUUID(), key: s.key, value: s.value, enabled: true }]);
    } else if (s.kind === "body") {
      setBody(s.value);
      if (s.value.trimStart().startsWith("{") || s.value.trimStart().startsWith("[")) setBodyType("json");
    }
    setAppliedSuggestions(prev => new Set([...prev, id]));
  }

  function applyFix(index: number, fix: AssertionFix) {
    if (fix.kind === "header") {
      const colonIdx = fix.value.indexOf(":");
      if (colonIdx > 0) {
        const key = fix.value.slice(0, colonIdx).trim();
        const val = fix.value.slice(colonIdx + 1).trim();
        setHeaders([...headers, { id: crypto.randomUUID(), key, value: val, enabled: true }]);
      }
    } else if (fix.kind === "body") {
      setBody(fix.value);
      if (fix.value.trimStart().startsWith("{") || fix.value.trimStart().startsWith("[")) setBodyType("json");
    }
    setAppliedFixes(prev => new Set([...prev, index]));
  }

  function handleCopy() {
    if (!response) return;
    if (isBinary) {
      navigator.clipboard.writeText(`[Binary — ${formatBytes(response.size)}]`);
    } else {
      navigator.clipboard.writeText(formattedBody || response.body);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const showAiPanel = autoGenerateTests || debugAssistEnabled;
  const TABS: RespTab[] = ["Body", "Headers", "Cookies", "Tests", "Console", "Timeline"];

  return (
    <div data-tour="response-panel" className="flex flex-col shrink-0 h-full overflow-hidden" style={{ width: 420, background: "var(--color-bg)" }}>

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
            <button onClick={handleCopy} className="transition-colors ml-1" style={{ color: "var(--color-fg-3)" }} title="Copy body">
              {copied ? <Check size={14} style={{ color: "#22C55E" }} /> : <Copy size={14} />}
            </button>
          </>
        )}

        {isLoading && <span className="text-[12px] animate-pulse" style={{ color: "var(--color-fg-3)" }}>Sending...</span>}
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
        {tab === "Body" && response && !isBinary && (
          <span className="ml-auto text-[10px] px-2" style={{ color: "var(--color-fg-4)", fontFamily: "Geist Mono, monospace" }}>
            {lang} · Ctrl+F to search
          </span>
        )}
      </div>

      {/* Body area — Monaco needs overflow-hidden, everything else overflow-y-auto */}
      {useMonaco ? (
        <div className="flex flex-col flex-1 overflow-hidden">
          <CodeEditor
            value={formattedBody}
            onChange={() => {}}
            lang={lang}
            readOnly
            noBorder
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {error && (
            <div className="rounded-lg p-3 text-[12px]" style={{ background: "#EF444415", border: "1px solid #EF444430", color: "#EF4444" }}>
              {error}
            </div>
          )}

          {/* Binary / image response */}
          {tab === "Body" && response && isBinary && (
            isImage ? (
              <div className="flex flex-col gap-3">
                <img
                  src={`data:${response.headers["content-type"] ?? response.headers["Content-Type"]};base64,${response.body}`}
                  alt="response image"
                  className="max-w-full rounded-lg"
                  style={{ border: "1px solid var(--color-border)" }}
                />
                <p className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>
                  {response.headers["content-type"]} · {formatBytes(response.size)}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-8">
                <ImageIcon size={32} style={{ color: "var(--color-fg-4)" }} />
                <p className="text-[12px] text-center" style={{ color: "var(--color-fg-3)" }}>
                  Binary response ({response.headers["content-type"] ?? "application/octet-stream"})
                </p>
                <p className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>{formatBytes(response.size)}</p>
              </div>
            )
          )}

          {/* Empty body tab */}
          {tab === "Body" && !response && !isLoading && !error && (
            <div className="flex flex-col items-center justify-center h-full gap-4 py-8">
              <div className="flex items-center justify-center rounded-full"
                style={{ width: 48, height: 48, background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
                <Zap size={22} style={{ color: "var(--color-accent)" }} />
              </div>
              <div className="flex flex-col items-center gap-1 text-center">
                <span className="text-[14px] font-semibold" style={{ color: "var(--color-fg-2)" }}>No response yet</span>
                <span className="text-[12px]" style={{ color: "var(--color-fg-4)" }}>Enter a URL and press Send — or try an example:</span>
              </div>
              <div className="flex flex-col gap-1.5 w-full max-w-70">
                {EXAMPLE_REQUESTS.map(ex => (
                  <button
                    key={ex.url}
                    onClick={() => { setMethod(ex.method); setUrl(ex.url); }}
                    className="flex items-center gap-2 px-3 rounded-lg text-left transition-colors w-full"
                    style={{ height: 34, background: "var(--color-card)", border: "1px solid var(--color-border)" }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--color-accent-50)")}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--color-border)")}>
                    <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{ background: "#22C55E18", color: "#22C55E", fontFamily: "Geist Mono, monospace" }}>
                      {ex.method}
                    </span>
                    <span className="truncate text-[11px]"
                      style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg-3)" }}>
                      {ex.url}
                    </span>
                  </button>
                ))}
              </div>
              <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>
                Press <kbd className="px-1.5 py-0.5 rounded text-[10px]"
                  style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-3)", fontFamily: "Geist Mono, monospace" }}>
                  Ctrl+Enter
                </kbd> to send
              </span>
            </div>
          )}

          {/* Headers tab */}
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

          {/* Cookies tab */}
          {tab === "Cookies" && (() => {
            const received = response?.setCookies ?? [];
            const sent = response?.sentCookies ?? [];

            function CookieRow({ raw, dim }: { raw: string; dim?: boolean }) {
              const parts = raw.split(";").map(s => s.trim());
              const [name, value] = (parts[0] ?? "").split("=");
              const attrs = parts.slice(1).join("  ·  ");
              return (
                <div className="rounded-lg px-3 py-2 flex flex-col gap-0.5"
                  style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", opacity: dim ? 0.7 : 1 }}>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold" style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>
                      {name}
                    </span>
                    <span className="text-[12px] break-all flex-1" style={{ color: "var(--color-fg-2)", fontFamily: "Geist Mono, monospace" }}>
                      = {value}
                    </span>
                  </div>
                  {attrs && (
                    <span className="text-[10px]" style={{ color: "var(--color-fg-4)", fontFamily: "Geist Mono, monospace" }}>
                      {attrs}
                    </span>
                  )}
                </div>
              );
            }

            if (received.length === 0 && sent.length === 0) {
              return (
                <p className="text-[12px]" style={{ color: "var(--color-fg-4)" }}>
                  No cookies sent or received. Enable the Cookie Jar in Settings to send stored cookies automatically.
                </p>
              );
            }

            return (
              <div className="flex flex-col gap-4">
                {sent.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-fg-3)" }}>
                      Sent with request ({sent.length})
                    </span>
                    {sent.map((raw, i) => <CookieRow key={i} raw={raw} dim />)}
                  </div>
                )}
                {received.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-fg-3)" }}>
                      Received in response ({received.length})
                    </span>
                    {received.map((raw, i) => <CookieRow key={i} raw={raw} />)}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Tests tab */}
          {tab === "Tests" && (
            <div className="flex flex-col gap-1.5 p-3">
              {testResults.length === 0 && (
                <p className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>
                  No test results yet. Add <code style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-accent)" }}>pm.test()</code> calls to your Post-req script.
                </p>
              )}
              {testResults.map((r, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 px-3 rounded"
                    style={{ height: 32, background: r.pass ? "#22C55E10" : "#EF444410", border: `1px solid ${r.pass ? "#22C55E30" : "#EF444430"}` }}>
                    <span style={{ fontSize: 12, color: r.pass ? "#22C55E" : "#EF4444" }}>{r.pass ? "✓" : "✗"}</span>
                    <span className="flex-1 text-[12px]" style={{ color: "var(--color-fg-2)" }}>{r.name}</span>
                    {r.error && <span className="text-[11px] truncate max-w-32" style={{ color: "#EF4444", fontFamily: "Geist Mono, monospace" }}>{r.error}</span>}
                    {!r.pass && claudeApiKey && response && (
                      <button
                        onClick={() => handleFixAssertion(i, r.name)}
                        disabled={fixLoading[i]}
                        className="shrink-0 flex items-center gap-1 px-1.5 rounded transition-opacity hover:opacity-80 disabled:opacity-40"
                        style={{ height: 20, background: "#A855F715", border: "1px solid #A855F730" }}
                        title="Fix with AI"
                      >
                        {fixLoading[i]
                          ? <Loader2 size={10} className="animate-spin" style={{ color: "var(--color-accent)" }} />
                          : <Wrench size={10} style={{ color: "var(--color-accent)" }} />}
                        <span className="text-[10px]" style={{ color: "var(--color-accent)" }}>
                          {fixLoading[i] ? "Fixing…" : "Fix"}
                        </span>
                      </button>
                    )}
                  </div>
                  {fixes[i] && (
                    <div className="rounded px-3 py-2 flex flex-col gap-1.5"
                      style={{ background: "#A855F710", border: "1px solid #A855F730" }}>
                      <div className="flex items-center gap-1.5">
                        <Sparkles size={10} style={{ color: "var(--color-accent)" }} />
                        <span className="text-[10px] font-semibold uppercase" style={{ color: "var(--color-accent)", letterSpacing: "0.05em" }}>
                          {fixes[i].kind === "assertion" ? "Fix assertion" : fixes[i].kind === "body" ? "Fix request body" : "Fix header"}
                        </span>
                      </div>
                      <code className="text-[11px] break-all" style={{ color: "var(--color-fg-2)", fontFamily: "Geist Mono, monospace" }}>
                        {fixes[i].value}
                      </code>
                      <span className="text-[10px]" style={{ color: "var(--color-fg-4)" }}>{fixes[i].explanation}</span>
                      {fixes[i].kind !== "assertion" && (
                        <button
                          onClick={() => applyFix(i, fixes[i])}
                          disabled={appliedFixes.has(i)}
                          className="self-start flex items-center gap-1 px-2 rounded transition-opacity hover:opacity-80 disabled:opacity-60"
                          style={{ height: 22, fontSize: 11, fontWeight: 600,
                            background: appliedFixes.has(i) ? "#22C55E20" : "var(--color-accent-10)",
                            border: `1px solid ${appliedFixes.has(i) ? "#22C55E40" : "var(--color-accent-20)"}`,
                            color: appliedFixes.has(i) ? "#22C55E" : "var(--color-accent)" }}>
                          {appliedFixes.has(i)
                            ? <><Check size={10} /> Applied</>
                            : <><Zap size={10} /> Apply</>}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {testResults.length > 0 && (
                <p className="text-[11px] mt-1" style={{ color: "var(--color-fg-4)" }}>
                  {testResults.filter(r => r.pass).length}/{testResults.length} passing
                </p>
              )}
            </div>
          )}

          {/* Timeline tab */}
          {tab === "Timeline" && (() => {
            if (!response) {
              return (
                <p className="text-[12px]" style={{ color: "var(--color-fg-4)" }}>
                  Send a request to see the timing waterfall.
                </p>
              );
            }
            const ttfb = response.ttfbMs ?? response.durationMs;
            const download = response.downloadMs ?? 0;
            const total = ttfb + download;
            const ttfbPct = total > 0 ? (ttfb / total) * 100 : 100;
            const dlPct = total > 0 ? (download / total) * 100 : 0;

            const phases: { label: string; sublabel: string; ms: number; startPct: number; widthPct: number; color: string }[] = [
              { label: "Connect + Waiting", sublabel: "DNS · TCP · TLS · TTFB", ms: ttfb, startPct: 0, widthPct: ttfbPct, color: "var(--color-accent)" },
              { label: "Download", sublabel: "body transfer", ms: download, startPct: ttfbPct, widthPct: dlPct, color: "#22C55E" },
            ];

            return (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-fg-3)" }}>
                    Request Waterfall
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--color-fg-4)", fontFamily: "Geist Mono, monospace" }}>
                    total {total}ms
                  </span>
                </div>

                <div className="flex flex-col gap-3">
                  {phases.map(ph => (
                    <div key={ph.label} className="flex flex-col gap-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[12px] font-medium" style={{ color: "var(--color-fg-2)" }}>{ph.label}</span>
                        <span className="text-[10px]" style={{ color: "var(--color-fg-4)" }}>{ph.sublabel}</span>
                        <span className="ml-auto text-[12px]" style={{ fontFamily: "Geist Mono, monospace", color: ph.color }}>{ph.ms}ms</span>
                      </div>
                      <div className="relative rounded" style={{ height: 18, background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
                        {ph.widthPct > 0 && (
                          <div style={{
                            position: "absolute",
                            left: `${ph.startPct}%`,
                            width: `${Math.max(ph.widthPct, 1)}%`,
                            height: "100%",
                            background: `${ph.color}60`,
                            borderRadius: 3,
                            borderLeft: `2px solid ${ph.color}`,
                          }} />
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Total bar */}
                  <div className="flex flex-col gap-1" style={{ marginTop: 4 }}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12px] font-semibold" style={{ color: "var(--color-fg)" }}>Total</span>
                      <span className="ml-auto text-[12px] font-semibold" style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg)" }}>{total}ms</span>
                    </div>
                    <div className="relative rounded overflow-hidden" style={{ height: 18, background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
                      <div style={{ position: "absolute", left: 0, width: `${ttfbPct}%`, height: "100%", background: "var(--color-accent-50)" }} />
                      <div style={{ position: "absolute", left: `${ttfbPct}%`, width: `${dlPct}%`, height: "100%", background: "#22C55E60" }} />
                    </div>
                  </div>
                </div>

                {/* Timing table */}
                <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
                  {[
                    ["Connect + Waiting (TTFB)", `${ttfb}ms`],
                    ["Download", `${download}ms`],
                    ["Total", `${total}ms`],
                    ["Size", formatBytes(response.size)],
                    ["Status", `${response.status} ${response.statusText}`],
                  ].map(([label, value], i) => (
                    <div key={label} className="flex items-center px-3"
                      style={{ height: 32, borderBottom: i < 4 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "var(--color-card)" : "transparent" }}>
                      <span className="flex-1 text-[11px]" style={{ color: "var(--color-fg-3)" }}>{label}</span>
                      <span className="text-[11px]" style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg-2)" }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Console tab */}
          {tab === "Console" && <ConsolePanel />}
        </div>
      )}

      {/* AI Panel */}
      {showAiPanel && (
        <div data-tour="ai-panel" className="shrink-0 flex flex-col gap-2 p-3"
          style={{ background: isError ? "rgba(239,68,68,0.06)" : "var(--color-accent-10)", borderTop: "1px solid var(--color-border)" }}>
          <div className="flex items-center gap-1.5">
            {isError
              ? <Bug size={14} className="text-red" />
              : <Sparkles size={14} style={{ color: "var(--color-accent)" }} />}
            <span className="flex-1 text-[12px] font-semibold" style={{ color: "var(--color-fg)" }}>
              {isError ? "AI Debug Assist" : "AI Test Generator"}
            </span>
            {usingOwnKey && <span className="text-[10px]" style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg-4)" }}>{claudeModel}</span>}
          </div>
          <p className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>
            {isError
              ? "Claude will explain the error and suggest fixes"
              : "Generate assertions from this response automatically"}
          </p>
          {/* Debug Assist structured result */}
          {isError && (debugResult || debugRaw) && (
            <div className="flex flex-col gap-2">
              {debugResult ? (
                <>
                  <div className="flex flex-col gap-1">
                    <p className="text-[11px] font-semibold" style={{ color: "#EF4444" }}>{debugResult.what}</p>
                    <p className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>{debugResult.cause}</p>
                  </div>
                  {debugResult.steps.length > 0 && (
                    <div className="flex flex-col gap-0.5 pl-1">
                      {debugResult.steps.map((s, si) => (
                        <div key={si} className="flex gap-1.5 text-[11px]" style={{ color: "var(--color-fg-3)" }}>
                          <span style={{ color: "#EF4444", flexShrink: 0, fontWeight: 600 }}>{si + 1}.</span>
                          <span>{s}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {debugResult.suggestions && debugResult.suggestions.length > 0 && (
                    <div className="flex flex-col gap-1 pt-1" style={{ borderTop: "1px solid #EF444420" }}>
                      <span className="text-[10px] font-semibold uppercase" style={{ color: "#EF4444", letterSpacing: "0.05em" }}>Apply fix</span>
                      {debugResult.suggestions.map((s, si) => {
                        const sid = `${s.kind}-${s.key}-${s.value}`;
                        const applied = appliedSuggestions.has(sid);
                        return (
                          <div key={si} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded"
                            style={{ background: "#EF444410", border: "1px solid #EF444425" }}>
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="text-[10px] font-semibold" style={{ color: "var(--color-fg-2)" }}>{s.label}</span>
                              <code className="text-[10px] truncate" style={{ color: "#EF4444", fontFamily: "Geist Mono, monospace" }}>
                                {s.kind === "body" ? s.value : `${s.key}: ${s.value}`}
                              </code>
                            </div>
                            <button
                              onClick={() => applyDebugSuggestion(s, sid)}
                              disabled={applied}
                              className="shrink-0 flex items-center gap-1 px-2 rounded transition-opacity hover:opacity-80 disabled:opacity-60"
                              style={{ height: 24, fontSize: 11, fontWeight: 600,
                                background: applied ? "#22C55E20" : "#EF444418",
                                border: `1px solid ${applied ? "#22C55E40" : "#EF444435"}`,
                                color: applied ? "#22C55E" : "#EF4444" }}>
                              {applied ? <><Check size={10} /> Applied</> : <><Zap size={10} /> Apply</>}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <pre className="text-[11px] rounded-lg p-2 overflow-x-auto whitespace-pre-wrap"
                  style={{ background: "#EF444415", border: "1px solid #EF444430", color: "#EF4444", fontFamily: "Geist Mono, monospace" }}>
                  {debugRaw}
                </pre>
              )}
            </div>
          )}
          {/* Generate Tests result */}
          {!isError && aiResult && (
            <pre className="text-[11px] rounded-lg p-2 overflow-x-auto whitespace-pre-wrap"
              style={{ background: "var(--color-accent-10)", border: "1px solid var(--color-accent-20)", color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>
              {aiResult}
            </pre>
          )}
          <div className="flex gap-2">
            {isError && debugAssistEnabled && (
              <button
                onClick={handleDebugAssist}
                disabled={!response || aiLoading || isBinary}
                className="flex items-center justify-center gap-1.5 flex-1 rounded-md font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ height: 32, fontSize: 12, background: "#EF4444" }}>
                <Bug size={13} />
                {aiLoading ? "Analyzing..." : "Debug with AI"}
              </button>
            )}
            {autoGenerateTests && (
              <button
                onClick={handleGenerateTests}
                disabled={!response || aiLoading || isBinary}
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
