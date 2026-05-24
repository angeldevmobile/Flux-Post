import { useState } from "react";
import { Play, Plus, ChevronDown } from "lucide-react";

interface TestItem {
  id: string;
  label: string;
  status: "pass" | "fail" | "pending";
  detail?: string;
}

interface TestSuite {
  id: string;
  name: string;
  items: TestItem[];
  lastRun?: string;
}

const DEMO_SUITES: TestSuite[] = [
  {
    id: "auth",
    name: "Auth Suite",
    lastRun: "5 min ago",
    items: [
      { id: "1", label: "Response status should be 200", status: "pass" },
      { id: "2", label: "Response should have 'success: true'", status: "pass" },
      { id: "3", label: "Token should be present and non-empty", status: "pass" },
      { id: "4", label: "Token should expire in 24 hours", status: "fail", detail: 'Expected exp > now+86400, got: {"exp": 1704067200, "now": 1704153600}' },
      { id: "5", label: "User object should contain email and role", status: "pass" },
      { id: "6", label: "Response time should be under 500ms", status: "pass" },
    ],
  },
  { id: "users", name: "User's Suite", items: [], lastRun: "1 hour ago" },
  { id: "products", name: "Products Suite", items: [], lastRun: "3 hours ago" },
];

function SuiteItem({ suite, active, onClick }: { suite: TestSuite; active: boolean; onClick: () => void }) {
  const passed = suite.items.filter(i => i.status === "pass").length;
  const failed = suite.items.filter(i => i.status === "fail").length;

  return (
    <button onClick={onClick} className="flex flex-col gap-0.5 w-full px-3 py-2.5 transition-colors hover:bg-[#1A1A1A] text-left"
      style={{
        background: active ? "#1A1A1A" : "transparent",
        borderLeft: active ? "2px solid #A855F7" : "2px solid transparent",
      }}>
      <span className="text-[13px] font-medium" style={{ color: active ? "#E4E4E7" : "#A1A1AA" }}>{suite.name}</span>
      {suite.items.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px]" style={{ color: "#22C55E" }}>{passed} passed</span>
          {failed > 0 && <span className="text-[11px]" style={{ color: "#EF4444" }}>{failed} failed</span>}
        </div>
      )}
      {suite.lastRun && <span className="text-[11px] text-[#3F3F46]">{suite.lastRun}</span>}
    </button>
  );
}

function TestRow({ item }: { item: TestItem }) {
  const [expanded, setExpanded] = useState(false);
  const isPass = item.status === "pass";
  const isFail = item.status === "fail";

  return (
    <div className="rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 cursor-pointer select-none"
        onClick={() => item.detail && setExpanded(!expanded)}
        style={{
          height: 44,
          background: isPass ? "#0D150D" : isFail ? "#150D0D" : "#0F0F0F",
          border: `1px solid ${isPass ? "#22C55E30" : isFail ? "#EF444430" : "#1A1A1A"}`,
          borderRadius: expanded && item.detail ? "8px 8px 0 0" : 8,
        }}>
        {/* Status circle */}
        <div className="shrink-0 flex items-center justify-center"
          style={{
            width: 20, height: 20, borderRadius: 10,
            background: isPass ? "#22C55E" : isFail ? "#EF4444" : "#27272A",
          }}>
          {isPass && (
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {isFail && (
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M1 1L7 7M7 1L1 7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </div>

        <span className="flex-1 text-[12px]" style={{ color: isPass ? "#A1A1AA" : isFail ? "#FCA5A5" : "#71717A" }}>
          {item.label}
        </span>

        {/* Run badge */}
        <div className="flex items-center px-2 rounded shrink-0"
          style={{ height: 20, background: "#1A1A1A", border: "1px solid #27272A" }}>
          <span className="text-[10px] text-[#71717A]">Run</span>
        </div>

        {item.detail && (
          <ChevronDown size={13} className="text-[#71717A] transition-transform shrink-0 ml-1"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }} />
        )}
      </div>
      {expanded && item.detail && (
        <pre className="px-4 py-2.5 text-[11px] text-[#FCA5A5] rounded-b-lg"
          style={{ fontFamily: "Geist Mono, monospace", background: "#1A0808", border: "1px solid #EF444430", borderTop: "none" }}>
          {item.detail}
        </pre>
      )}
    </div>
  );
}

export function TestsRoute() {
  const [suites, setSuites] = useState<TestSuite[]>(DEMO_SUITES);
  const [activeId, setActiveId] = useState("auth");
  const active = suites.find(s => s.id === activeId)!;

  const passed = active.items.filter(i => i.status === "pass").length;
  const failed = active.items.filter(i => i.status === "fail").length;
  const skipped = active.items.filter(i => i.status === "pending").length;
  const total = active.items.length;

  function addSuite() {
    const id = `suite-${Date.now()}`;
    setSuites(prev => [...prev, { id, name: "New Suite", items: [] }]);
    setActiveId(id);
  }

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* Sidebar */}
      <aside className="flex flex-col shrink-0 h-full" style={{ width: 240, background: "#0F0F0F", borderRight: "1px solid #27272A" }}>
        <div className="flex items-center gap-2 px-3 shrink-0" style={{ height: 44, borderBottom: "1px solid #27272A" }}>
          <span className="flex-1 text-[12px] font-medium text-[#A1A1AA]">Test Suites</span>
          <button onClick={addSuite}
            className="flex items-center justify-center rounded"
            style={{ width: 24, height: 24, background: "#1A1A1A" }}>
            <Plus size={14} className="text-[#71717A]" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {suites.map(s => (
            <SuiteItem key={s.id} suite={s} active={activeId === s.id} onClick={() => setActiveId(s.id)} />
          ))}
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#0A0A0A" }}>
        {/* Suite header */}
        <div className="flex items-center gap-3 shrink-0 px-6" style={{ height: 56, borderBottom: "1px solid #27272A" }}>
          <div className="flex flex-col gap-0.5 flex-1">
            <h2 className="text-[16px] font-semibold text-white" style={{ fontFamily: "Geist, Inter, sans-serif" }}>{active.name}</h2>
            <span className="text-[12px] text-[#71717A]">
              {total} tests · Generated by AI{active.lastRun ? ` · Last run ${active.lastRun}` : ""}
            </span>
          </div>

          {total > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="flex items-center px-2 rounded text-[11px] font-semibold"
                style={{ height: 22, background: "#22C55E18", color: "#22C55E", border: "1px solid #22C55E40" }}>
                {passed} Passed
              </span>
              <span className="flex items-center px-2 rounded text-[11px] font-semibold"
                style={{ height: 22, background: "#EF444418", color: "#EF4444", border: "1px solid #EF444440" }}>
                {failed} Failed
              </span>
              <span className="flex items-center px-2 rounded text-[11px] font-semibold"
                style={{ height: 22, background: "#71717A18", color: "#71717A", border: "1px solid #71717A40" }}>
                {skipped} Skipped
              </span>
            </div>
          )}

          <button className="flex items-center gap-1.5 px-3 rounded-md text-[12px] font-semibold text-white transition-opacity hover:opacity-90 shrink-0"
            style={{ height: 32, background: "#A855F7" }}>
            <Play size={12} fill="white" /> Run All
          </button>
        </div>

        {/* Test list */}
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-2">
          {active.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <p className="text-[13px] text-[#71717A]">No tests in this suite</p>
              <p className="text-[12px] text-[#3F3F46]">Use AI Test Generator after sending a request to add tests</p>
            </div>
          ) : (
            active.items.map(item => <TestRow key={item.id} item={item} />)
          )}
        </div>
      </div>
    </div>
  );
}
