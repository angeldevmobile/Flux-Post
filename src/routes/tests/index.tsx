import { useState, useMemo } from "react";
import { Play, ChevronDown, Loader2 } from "lucide-react";
import { useCollectionsStore } from "@/stores/collections";
import { useEnvironmentStore } from "@/stores/environment";
import { sendRequest } from "@/lib/tauri";
import { evaluateAssertion, buildContext, type AssertionResult, type TestResult } from "@/lib/testRunner";
import type { HttpMethod } from "@/lib/tauri";

function buildUrl(baseUrl: string | undefined, path: string, resolveVariable: (v: string) => string): string {
  const base = resolveVariable(baseUrl ?? "");
  const p = resolveVariable(path);
  if (!base) return p;
  return base.replace(/\/$/, "") + (p.startsWith("/") ? p : `/${p}`);
}

function SuiteItem({ name, results, active, onClick }: {
  name: string;
  results: TestResult[] | null;
  active: boolean;
  onClick: () => void;
}) {
  const passed = results?.flatMap(r => r.assertions).filter(a => a.passed).length ?? 0;
  const failed = results?.flatMap(r => r.assertions).filter(a => !a.passed).length ?? 0;
  const total = results?.flatMap(r => r.assertions).length ?? 0;

  return (
    <button onClick={onClick} className="flex flex-col gap-0.5 w-full px-3 py-2.5 transition-colors text-left"
      style={{
        background: active ? "var(--color-card)" : "transparent",
        borderLeft: active ? "2px solid var(--color-accent)" : "2px solid transparent",
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "var(--color-card)"; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
      <span className="text-[13px] font-medium" style={{ color: active ? "var(--color-fg)" : "var(--color-fg-2)" }}>{name}</span>
      {results && total > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px]" style={{ color: "#22C55E" }}>{passed} passed</span>
          {failed > 0 && <span className="text-[11px]" style={{ color: "#EF4444" }}>{failed} failed</span>}
        </div>
      )}
      {!results && <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>Not run yet</span>}
    </button>
  );
}

function AssertionRow({ result }: { result: AssertionResult }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 cursor-pointer select-none"
        onClick={() => result.detail && setExpanded(v => !v)}
        style={{
          height: 44,
          background: result.passed ? "#0D150D" : "#150D0D",
          border: `1px solid ${result.passed ? "#22C55E30" : "#EF444430"}`,
          borderRadius: expanded && result.detail ? "8px 8px 0 0" : 8,
        }}>
        <div className="shrink-0 flex items-center justify-center"
          style={{ width: 20, height: 20, borderRadius: 10, background: result.passed ? "#22C55E" : "#EF4444" }}>
          {result.passed
            ? <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            : <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 1L7 7M7 1L1 7" stroke="white" strokeWidth="1.5" strokeLinecap="round" /></svg>}
        </div>
        <span className="flex-1 text-[12px]" style={{ color: result.passed ? "var(--color-fg-2)" : "#FCA5A5", fontFamily: "Geist Mono, monospace" }}>
          {result.assertion}
        </span>
        {result.detail && (
          <ChevronDown size={13} className="transition-transform shrink-0" style={{ color: "var(--color-fg-3)", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }} />
        )}
      </div>
      {expanded && result.detail && (
        <pre className="px-4 py-2.5 text-[11px] text-[#FCA5A5] rounded-b-lg"
          style={{ fontFamily: "Geist Mono, monospace", background: "#1A0808", border: "1px solid #EF444430", borderTop: "none" }}>
          {result.detail}
        </pre>
      )}
    </div>
  );
}

function RequestGroup({ result }: { result: TestResult }) {
  const passed = result.assertions.filter(a => a.passed).length;
  const failed = result.assertions.filter(a => !a.passed).length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[12px] font-semibold" style={{ color: "var(--color-fg)" }}>{result.requestName}</span>
        {result.error
          ? <span className="text-[11px] text-[#EF4444]">{result.error}</span>
          : <>
              <span className="text-[11px] text-[#22C55E]">{passed} passed</span>
              {failed > 0 && <span className="text-[11px] text-[#EF4444]">{failed} failed</span>}
              <span className="text-[11px] ml-auto" style={{ color: "var(--color-fg-4)" }}>{result.durationMs}ms</span>
            </>}
      </div>
      {result.assertions.map((a, i) => <AssertionRow key={i} result={a} />)}
    </div>
  );
}

