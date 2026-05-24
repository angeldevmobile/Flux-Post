import { useState } from "react";
import { Sparkles, Copy, Check, Timer } from "lucide-react";
import { useRequestStore } from "@/stores/request";
import { generateTests } from "@/lib/tauri";

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
  const [tab, setTab] = useState<RespTab>("Body");
  const [copied, setCopied] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);

  async function handleGenerateTests() {
    if (!response) return;
    setAiLoading(true); setAiResult(null);
    try {
      const req = getRequest();
      const apiKey = localStorage.getItem("flux_claude_key") ?? "";
      setAiResult(await generateTests(
        { method: req.method, url: req.url, body: req.body },
        { status: response.status, body: response.body },
        apiKey,
      ));
    } catch (e) { setAiResult(`Error: ${e}`); }
    finally { setAiLoading(false); }
  }

  function handleCopy() {
    if (!response) return;
    navigator.clipboard.writeText(response.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const TABS: RespTab[] = ["Body", "Headers", "Cookies"];

  return (
    <div className="flex flex-col shrink-0 h-full overflow-hidden" style={{ width: 420, background: "#0A0A0A" }}>
      {/* Response header */}
      <div className="flex items-center gap-2 shrink-0 px-4" style={{ height: 52, borderBottom: "1px solid #27272A" }}>
        <span className="flex-1 text-[12px] font-medium text-[#71717A]">Response</span>

        {response && (
          <>
            {/* Status pill */}
            <div className="flex items-center gap-1.5 px-2.5 rounded"
              style={{ height: 24, background: `${STATUS_COLOR(response.status)}18` }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: STATUS_COLOR(response.status) }} />
              <span className="font-semibold" style={{ fontSize: 11, fontFamily: "Geist Mono, monospace", color: STATUS_COLOR(response.status) }}>
                {response.status} {response.statusText}
              </span>
            </div>
            {/* Timer */}
            <div className="flex items-center gap-1 px-2.5 rounded"
              style={{ height: 24, background: "#1A1A1A", border: "1px solid #27272A" }}>
              <Timer size={11} className="text-[#71717A]" />
              <span style={{ fontSize: 11, fontFamily: "Geist Mono, monospace", color: "#A1A1AA" }}>{response.durationMs}ms</span>
            </div>
            {/* Size */}
            <div className="flex items-center px-2.5 rounded"
              style={{ height: 24, background: "#1A1A1A", border: "1px solid #27272A" }}>
              <span style={{ fontSize: 11, fontFamily: "Geist Mono, monospace", color: "#A1A1AA" }}>{formatBytes(response.size)}</span>
            </div>
            <button onClick={handleCopy} className="text-[#71717A] hover:text-[#A1A1AA] transition-colors ml-1" title="Copy">
              {copied ? <Check size={14} className="text-[#22C55E]" /> : <Copy size={14} />}
            </button>
          </>
        )}

        {isLoading && <span className="text-[12px] text-[#71717A] animate-pulse">Sending...</span>}
        {!response && !isLoading && !error && (
          <span className="text-[12px] text-[#3F3F46]">Send a request to see the response</span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center shrink-0 px-4" style={{ height: 36, borderBottom: "1px solid #27272A" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="relative px-3 h-full text-[12px] transition-colors"
            style={{ color: tab === t ? "#FFFFFF" : "#71717A" }}>
            {t}
            {tab === t && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: "#A855F7" }} />}
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
            style={{ fontFamily: "Geist Mono, monospace", color: "#E4E4E7", lineHeight: 1.6 }}>
            {tryPrettyJson(response.body)}
          </pre>
        )}
        {tab === "Headers" && response && (
          <div className="flex flex-col gap-1">
            {Object.entries(response.headers).map(([k, v]) => (
              <div key={k} className="flex gap-2 text-[12px]">
                <span className="text-[#A855F7] shrink-0" style={{ fontFamily: "Geist Mono, monospace" }}>{k}:</span>
                <span className="text-[#A1A1AA] break-all">{v}</span>
              </div>
            ))}
          </div>
        )}
        {tab === "Cookies" && <p className="text-[12px] text-[#71717A]">No cookies</p>}
      </div>

      {/* AI Test Generator */}
      <div className="shrink-0 flex flex-col gap-2 p-3" style={{ background: "#0F0A1A", borderTop: "1px solid #27272A" }}>
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className="text-[#A855F7]" />
          <span className="flex-1 text-[12px] font-semibold text-[#E4E4E7]">AI Test Generator</span>
        </div>
        <p className="text-[11px] text-[#71717A]">Generate assertions from this response automatically</p>
        {aiResult && (
          <pre className="text-[11px] rounded-lg p-2 overflow-x-auto"
            style={{ background: "#1A0A2A", border: "1px solid #A855F730", color: "#C084FC", fontFamily: "Geist Mono, monospace" }}>
            {aiResult}
          </pre>
        )}
        <button
          onClick={handleGenerateTests}
          disabled={!response || aiLoading}
          className="flex items-center justify-center gap-1.5 w-full rounded-md font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ height: 32, fontSize: 12, background: "#A855F7" }}>
          <Sparkles size={13} />
          {aiLoading ? "Generating..." : "Generate Tests"}
        </button>
      </div>
    </div>
  );
}
