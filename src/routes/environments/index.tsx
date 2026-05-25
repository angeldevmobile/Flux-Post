import { useState } from "react";
import { Plus, Edit2, Check, X, Eye, EyeOff, Trash2, Globe } from "lucide-react";
import { useEnvironmentStore } from "@/stores/environment";

const DEMO_VARS: Record<string, string> = {
  BASE_URL:    "https://api.dev.myapp.com",
  API_KEY:     "sk-dev-xxxxxxxxxxxx",
  AUTH_TOKEN:  "",
  TIMEOUT_MS:  "5000",
  DEBUG_MODE:  "false",
};

function EnvSidebar({ tab, onTab }: { tab: "env" | "global"; onTab: (t: "env" | "global") => void }) {
  const { environments, activeId, setActive, addEnvironment } = useEnvironmentStore();

  function createNew() {
    const id = `env-${Date.now()}`;
    addEnvironment({ id, name: "New Environment", variables: {} });
    setActive(id);
    onTab("env");
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

      {/* Global Variables entry */}
      <button onClick={() => onTab("global")}
        className="flex items-center gap-2 w-full px-3 transition-colors"
        style={{
          height: 40,
          background: tab === "global" ? "var(--color-card)" : "transparent",
          borderLeft: tab === "global" ? "2px solid var(--color-accent)" : "2px solid transparent",
        }}
        onMouseEnter={e => { if (tab !== "global") e.currentTarget.style.background = "var(--color-card)"; }}
        onMouseLeave={e => { if (tab !== "global") e.currentTarget.style.background = "transparent"; }}>
        <Globe size={13} style={{ color: "var(--color-accent)", flexShrink: 0 }} />
        <span className="flex-1 text-left text-[13px] truncate" style={{ color: "var(--color-fg-2)" }}>Global Variables</span>
      </button>

      <div style={{ height: 1, background: "var(--color-border)" }} />

      <div className="flex-1 overflow-y-auto py-1">
        {environments.map(env => (
          <button key={env.id} onClick={() => { setActive(env.id); onTab("env"); }}
            className="flex items-center gap-2 w-full px-3 transition-colors"
            style={{
              height: 40,
              background: tab === "env" && activeId === env.id ? "var(--color-card)" : "transparent",
              borderLeft: tab === "env" && activeId === env.id ? "2px solid var(--color-accent)" : "2px solid transparent",
            }}
            onMouseEnter={e => { if (!(tab === "env" && activeId === env.id)) e.currentTarget.style.background = "var(--color-card)"; }}
            onMouseLeave={e => { if (!(tab === "env" && activeId === env.id)) e.currentTarget.style.background = "transparent"; }}>
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

// ── Variable row ─────────────────────────────────────────────────────────────

function VarRow({
  varKey, value, isSecret, isEnabled,
  onKeyChange, onValChange, onToggleSecret, onToggleEnabled, onDelete,
  rowIdx,
}: {
  varKey: string; value: string; isSecret: boolean; isEnabled: boolean;
  onKeyChange: (k: string) => void; onValChange: (v: string) => void;
  onToggleSecret: () => void; onToggleEnabled: (v: boolean) => void; onDelete: () => void;
  rowIdx: number;
}) {
  const [showSecret, setShowSecret] = useState(false);

  return (
    <div className="group/row flex items-center px-4"
      style={{ height: 44, background: rowIdx % 2 === 0 ? "transparent" : "var(--color-sidebar)", borderBottom: "1px solid var(--color-card)" }}>
      {/* Key */}
      <div style={{ width: 200 }}>
        <input defaultValue={varKey}
          onBlur={e => onKeyChange(e.target.value)}
          className="w-full text-[12px] bg-transparent"
          style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }} />
      </div>

      {/* Value */}
      <div style={{ flex: 1, paddingRight: 16 }}>
        {isSecret && !showSecret ? (
          <span className="text-[12px]" style={{ color: "var(--color-fg-3)", fontFamily: "Geist Mono, monospace" }}>••••••••</span>
        ) : (
          <input defaultValue={value}
            onBlur={e => onValChange(e.target.value)}
            className="w-full text-[12px] bg-transparent"
            style={{ color: "var(--color-fg-2)", fontFamily: "Geist Mono, monospace" }} />
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2" style={{ width: 110 }}>
        {/* Secret toggle */}
        <button onClick={() => { onToggleSecret(); setShowSecret(false); }} title={isSecret ? "Unmark secret" : "Mark as secret"}
          className="flex items-center justify-center rounded transition-colors"
          style={{ width: 22, height: 22, color: isSecret ? "var(--color-accent)" : "var(--color-fg-4)" }}
          onMouseEnter={e => (e.currentTarget.style.background = "var(--color-card)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
          {isSecret ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>

        {/* Show/hide value when secret */}
        {isSecret && (
          <button onClick={() => setShowSecret(v => !v)} title={showSecret ? "Hide" : "Reveal"}
            className="flex items-center justify-center rounded transition-colors"
            style={{ width: 22, height: 22, color: "var(--color-fg-3)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--color-card)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            {showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        )}

        {/* Enabled toggle */}
        <Toggle checked={isEnabled} onChange={onToggleEnabled} />

        {/* Delete */}
        <button onClick={onDelete} title="Delete variable"
          className="flex items-center justify-center rounded opacity-0 group-hover/row:opacity-100 transition-opacity"
          style={{ width: 22, height: 22, color: "#EF4444" }}
          onMouseEnter={e => (e.currentTarget.style.background = "#EF444415")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Environment Variables panel ───────────────────────────────────────────────

function EnvContent() {
  const { environments, activeId, updateEnvironment, addEnvironment, setActive, toggleSecretKey, deleteEnvironment } = useEnvironmentStore();
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
  const secretKeys = env.secretKeys ?? [];

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
    const nextSecrets = secretKeys.map(k => k === oldKey ? newKey : k);
    updateEnvironment(env!.id, { variables: next, secretKeys: nextSecrets });
  }

  function updateVal(key: string, val: string) {
    updateEnvironment(env!.id, { variables: { ...vars, [key]: val } });
  }

  function deleteVar(key: string) {
    const next = { ...vars };
    delete next[key];
    updateEnvironment(env!.id, { variables: next, secretKeys: secretKeys.filter(k => k !== key) });
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
          <span className="text-[12px]" style={{ color: "var(--color-fg-3)" }}>
            {Object.keys(vars).length} variables
            {secretKeys.length > 0 && ` · ${secretKeys.length} secret`}
          </span>
        </div>
        <button onClick={() => deleteEnvironment(env.id)} title="Delete environment"
          className="flex items-center justify-center rounded transition-colors"
          style={{ width: 28, height: 28, color: "var(--color-fg-4)" }}
          onMouseEnter={e => { e.currentTarget.style.color = "#EF4444"; e.currentTarget.style.background = "#EF444415"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "var(--color-fg-4)"; e.currentTarget.style.background = "transparent"; }}>
          <Trash2 size={14} />
        </button>
        <button onClick={addVar}
          className="flex items-center gap-1.5 px-3 rounded-md text-[12px] transition-opacity hover:opacity-80"
          style={{ height: 32, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)" }}>
          <Plus size={14} /> Add Variable
        </button>
      </div>

      {/* Built-in hint */}
      <div className="px-6 py-2 text-[11px]" style={{ color: "var(--color-fg-4)", borderBottom: "1px solid var(--color-border)", background: "var(--color-topbar)" }}>
        Dynamic built-ins: <code style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-accent)" }}>{"{{$guid}}"}</code>
        {" · "}<code style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-accent)" }}>{"{{$timestamp}}"}</code>
        {" · "}<code style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-accent)" }}>{"{{$isoTimestamp}}"}</code>
        {" · "}<code style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-accent)" }}>{"{{$randomInt}}"}</code>
        {" — evaluated at send time"}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)", background: "var(--color-elevated)" }}>
          <div className="flex items-center px-4 text-[11px] font-medium"
            style={{ height: 36, background: "var(--color-topbar)", borderBottom: "1px solid var(--color-border)", color: "var(--color-fg-4)" }}>
            <span style={{ width: 200 }}>Variable</span>
            <span style={{ flex: 1 }}>Value</span>
            <span style={{ width: 110 }}>Secret · Enabled</span>
          </div>

          {Object.entries(vars).map(([key, value], i) => (
            <VarRow
              key={key}
              varKey={key}
              value={value}
              isSecret={secretKeys.includes(key)}
              isEnabled={isEnabled(key)}
              onKeyChange={newKey => updateKey(key, newKey)}
              onValChange={val => updateVal(key, val)}
              onToggleSecret={() => toggleSecretKey(env.id, key)}
              onToggleEnabled={v => setEnabled(prev => ({ ...prev, [key]: v }))}
              onDelete={() => deleteVar(key)}
              rowIdx={i}
            />
          ))}

          {Object.keys(vars).length === 0 && (
            <div className="flex items-center justify-center py-10">
              <button onClick={addVar} className="text-[12px] transition-opacity hover:opacity-70"
                style={{ color: "var(--color-accent)" }}>
                + Add your first variable
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Global Variables panel ────────────────────────────────────────────────────

function GlobalContent() {
  const { globalVariables, globalSecretKeys, setGlobalVariable, deleteGlobalVariable, toggleGlobalSecretKey } = useEnvironmentStore();
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});

  function addVar() {
    const key = `GLOBAL_VAR_${Date.now()}`;
    setGlobalVariable(key, "");
    setEnabled(prev => ({ ...prev, [key]: true }));
  }

  function updateKey(oldKey: string, newKey: string) {
    if (oldKey === newKey) return;
    const val = globalVariables[oldKey] ?? "";
    const wasSecret = globalSecretKeys.includes(oldKey);
    deleteGlobalVariable(oldKey);
    setGlobalVariable(newKey, val);
    if (wasSecret) toggleGlobalSecretKey(newKey);
  }

  function isEnabled(key: string) { return enabled[key] !== false; }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "var(--color-bg)" }}>
      <div className="flex items-center gap-3 shrink-0 px-6"
        style={{ height: 56, borderBottom: "1px solid var(--color-border)" }}>
        <Globe size={16} style={{ color: "var(--color-accent)" }} />
        <div className="flex flex-col gap-0.5 flex-1">
          <h2 className="text-[16px] font-semibold" style={{ fontFamily: "Geist, Inter, sans-serif", color: "var(--color-fg)" }}>Global Variables</h2>
          <span className="text-[12px]" style={{ color: "var(--color-fg-3)" }}>
            Available across all environments · {Object.keys(globalVariables).length} variables
          </span>
        </div>
        <button onClick={addVar}
          className="flex items-center gap-1.5 px-3 rounded-md text-[12px] transition-opacity hover:opacity-80"
          style={{ height: 32, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)" }}>
          <Plus size={14} /> Add Variable
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)", background: "var(--color-elevated)" }}>
          <div className="flex items-center px-4 text-[11px] font-medium"
            style={{ height: 36, background: "var(--color-topbar)", borderBottom: "1px solid var(--color-border)", color: "var(--color-fg-4)" }}>
            <span style={{ width: 200 }}>Variable</span>
            <span style={{ flex: 1 }}>Value</span>
            <span style={{ width: 110 }}>Secret · Enabled</span>
          </div>

          {Object.entries(globalVariables).map(([key, value], i) => (
            <VarRow
              key={key}
              varKey={key}
              value={value}
              isSecret={globalSecretKeys.includes(key)}
              isEnabled={isEnabled(key)}
              onKeyChange={newKey => updateKey(key, newKey)}
              onValChange={val => setGlobalVariable(key, val)}
              onToggleSecret={() => toggleGlobalSecretKey(key)}
              onToggleEnabled={v => setEnabled(prev => ({ ...prev, [key]: v }))}
              onDelete={() => deleteGlobalVariable(key)}
              rowIdx={i}
            />
          ))}

          {Object.keys(globalVariables).length === 0 && (
            <div className="flex items-center justify-center py-10">
              <button onClick={addVar} className="text-[12px] transition-opacity hover:opacity-70"
                style={{ color: "var(--color-accent)" }}>
                + Add your first global variable
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Route ─────────────────────────────────────────────────────────────────────

export function EnvironmentsRoute() {
  const [tab, setTab] = useState<"env" | "global">("env");

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      <EnvSidebar tab={tab} onTab={setTab} />
      {tab === "global" ? <GlobalContent /> : <EnvContent />}
    </div>
  );
}