export function TestsRoute() {
  const { collections } = useCollectionsStore();
  const { resolveVariable } = useEnvironmentStore();

  const suites = useMemo(() =>
    collections.filter(c => c.requests.some(r => r.tests && r.tests.length > 0)),
    [collections]
  );

  const [activeId, setActiveId] = useState<string | null>(suites[0]?.id ?? null);
  const [results, setResults] = useState<Record<string, TestResult[]>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});

  const activeCollection = suites.find(c => c.id === activeId);

  async function runSuite(collectionId: string) {
    const col = suites.find(c => c.id === collectionId);
    if (!col) return;

    setRunning(r => ({ ...r, [collectionId]: true }));
    const suiteResults: TestResult[] = [];

    for (const req of col.requests) {
      if (!req.tests || req.tests.length === 0) continue;

      const url = buildUrl(col.baseUrl, req.path, resolveVariable);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers ?? {})) {
        headers[k] = resolveVariable(v);
      }

      let result: TestResult;
      try {
        const resp = await sendRequest({
          method: req.method as HttpMethod,
          url,
          headers,
          body: req.body ? resolveVariable(req.body) : undefined,
        });
        const ctx = buildContext(resp.status, resp.body, resp.headers, resp.durationMs);
        result = {
          requestId: req.id,
          requestName: req.name,
          durationMs: resp.durationMs,
          assertions: req.tests.map(t => evaluateAssertion(t.assert, ctx)),
        };
      } catch (e) {
        result = {
          requestId: req.id,
          requestName: req.name,
          durationMs: 0,
          assertions: [],
          error: String(e),
        };
      }

      suiteResults.push(result);
    }

    setResults(r => ({ ...r, [collectionId]: suiteResults }));
    setRunning(r => ({ ...r, [collectionId]: false }));
  }

  const activeResults = activeId ? results[activeId] ?? null : null;
  const isRunning = activeId ? running[activeId] ?? false : false;

  const totalPassed = activeResults?.flatMap(r => r.assertions).filter(a => a.passed).length ?? 0;
  const totalFailed = activeResults?.flatMap(r => r.assertions).filter(a => !a.passed).length ?? 0;
  const totalTests = activeResults?.flatMap(r => r.assertions).length ?? 0;

  if (suites.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center h-full" style={{ background: "var(--color-bg)" }}>
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-[14px] font-medium" style={{ color: "var(--color-fg-3)" }}>No test suites found</p>
          <p className="text-[12px] max-w-xs" style={{ color: "var(--color-fg-4)" }}>
            Load a collections folder and add <code style={{ color: "var(--color-accent)" }}>tests:</code> assertions to your YAML requests.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* Sidebar */}
      <aside className="flex flex-col shrink-0 h-full" style={{ width: 240, background: "var(--color-sidebar)", borderRight: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-2 px-3 shrink-0" style={{ height: 44, borderBottom: "1px solid var(--color-border)" }}>
          <span className="flex-1 text-[12px] font-medium" style={{ color: "var(--color-fg-2)" }}>Test Suites</span>
          <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>{suites.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {suites.map(s => (
            <SuiteItem
              key={s.id}
              name={s.name}
              results={results[s.id] ?? null}
              active={activeId === s.id}
              onClick={() => setActiveId(s.id)}
            />
          ))}
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "var(--color-bg)" }}>
        {activeCollection && (
          <>
            <div className="flex items-center gap-3 shrink-0 px-6" style={{ height: 56, borderBottom: "1px solid var(--color-border)" }}>
              <div className="flex flex-col gap-0.5 flex-1">
                <h2 className="text-[16px] font-semibold" style={{ fontFamily: "Geist, Inter, sans-serif", color: "var(--color-fg)" }}>
                  {activeCollection.name}
                </h2>
                <span className="text-[12px]" style={{ color: "var(--color-fg-3)" }}>
                  {activeCollection.requests.filter(r => r.tests?.length).length} requests with tests
                  {activeResults && ` · ${totalTests} assertions`}
                </span>
              </div>

              {activeResults && totalTests > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="flex items-center px-2 rounded text-[11px] font-semibold"
                    style={{ height: 22, background: "#22C55E18", color: "#22C55E", border: "1px solid #22C55E40" }}>
                    {totalPassed} Passed
                  </span>
                  <span className="flex items-center px-2 rounded text-[11px] font-semibold"
                    style={{ height: 22, background: "#EF444418", color: "#EF4444", border: "1px solid #EF444440" }}>
                    {totalFailed} Failed
                  </span>
                </div>
              )}

              <button
                onClick={() => activeId && runSuite(activeId)}
                disabled={isRunning}
                className="flex items-center gap-1.5 px-4 rounded-md text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 shrink-0"
                style={{ height: 32, background: "var(--color-accent)" }}>
                {isRunning
                  ? <><Loader2 size={13} className="animate-spin" /> Running...</>
                  : <><Play size={12} fill="white" /> Run All</>}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
              {!activeResults && !isRunning && (
                <div className="flex flex-col items-center justify-center h-full gap-2">
                  <p className="text-[13px]" style={{ color: "var(--color-fg-3)" }}>Press Run All to execute the test suite</p>
                </div>
              )}
              {isRunning && (
                <div className="flex items-center justify-center h-full gap-2">
                  <Loader2 size={18} className="animate-spin" style={{ color: "var(--color-accent)" }} />
                  <span className="text-[13px]" style={{ color: "var(--color-fg-3)" }}>Running tests...</span>
                </div>
              )}
              {activeResults && !isRunning && activeResults.map(r => (
                <RequestGroup key={r.requestId} result={r} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
