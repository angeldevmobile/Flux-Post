import { useState, useMemo } from "react";
import { useAiAvailable } from "@/lib/aiAvailable";
import { Play, ChevronDown, Loader2, Sparkles, X, FlaskConical } from "lucide-react";
import { useCollectionsStore } from "@/stores/collections";
import { useEnvironmentStore } from "@/stores/environment";
import { sendRequest, analyzeTestFailures } from "@/lib/tauri";
import { handleQuotaError } from "@/lib/aiError";
import { networkOptions } from "@/lib/networkOptions";
import { useSettingsStore } from "@/stores/settings";
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
  const { claudeApiKey, claudeModel } = useSettingsStore();
  const aiAvailable = useAiAvailable();

  const suites = useMemo(() =>
    collections.filter(c => c.requests.some(r => r.tests && r.tests.length > 0)),
    [collections]
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TestResult[]>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);

  const effectiveActiveId = (activeId && suites.find(s => s.id === activeId))
    ? activeId
    : (suites[0]?.id ?? null);
  const activeCollection = suites.find(c => c.id === effectiveActiveId);

  async function runSuite(collectionId: string) {
    const col = suites.find(c => c.id === collectionId);
    if (!col) return;

    setAnalysisResult(null);
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
          ...networkOptions(),
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

  async function handleAnalyze() {
    if (!activeResults || !aiAvailable) return;
    const failures = activeResults.flatMap(r =>
      r.assertions
        .filter(a => !a.passed)
        .map(a => ({ request: r.requestName, assertion: a.assertion, detail: a.detail ?? "" }))
    );
    if (failures.length === 0) return;
    setAnalyzing(true);
    setAnalysisResult(null);
    try {
      const result = await analyzeTestFailures(JSON.stringify(failures, null, 2), claudeApiKey, claudeModel);
      setAnalysisResult(result);
    } catch (e) {
      if (!handleQuotaError(e)) setAnalysisResult(`Error: ${e}`);
    } finally {
      setAnalyzing(false);
    }
  }

  const activeResults = effectiveActiveId ? results[effectiveActiveId] ?? null : null;
  const isRunning = effectiveActiveId ? running[effectiveActiveId] ?? false : false;

  const totalPassed = activeResults?.flatMap(r => r.assertions).filter(a => a.passed).length ?? 0;
  const totalFailed = activeResults?.flatMap(r => r.assertions).filter(a => !a.passed).length ?? 0;
  const totalTests = activeResults?.flatMap(r => r.assertions).length ?? 0;

  if (suites.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center h-full" style={{ background: "var(--color-bg)" }}>
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex items-center justify-center rounded-full"
            style={{ width: 48, height: 48, background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
            <FlaskConical size={22} style={{ color: "var(--color-fg-4)" }} />
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <p className="text-[14px] font-semibold" style={{ color: "var(--color-fg-2)" }}>No test suites yet</p>
            <p className="text-[12px] max-w-65" style={{ color: "var(--color-fg-4)", lineHeight: 1.6 }}>
              Load a collections folder and add{" "}
              <code style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>tests:</code>{" "}
              assertions to your requests. Each collection with tests becomes a suite here.
            </p>
          </div>
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
              active={effectiveActiveId === s.id}
              onClick={() => setActiveId(s.id)}
            />
          ))}
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "var(--color-bg)" }}>
        {activeCollection && (
          <>
            {/* Header */}
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

              {/* Analyze failures button — visible when there are failures and API key is set */}
              {activeResults && totalFailed > 0 && aiAvailable && (
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="flex items-center gap-1.5 px-3 rounded-md text-[12px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 shrink-0"
                  style={{ height: 32, background: "var(--color-accent-10)", border: "1px solid var(--color-accent-20)", color: "var(--color-accent)" }}>
                  {analyzing
                    ? <><Loader2 size={12} className="animate-spin" /> Analyzing…</>
                    : <><Sparkles size={12} /> Analyze failures</>}
                </button>
              )}

              <button
                onClick={() => effectiveActiveId && runSuite(effectiveActiveId)}
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

              {/* AI analysis result */}
              {analysisResult && !isRunning && (
                <div className="rounded-lg overflow-hidden shrink-0" style={{ border: "1px solid var(--color-accent-20)" }}>
                  <div className="flex items-center gap-2 px-4" style={{ height: 36, background: "var(--color-accent-10)", borderBottom: "1px solid var(--color-accent-20)" }}>
                    <Sparkles size={13} style={{ color: "var(--color-accent)" }} />
                    <span className="flex-1 text-[12px] font-semibold" style={{ color: "var(--color-accent)" }}>AI Analysis</span>
                    <button onClick={() => setAnalysisResult(null)} style={{ color: "var(--color-fg-4)" }} className="hover:opacity-60 transition-opacity">
                      <X size={13} />
                    </button>
                  </div>
                  <div className="px-4 py-3">
                    <pre className="text-[12px] whitespace-pre-wrap" style={{ color: "var(--color-fg-2)", fontFamily: "Geist, Inter, sans-serif", lineHeight: 1.6 }}>
                      {analysisResult}
                    </pre>
                  </div>
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
