import { useState, useRef } from "react";
import { Play, Square, X, CheckCircle, XCircle, Loader, ChevronDown, ChevronRight, Network } from "lucide-react";
import { useCollectionsStore } from "@/stores/collections";
import { sendRequest, grpcLoadProtoById, grpcInvoke } from "@/lib/tauri";
import { evaluateAssertions, type AssertionResult } from "@/lib/assertionEvaluator";
import { methodColor, methodBg } from "@/lib/methods";
import type { CollectionRequest } from "@/stores/collections";

interface RunResult {
  req: CollectionRequest;
  status: "pending" | "running" | "done" | "error";
  statusCode?: number;
  durationMs?: number;
  error?: string;
  body?: string;
  assertions: AssertionResult[];
  expanded: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function MethodPill({ method }: { method: string }) {
  return (
    <span className="inline-flex items-center justify-center shrink-0 font-bold"
      style={{ width: 36, height: 16, borderRadius: 3, fontSize: 9, fontFamily: "Geist Mono, monospace", color: methodColor(method), background: methodBg(method) }}>
      {method}
    </span>
  );
}

function GrpcPill() {
  return (
    <span className="inline-flex items-center gap-1 shrink-0 font-bold"
      style={{ height: 16, borderRadius: 3, fontSize: 9, paddingInline: 5, color: "#A855F7", background: "#A855F715", fontFamily: "Geist Mono, monospace" }}>
      <Network size={8} />gRPC
    </span>
  );
}

function StatusBadge({ code }: { code: number }) {
  const color = code < 300 ? "#22C55E" : code < 400 ? "#F59E0B" : "#EF4444";
  return (
    <span className="font-bold text-[11px]" style={{ color, fontFamily: "Geist Mono, monospace" }}>{code}</span>
  );
}

export function CollectionRunner({ open, onClose }: Props) {
  const { collections } = useCollectionsStore();
  const [selectedColId, setSelectedColId] = useState<string>(() => collections[0]?.id ?? "");
  const [results, setResults] = useState<RunResult[]>([]);
  const [running, setRunning] = useState(false);
  const [delayMs, setDelayMs] = useState(200);
  const abortRef = useRef(false);

  if (!open) return null;

  const col = collections.find(c => c.id === selectedColId);

  function flatRequests(): CollectionRequest[] {
    if (!col) return [];
    const reqs: CollectionRequest[] = [...col.requests];
    for (const folder of col.folders) reqs.push(...folder.requests);
    return reqs;
  }

  function toggleExpanded(idx: number) {
    setResults(prev => prev.map((r, i) => i === idx ? { ...r, expanded: !r.expanded } : r));
  }

  async function run() {
    if (!col) return;
    abortRef.current = false;
    const reqs = flatRequests();
    const initial: RunResult[] = reqs.map(r => ({ req: r, status: "pending", assertions: [], expanded: false }));
    setResults(initial);
    setRunning(true);

    for (let i = 0; i < reqs.length; i++) {
      if (abortRef.current) break;

      setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: "running" } : r));

      const req = reqs[i];

      try {
        if (req.kind === "grpc" && req.grpc) {
          const g = req.grpc;
          if (g.protoId) await grpcLoadProtoById(g.protoId);
          const useTls = g.endpoint?.startsWith("https") ?? false;
          const resp = await grpcInvoke(
            g.endpoint ?? "",
            g.service ?? "",
            g.method ?? "",
            g.payload ?? "{}",
            g.metadata ?? {},
            useTls,
            g.protoId ?? "",
          );
          setResults(prev => prev.map((r, idx) =>
            idx === i ? { ...r, status: "done", durationMs: resp.durationMs, body: resp.body, assertions: [] } : r
          ));
        } else {
          const url = col.baseUrl && !req.path.startsWith("http")
            ? col.baseUrl.replace(/\/$/, "") + "/" + req.path.replace(/^\//, "")
            : req.path;
          const resp = await sendRequest({
            method: req.method,
            url,
            headers: req.headers ?? {},
            body: req.body,
          });
          const assertions = req.tests?.length
            ? evaluateAssertions(req.tests.map(t => t.assert), resp.status, resp.body, resp.headers)
            : [];
          setResults(prev => prev.map((r, idx) =>
            idx === i ? { ...r, status: "done", statusCode: resp.status, durationMs: resp.durationMs, body: resp.body, assertions } : r
          ));
        }
      } catch (err) {
        setResults(prev => prev.map((r, idx) =>
          idx === i ? { ...r, status: "error", error: String(err), assertions: [] } : r
        ));
      }

      if (delayMs > 0 && i < reqs.length - 1) {
        await new Promise(res => setTimeout(res, delayMs));
      }
    }

