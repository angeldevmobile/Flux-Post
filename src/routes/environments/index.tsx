import { useState } from "react";
import { Plus, Edit2, Check, X } from "lucide-react";
import { useEnvironmentStore } from "@/stores/environment";

const DEMO_VARS = {
  BASE_URL:    "https://api.dev.myapp.com",
  API_KEY:     "sk-dev-xxxxxxxxxxxx",
  AUTH_TOKEN:  "",
  TIMEOUT_MS:  "5000",
  DEBUG_MODE:  "false",
  RATE_LIMIT:  "100",
  WEBHOOK_URL: "",
};

function EnvSidebar() {
  const { environments, activeId, setActive, addEnvironment } = useEnvironmentStore();

  function createNew() {
    const id = `env-${Date.now()}`;
    addEnvironment({ id, name: "New Environment", variables: {} });
    setActive(id);
  }

  return (
    <aside className="flex flex-col shrink-0 h-full"
      style={{ width: 240, background: "var(--color-sidebar)", borderRight: "1px solid var(--color-border)" }}>
      <div className="flex items-center gap-2 shrink-0 px-3"
        style={{ height: 44, borderBottom: "1px solid var(--color-border)" }}>
        <span className="flex-1 text-[12px] font-medium" style={{ color: "var(--color-fg-2)" }}>Environments</span>
        <button onClick={createNew}
          className="flex items-center justify-center rounded"
          style={{ width: 24, height: 24, background: "var(--color-card)" }}>
          <Plus size={14} style={{ color: "var(--color-fg-3)" }} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {environments.map(env => (
          <button key={env.id} onClick={() => setActive(env.id)}
            className="flex items-center gap-2 w-full px-3 transition-colors"
            style={{
              height: 40,
              background: activeId === env.id ? "var(--color-card)" : "transparent",
              borderLeft: activeId === env.id ? "2px solid var(--color-accent)" : "2px solid transparent",
            }}
            onMouseEnter={e => { if (activeId !== env.id) (e.currentTarget as HTMLElement).style.background = "var(--color-card)"; }}
            onMouseLeave={e => { if (activeId !== env.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22C55E", flexShrink: 0 }} />
            <span className="flex-1 text-left text-[13px] truncate" style={{ color: "var(--color-fg-2)" }}>{env.name}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="relative shrink-0 transition-colors"
      style={{ width: 36, height: 20, borderRadius: 10, background: checked ? "var(--color-accent)" : "var(--color-border)" }}>
      <span className="absolute top-0.5 transition-all"
        style={{ width: 16, height: 16, borderRadius: "50%", background: "#FFF", left: checked ? 18 : 2 }} />
    </button>
  );
}

function EnvContent() {
  const { environments, activeId, updateEnvironment, addEnvironment, setActive } = useEnvironmentStore();
  const env = environments.find(e => e.id === activeId);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState("");
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});

  if (!env) {
    if (environments.length === 0) {
      const id = "development";
      addEnvironment({ id, name: "Development", variables: DEMO_VARS });
      setActive(id);
    } else {
      setActive(environments[0].id);
    }
    return null;
  }

  const vars = env.variables;
  const varCount = Object.keys(vars).length;

  function addVar() {
    const key = `NEW_VAR_${Date.now()}`;
    updateEnvironment(env!.id, { variables: { ...vars, [key]: "" } });
    setEnabled(prev => ({ ...prev, [key]: true }));
  }

  function updateKey(oldKey: string, newKey: string) {
    if (oldKey === newKey) return;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(vars)) {
      next[k === oldKey ? newKey : k] = v;
    }
    updateEnvironment(env!.id, { variables: next });
  }

  function updateVal(key: string, val: string) {
    updateEnvironment(env!.id, { variables: { ...vars, [key]: val } });
  }

  function isEnabled(key: string) { return enabled[key] !== false; }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "var(--color-bg)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0 px-6"
        style={{ height: 56, borderBottom: "1px solid var(--color-border)" }}>
        <div className="flex flex-col gap-0.5 flex-1">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input value={nameVal} onChange={e => setNameVal(e.target.value)} autoFocus
                onKeyDown={e => { if (e.key === "Enter") { updateEnvironment(env.id, { name: nameVal }); setEditingName(false); } }}
                className="text-[16px] font-semibold px-2 py-0.5 rounded"
                style={{ background: "var(--color-card)", border: "1px solid var(--color-accent)", color: "var(--color-fg)", fontFamily: "Geist, Inter, sans-serif" }} />
              <button onClick={() => { updateEnvironment(env.id, { name: nameVal }); setEditingName(false); }}><Check size={14} className="text-green" /></button>
              <button onClick={() => setEditingName(false)}><X size={14} style={{ color: "var(--color-fg-3)" }} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] font-semibold" style={{ fontFamily: "Geist, Inter, sans-serif", color: "var(--color-fg)" }}>{env.name}</h2>
              <button onClick={() => { setNameVal(env.name); setEditingName(true); }}><Edit2 size={13} style={{ color: "var(--color-fg-3)" }} /></button>
            </div>
          )}
          <span className="text-[12px]" style={{ color: "var(--color-fg-3)" }}>{varCount} variables · Last edited 2 hours ago</span>
        </div>
        {/* Active badge */}
        <div className="flex items-center gap-1.5 px-2.5 rounded"
          style={{ height: 24, background: "#22C55E18" }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: "#22C55E" }} />
          <span className="text-[11px] font-medium text-green">Active</span>
        </div>
        {/* Add variable */}
        <button onClick={addVar}
          className="flex items-center gap-1.5 px-3 rounded-md text-[12px] transition-opacity hover:opacity-80"
          style={{ height: 32, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)" }}>
          <Plus size={14} style={{ color: "var(--color-fg-2)" }} /> Add Variable
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)", background: "var(--color-elevated)" }}>
          {/* Column headers */}
          <div className="flex items-center px-4 text-[11px] font-medium"
            style={{ height: 36, background: "var(--color-topbar)", borderBottom: "1px solid var(--color-border)", color: "var(--color-fg-4)" }}>
            <span style={{ width: 200 }}>Variable</span>
            <span style={{ flex: 1 }}>Value</span>
            <span style={{ width: 200 }}>Initial Value</span>
            <span style={{ width: 80 }}>Enabled</span>
          </div>

          {Object.entries(vars).map(([key, value], i) => (
            <div key={key} className="flex items-center px-4"
              style={{ height: 44, background: i % 2 === 0 ? "transparent" : "var(--color-sidebar)", borderBottom: "1px solid var(--color-card)" }}>
              <div style={{ width: 200 }}>
                <input defaultValue={key}
                  onBlur={e => updateKey(key, e.target.value)}
                  className="w-full text-[12px] bg-transparent"
                  style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }} />
              </div>
              <div style={{ flex: 1, paddingRight: 16 }}>
                <input defaultValue={value}
                  onBlur={e => updateVal(key, e.target.value)}
                  className="w-full text-[12px] bg-transparent"
                  style={{ color: "var(--color-fg-2)", fontFamily: "Geist Mono, monospace" }} />
              </div>
              <div style={{ width: 200 }}>
                <span className="text-[12px]" style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg-4)" }}>
                  {value || "—"}
                </span>
              </div>
              <div style={{ width: 80 }}>
                <Toggle checked={isEnabled(key)} onChange={v => setEnabled(prev => ({ ...prev, [key]: v }))} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function EnvironmentsRoute() {
  return (
    <div className="flex flex-1 h-full overflow-hidden">
      <EnvSidebar />
      <EnvContent />
    </div>
  );
}
