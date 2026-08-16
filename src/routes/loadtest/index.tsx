import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { Play, Square, BarChart2, Zap, AlertCircle, TrendingUp } from "lucide-react";
import { runLoadTest } from "@/lib/tauri";
import type { LoadTestResult, LoadTestProgress } from "@/lib/tauri";
import { useRequestStore } from "@/stores/request";
import { HTTP_METHODS } from "@/lib/methods";
import { useEnvironmentStore } from "@/stores/environment";

const LATENCY_BUCKETS = [
  { label: "< 50ms",    max: 50 },
  { label: "50–100ms",  max: 100 },
  { label: "100–250ms", max: 250 },
  { label: "250–500ms", max: 500 },
  { label: "500ms–1s",  max: 1000 },
  { label: "> 1s",      max: Infinity },
];

function interpolateEnv(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg px-3 py-2.5"
      style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", minWidth: 90 }}>
      <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--color-fg-4)" }}>{label}</span>
      <span className="text-[18px] font-semibold leading-none" style={{ fontFamily: "Geist Mono, monospace", color: color ?? "var(--color-fg)" }}>{value}</span>
      {sub && <span className="text-[10px]" style={{ color: "var(--color-fg-4)" }}>{sub}</span>}
    </div>
  );
}

export function LoadTestRoute() {
  const { url: storeUrl, method: storeMethod } = useRequestStore();
  const { environments, activeId, globalVariables } = useEnvironmentStore();
  const activeEnv = environments.find(e => e.id === activeId);
  const allVars: Record<string, string> = { ...globalVariables, ...(activeEnv?.variables ?? {}) };

  const [url, setUrl] = useState(() => interpolateEnv(storeUrl, allVars) || "");
  const [method, setMethod] = useState(storeMethod || "GET");
  const [total, setTotal] = useState(100);
  const [concurrency, setConcurrency] = useState(10);
  const [timeoutMs, setTimeoutMs] = useState(5000);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<LoadTestProgress | null>(null);
  const [result, setResult] = useState<LoadTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unlisten = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => { unlisten.current?.(); };
  }, []);

  async function handleRun() {
    if (!url.trim()) return;
    setRunning(true);
    setResult(null);
    setError(null);
    setProgress(null);

    unlisten.current?.();
    const unsub = await listen<LoadTestProgress>("load-test-progress", e => {
      setProgress(e.payload);
    });
    unlisten.current = unsub;

    try {
      const res = await runLoadTest({
        method,
        url: url.trim(),
        headers: {},
        total,
        concurrency,
        timeoutMs,
      });
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
      unlisten.current?.();
    }
  }

  const progressPct = progress ? Math.round((progress.completed / progress.total) * 100) : 0;

  function buildHistogram(latencies: number[]) {
    const counts = LATENCY_BUCKETS.map(b => ({ ...b, count: 0 }));
    for (const ms of latencies) {
      const bucket = counts.find(b => ms < b.max);
      if (bucket) bucket.count++;
    }
    const max = Math.max(...counts.map(b => b.count), 1);
    return counts.map(b => ({ ...b, pct: (b.count / max) * 100 }));
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: "var(--color-bg)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0 px-6" style={{ height: 52, borderBottom: "1px solid var(--color-border)" }}>
        <BarChart2 size={16} style={{ color: "var(--color-accent)" }} />
        <span className="text-[14px] font-semibold" style={{ color: "var(--color-fg)" }}>Load Test</span>
        <span className="text-[12px]" style={{ color: "var(--color-fg-4)" }}>Run any request under load and measure performance</span>
      </div>

      <div className="flex flex-col gap-5 p-6 max-w-3xl w-full">
        {/* Config */}
        <div className="flex flex-col gap-3 rounded-lg p-4" style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-fg-3)" }}>Configuration</span>

          {/* URL + Method */}
          <div className="flex gap-2">
            <select
              value={method}
              onChange={e => setMethod(e.target.value as typeof method)}
              disabled={running}
              className="rounded px-2 text-[12px] font-semibold shrink-0"
              style={{ height: 34, background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-accent)", fontFamily: "Geist Mono, monospace", width: 90 }}>
              {HTTP_METHODS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              disabled={running}
              placeholder="https://api.example.com/endpoint"
              className="flex-1 rounded px-3 text-[12px]"
              style={{ height: 34, background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-fg)", fontFamily: "Geist Mono, monospace" }}
            />
          </div>

          {/* Params row */}
          <div className="flex gap-3 flex-wrap">
            {[
              { label: "Total requests", value: total, set: setTotal, min: 1, max: 100000 },
              { label: "Concurrency", value: concurrency, set: setConcurrency, min: 1, max: 500 },
              { label: "Timeout (ms)", value: timeoutMs, set: setTimeoutMs, min: 100, max: 60000 },
            ].map(({ label, value, set, min, max }) => (
              <div key={label} className="flex flex-col gap-1">
                <label className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>{label}</label>
                <input
                  type="number"
                  value={value}
                  min={min}
                  max={max}
                  disabled={running}
                  onChange={e => set(Number(e.target.value))}
                  className="rounded px-2 text-[12px]"
                  style={{ height: 30, width: 110, background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-fg)", fontFamily: "Geist Mono, monospace" }}
                />
              </div>
            ))}
          </div>

          <button
            onClick={handleRun}
            disabled={running || !url.trim()}
            className="flex items-center justify-center gap-2 rounded-md font-semibold text-white transition-opacity disabled:opacity-40"
            style={{ height: 36, background: "var(--color-accent)", fontSize: 13, alignSelf: "flex-start", padding: "0 20px" }}>
            {running ? <><Square size={13} /> Running…</> : <><Play size={13} /> Run Load Test</>}
          </button>
        </div>

        {/* Progress */}
        {running && progress && (
          <div className="flex flex-col gap-2 rounded-lg p-4" style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-center justify-between text-[12px]">
              <span style={{ color: "var(--color-fg-3)" }}>Progress</span>
              <span style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg)" }}>
                {progress.completed} / {progress.total} ({progress.errors} errors · {progress.rps.toFixed(1)} req/s · avg {progress.avgMs.toFixed(0)}ms)
              </span>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 6, background: "var(--color-bg)" }}>
              <div className="h-full transition-all rounded-full" style={{ width: `${progressPct}%`, background: "var(--color-accent)" }} />
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg p-3" style={{ background: "#EF444415", border: "1px solid #EF444430" }}>
            <AlertCircle size={14} style={{ color: "#EF4444", marginTop: 1, flexShrink: 0 }} />
            <span className="text-[12px]" style={{ color: "#EF4444" }}>{error}</span>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="flex flex-col gap-4">
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-fg-3)" }}>
              Results — {result.completed}/{result.total} completed · {result.errorRate.toFixed(1)}% errors · {result.durationSecs.toFixed(2)}s total
            </span>

            {/* Stat cards */}
            <div className="flex flex-wrap gap-2">
              <StatCard label="Min" value={`${result.minMs}ms`} color="#22C55E" />
              <StatCard label="Avg" value={`${result.avgMs.toFixed(0)}ms`} />
              <StatCard label="Median" value={`${result.p50Ms}ms`} />
              <StatCard label="P95" value={`${result.p95Ms}ms`} color={result.p95Ms > 1000 ? "#EF4444" : result.p95Ms > 500 ? "#F59E0B" : "var(--color-fg)"} />
              <StatCard label="P99" value={`${result.p99Ms}ms`} color={result.p99Ms > 2000 ? "#EF4444" : "var(--color-fg)"} />
              <StatCard label="Max" value={`${result.maxMs}ms`} color={result.maxMs > 2000 ? "#EF4444" : "var(--color-fg)"} />
              <StatCard label="Throughput" value={`${result.throughput.toFixed(1)}`} sub="req/s" color="var(--color-accent)" />
              <StatCard label="Errors" value={`${result.errors}`} color={result.errors > 0 ? "#EF4444" : "#22C55E"} />
            </div>

            {/* Histogram */}
            {result.latencies.length > 0 && (
              <div className="flex flex-col gap-2 rounded-lg p-4" style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
                <div className="flex items-center gap-2">
                  <TrendingUp size={12} style={{ color: "var(--color-fg-3)" }} />
                  <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-fg-3)" }}>Latency Distribution</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {buildHistogram(result.latencies).map(b => (
                    <div key={b.label} className="flex items-center gap-2">
                      <span className="text-[11px] shrink-0" style={{ width: 80, fontFamily: "Geist Mono, monospace", color: "var(--color-fg-3)", textAlign: "right" }}>{b.label}</span>
                      <div className="flex-1 rounded-sm overflow-hidden" style={{ height: 16, background: "var(--color-bg)" }}>
                        <div className="h-full rounded-sm transition-all" style={{ width: `${b.pct}%`, background: "var(--color-accent-50)", minWidth: b.count > 0 ? 4 : 0 }} />
                      </div>
                      <span className="text-[11px] shrink-0" style={{ width: 38, fontFamily: "Geist Mono, monospace", color: "var(--color-fg-4)", textAlign: "right" }}>{b.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!running && !result && !error && (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <div className="flex items-center justify-center rounded-full"
              style={{ width: 48, height: 48, background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
              <Zap size={22} style={{ color: "var(--color-accent)" }} />
            </div>
            <div className="flex flex-col items-center gap-1 text-center">
              <span className="text-[14px] font-semibold" style={{ color: "var(--color-fg-2)" }}>No test results yet</span>
              <span className="text-[12px]" style={{ color: "var(--color-fg-4)" }}>Configure a target and click Run to stress-test your API.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