    setRunning(false);
  }

  function stop() {
    abortRef.current = true;
    setRunning(false);
  }

  const done = results.filter(r => r.status === "done" || r.status === "error");
  const passed = results.filter(r => r.status === "done" && r.assertions.every(a => a.pass) && (r.statusCode ?? 0) < 500);
  const failed = done.length - passed.length;
  const totalAssertions = results.flatMap(r => r.assertions);
  const passedAssertions = totalAssertions.filter(a => a.pass);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget && !running) onClose(); }}>
      <div className="flex flex-col rounded-xl shadow-2xl"
        style={{ width: 660, height: "80vh", background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>

        {/* Title bar */}
        <div className="flex items-center gap-3 shrink-0 px-4"
          style={{ height: 48, borderBottom: "1px solid var(--color-border)" }}>
          <Play size={15} style={{ color: "var(--color-accent)" }} />
          <span className="text-[13px] font-semibold" style={{ color: "var(--color-fg)" }}>Collection Runner</span>

          {/* Collection selector */}
          <select
            value={selectedColId}
            onChange={e => { setSelectedColId(e.target.value); setResults([]); }}
            disabled={running}
            className="text-[12px] rounded px-2"
            style={{ height: 28, background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)", marginLeft: 8 }}>
            {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {/* Delay */}
          <div className="flex items-center gap-1 text-[11px]" style={{ color: "var(--color-fg-3)" }}>
            <span>Delay</span>
            <input
              type="number" min={0} max={5000} step={100}
              value={delayMs}
              onChange={e => setDelayMs(Number(e.target.value))}
              disabled={running}
              className="text-[11px] px-1 rounded"
              style={{ width: 56, height: 24, background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)", fontFamily: "Geist Mono, monospace" }}
            />
            <span>ms</span>
          </div>

          <div className="flex-1" />

          {/* Run / Stop */}
          {!running ? (
            <button onClick={run} disabled={!col || flatRequests().length === 0}
              className="flex items-center gap-1.5 px-3 rounded font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ height: 28, fontSize: 12, background: "var(--color-accent)" }}>
              <Play size={12} /> Run
            </button>
          ) : (
            <button onClick={stop}
              className="flex items-center gap-1.5 px-3 rounded font-semibold transition-opacity hover:opacity-80"
              style={{ height: 28, fontSize: 12, background: "#EF444420", border: "1px solid #EF444440", color: "#EF4444" }}>
              <Square size={12} /> Stop
            </button>
          )}

          <button onClick={() => !running && onClose()}
            className="flex items-center justify-center rounded ml-1"
            style={{ width: 26, height: 26, color: "var(--color-fg-3)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--color-card)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            <X size={14} />
          </button>
        </div>

        {/* Summary bar */}
        {results.length > 0 && (
          <div className="flex items-center gap-4 shrink-0 px-4"
            style={{ height: 36, borderBottom: "1px solid var(--color-border)", background: "var(--color-card)" }}>
            <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>
              {done.length} / {results.length} requests
            </span>
            <span className="text-[11px]" style={{ color: "#22C55E" }}>{passed.length} passed</span>
            {failed > 0 && <span className="text-[11px]" style={{ color: "#EF4444" }}>{failed} failed</span>}
            {totalAssertions.length > 0 && (
              <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>
                Assertions: {passedAssertions.length}/{totalAssertions.length}
              </span>
            )}
          </div>
        )}

        {/* Request list */}
        <div className="flex-1 overflow-y-auto">
          {results.length === 0 && col && (
            <div className="flex flex-col gap-1 py-3">
              {flatRequests().map((req, i) => (
                <div key={req.id} className="flex items-center gap-2 px-4"
                  style={{ height: 30 }}>
                  <span className="text-[11px]" style={{ color: "var(--color-fg-4)", fontFamily: "Geist Mono, monospace", width: 20 }}>{i + 1}</span>
                  {req.kind === "grpc" ? <GrpcPill /> : <MethodPill method={req.method} />}
                  <span className="text-[12px] truncate" style={{ color: "var(--color-fg-2)" }}>{req.name || req.path}</span>
                </div>
              ))}
              {flatRequests().length === 0 && (
                <p className="text-[11px] text-center py-8" style={{ color: "var(--color-fg-4)" }}>
                  No requests in this collection
                </p>
              )}
            </div>
          )}

          {results.map((r, i) => {
            const allPass = r.assertions.every(a => a.pass);
            const isOk = r.status === "done" && allPass && (r.statusCode ?? 0) < 500;
            const isFail = r.status === "error" || (r.status === "done" && (!allPass || (r.statusCode ?? 0) >= 500));

            return (
              <div key={r.req.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                <button
                  className="flex items-center gap-2 w-full px-4 transition-colors text-left"
                  style={{ height: 36, minHeight: 36 }}
                  onClick={() => (r.status === "done" || r.status === "error") && toggleExpanded(i)}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--color-card)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>

                  {/* expand toggle */}
                  <span style={{ width: 14, flexShrink: 0 }}>
                    {(r.status === "done" || r.status === "error")
                      ? r.expanded ? <ChevronDown size={11} style={{ color: "var(--color-fg-4)" }} /> : <ChevronRight size={11} style={{ color: "var(--color-fg-4)" }} />
                      : null}
                  </span>

                  {/* status icon */}
                  {r.status === "pending" && <span style={{ width: 14, height: 14, borderRadius: 7, border: "1.5px solid var(--color-border)", flexShrink: 0 }} />}
                  {r.status === "running" && <Loader size={14} className="animate-spin shrink-0" style={{ color: "var(--color-accent)" }} />}
                  {isOk && <CheckCircle size={14} className="shrink-0" style={{ color: "#22C55E" }} />}
                  {isFail && <XCircle size={14} className="shrink-0" style={{ color: "#EF4444" }} />}

                  <span className="text-[11px] shrink-0" style={{ color: "var(--color-fg-4)", fontFamily: "Geist Mono, monospace", width: 18 }}>{i + 1}</span>
                  {r.req.kind === "grpc" ? <GrpcPill /> : <MethodPill method={r.req.method} />}
                  <span className="text-[12px] flex-1 truncate" style={{ color: "var(--color-fg-2)" }}>{r.req.name || r.req.path}</span>

                  {r.statusCode !== undefined && <StatusBadge code={r.statusCode} />}
                  {r.durationMs !== undefined && (
                    <span className="text-[11px] ml-2" style={{ color: "var(--color-fg-4)", fontFamily: "Geist Mono, monospace" }}>
                      {r.durationMs}ms
                    </span>
                  )}
                  {r.error && (
                    <span className="text-[11px] ml-2 truncate max-w-[200px]" style={{ color: "#EF4444" }}>{r.error}</span>
                  )}
                  {r.assertions.length > 0 && (
                    <span className="text-[10px] ml-2" style={{ color: allPass ? "#22C55E" : "#EF4444" }}>
                      {r.assertions.filter(a => a.pass).length}/{r.assertions.length} assertions
                    </span>
                  )}
                </button>

                {/* Expanded detail: body + assertions */}
                {r.expanded && (
                  <div style={{ background: "var(--color-card)", borderTop: "1px solid var(--color-border)" }}>
                    {r.error && (
                      <div className="px-4 py-2" style={{ paddingLeft: 54 }}>
                        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#EF4444" }}>Error</span>
                        <pre className="mt-1 text-[11px] whitespace-pre-wrap break-all"
                          style={{ fontFamily: "Geist Mono, monospace", color: "#EF4444", lineHeight: 1.6 }}>
                          {r.error}
                        </pre>
                      </div>
                    )}
                    {r.body && (
                      <div className="px-4 py-2" style={{ paddingLeft: 54 }}>
                        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-fg-4)" }}>Response</span>
                        <pre className="mt-1 text-[11px] whitespace-pre-wrap break-all max-h-40 overflow-y-auto"
                          style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg-2)", lineHeight: 1.6 }}>
                          {(() => { try { return JSON.stringify(JSON.parse(r.body), null, 2); } catch { return r.body; } })()}
                        </pre>
                      </div>
                    )}
                    {r.assertions.map((a, ai) => (
                      <div key={ai} className="flex items-start gap-2 px-4 py-1"
                        style={{ paddingLeft: 54, borderTop: "1px solid var(--color-border)" }}>
                        {a.pass
                          ? <CheckCircle size={11} className="shrink-0 mt-0.5" style={{ color: "#22C55E" }} />
                          : <XCircle size={11} className="shrink-0 mt-0.5" style={{ color: "#EF4444" }} />}
                        <span className="text-[11px]" style={{ fontFamily: "Geist Mono, monospace", color: a.pass ? "var(--color-fg-2)" : "#EF4444" }}>
                          {a.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
