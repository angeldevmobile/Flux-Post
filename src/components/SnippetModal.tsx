import { useState } from "react";
import { X, Copy, Check } from "lucide-react";
import { exportCurl, exportFetch, exportAxios, exportPythonRequests, exportGoHttp } from "@/lib/exporters";

type Lang = "curl" | "fetch" | "axios" | "python" | "go";

const LANGS: { id: Lang; label: string }[] = [
  { id: "curl",   label: "cURL"   },
  { id: "fetch",  label: "fetch"  },
  { id: "axios",  label: "axios"  },
  { id: "python", label: "Python" },
  { id: "go",     label: "Go"     },
];

interface Props {
  req: { method: string; url: string; headers: Record<string, string>; body?: string };
  onClose: () => void;
}

export function SnippetModal({ req, onClose }: Props) {
  const [lang, setLang] = useState<Lang>("curl");
  const [copied, setCopied] = useState(false);

  function getSnippet(): string {
    switch (lang) {
      case "curl":   return exportCurl(req);
      case "fetch":  return exportFetch(req);
      case "axios":  return exportAxios(req);
      case "python": return exportPythonRequests(req);
      case "go":     return exportGoHttp(req);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(getSnippet());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}>
      <div
        className="flex flex-col rounded-xl overflow-hidden"
        style={{ width: 660, maxHeight: "78vh", background: "var(--color-card)", border: "1px solid var(--color-border)" }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 shrink-0"
          style={{ height: 46, borderBottom: "1px solid var(--color-border)" }}>
          <span className="text-[13px] font-semibold shrink-0" style={{ color: "var(--color-fg)" }}>
            Code Snippet
          </span>

          {/* Language tabs */}
          <div className="flex items-center gap-1">
            {LANGS.map(l => (
              <button
                key={l.id}
                onClick={() => setLang(l.id)}
                className="px-2.5 py-1 rounded text-[11px] font-medium transition-colors"
                style={{
                  background: lang === l.id ? "var(--color-accent-10)" : "transparent",
                  color: lang === l.id ? "var(--color-accent)" : "var(--color-fg-3)",
                  border: lang === l.id ? "1px solid var(--color-accent-50)" : "1px solid transparent",
                }}>
                {l.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold transition-opacity hover:opacity-80"
              style={{ background: "var(--color-accent)", color: "#fff" }}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded-md transition-colors"
              style={{ width: 28, height: 28, color: "var(--color-fg-3)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--color-border)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Code */}
        <div className="flex-1 overflow-auto p-4" style={{ background: "var(--color-bg)" }}>
          <pre
            className="text-[12px] whitespace-pre leading-relaxed"
            style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg-2)" }}>
            {getSnippet()}
          </pre>
        </div>
      </div>
    </div>
  );
}
