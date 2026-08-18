import { useState, useRef } from "react";
import { X, Upload, FileJson, Terminal } from "lucide-react";
import { importPostman, importOpenApi, importCurl, detectFormat, type ImportFormat } from "@/lib/importers";
import { useCollectionsStore } from "@/stores/collections";
import type { CollectionRequest, CollectionFolder, Collection } from "@/stores/collections";

interface Props {
  open: boolean;
  onClose: () => void;
}

const TABS: { id: ImportFormat | "curl"; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "postman", label: "Postman v2.1", icon: <FileJson size={13} />, hint: "Paste or drop a Postman Collection JSON file" },
  { id: "openapi", label: "OpenAPI 3.0", icon: <FileJson size={13} />, hint: "Paste or drop an OpenAPI 3.0 JSON spec" },
  { id: "curl", label: "cURL", icon: <Terminal size={13} />, hint: "Paste a cURL command" },
];

function countRequests(col: Collection): number {
  const walk = (fs: CollectionFolder[]): number =>
    fs.reduce((n, f) => n + f.requests.length + walk(f.folders ?? []), 0);
  return col.requests.length + walk(col.folders);
}

export function ImportModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<ImportFormat>("postman");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = e => setText(String(e.target?.result ?? ""));
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  function handleImport() {
    setError(null);
    setSuccess(null);
    if (!text.trim()) { setError("Paste or drop content first."); return; }

    try {
      const fmt = tab === "curl" ? "curl" : detectFormat(text) === tab ? tab : tab;
      let col;
      if (fmt === "curl") {
        const req: CollectionRequest = importCurl(text);
        col = {
          id: req.id + "-col",
          name: req.name || "Imported cURL",
          requests: [req],
          folders: [],
          expanded: true,
        };
      } else if (fmt === "openapi") {
        col = importOpenApi(JSON.parse(text));
      } else {
        col = importPostman(JSON.parse(text));
      }
      useCollectionsStore.getState().addCollection(col);
      setSuccess(`Imported "${col.name}": ${countRequests(col)} requests`);
      setText("");
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="flex flex-col rounded-xl shadow-2xl"
        style={{ width: 520, maxHeight: "80vh", background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>

        {/* Title bar */}
        <div className="flex items-center gap-2 shrink-0 px-4"
          style={{ height: 48, borderBottom: "1px solid var(--color-border)" }}>
          <Upload size={15} style={{ color: "var(--color-accent)" }} />
          <span className="flex-1 text-[13px] font-semibold" style={{ color: "var(--color-fg)" }}>Import Collection</span>
          <button onClick={onClose}
            className="flex items-center justify-center rounded transition-colors"
            style={{ width: 26, height: 26, color: "var(--color-fg-3)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--color-card)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            <X size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 px-4 gap-1"
          style={{ height: 40, borderBottom: "1px solid var(--color-border)", alignItems: "flex-end" }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id as ImportFormat); setError(null); setSuccess(null); }}
              className="flex items-center gap-1.5 px-3 text-[12px] transition-colors rounded-t"
              style={{
                height: 32, paddingBottom: 2,
                color: tab === t.id ? "var(--color-fg)" : "var(--color-fg-3)",
                borderBottom: tab === t.id ? "2px solid var(--color-accent)" : "2px solid transparent",
              }}>
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col gap-3 p-4 overflow-auto">
          <p className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>
            {TABS.find(t => t.id === tab)?.hint}
          </p>

          {/* Drop zone + textarea */}
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            className="flex-1 flex flex-col rounded-lg"
            style={{ minHeight: 200, border: "1px dashed var(--color-border)", background: "var(--color-input)" }}>
            <textarea
              value={text}
              onChange={e => { setText(e.target.value); setError(null); setSuccess(null); }}
              placeholder={tab === "curl" ? "curl -X GET https://api.example.com/users -H ..." : "Paste JSON here or drag & drop a file..."}
              spellCheck={false}
              className="flex-1 w-full p-3 text-[11px] rounded-lg resize-none bg-transparent"
              style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg-2)", outline: "none", minHeight: 200 }}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 rounded text-[12px] transition-opacity hover:opacity-80"
              style={{ height: 30, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)" }}>
              <Upload size={12} /> Browse file
            </button>
            <input ref={fileRef} type="file" accept=".json,.yaml,.yml" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />

            <div className="flex-1" />

            <button
              onClick={handleImport}
              className="flex items-center justify-center gap-1.5 px-4 rounded font-semibold text-white transition-opacity hover:opacity-90"
              style={{ height: 30, fontSize: 12, background: "var(--color-accent)" }}>
              Import
            </button>
          </div>

          {error && (
            <div className="rounded p-2 text-[11px]"
              style={{ background: "#EF444415", border: "1px solid #EF444430", color: "#EF4444" }}>
              {error}
            </div>
          )}
          {success && (
            <div className="rounded p-2 text-[11px]"
              style={{ background: "#22C55E15", border: "1px solid #22C55E30", color: "#22C55E" }}>
              {success}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
