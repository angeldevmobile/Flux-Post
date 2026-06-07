import { useState, useEffect, useRef } from "react";
import {
  Settings2, Sparkles, Palette, Keyboard, Network, Shield, Info,
  ChevronDown, EyeOff, Eye, Download, History, LogOut, Trash2, TriangleAlert,
  ExternalLink, Check, ClipboardPaste, X, FileUp, Play, Cookie, Terminal, GitBranch,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settings";
import { clearHistory, getHistory, exportDataAsJson, getAllCookies, deleteCookie, clearCookies, type CookieEntry } from "@/lib/tauri";

type Section = "general" | "ai" | "appearance" | "keyboard" | "proxy" | "cookies" | "privacy" | "cli" | "github" | "about";

const SECTIONS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "general",    label: "General",        icon: Settings2 },
  { id: "ai",         label: "AI & Claude",     icon: Sparkles  },
  { id: "appearance", label: "Appearance",      icon: Palette   },
  { id: "keyboard",   label: "Keyboard",        icon: Keyboard  },
  { id: "proxy",      label: "Proxy & Network", icon: Network   },
  { id: "cookies",    label: "Cookie Jar",      icon: Cookie    },
  { id: "privacy",    label: "Data & Privacy",  icon: Shield    },
  { id: "cli",        label: "CLI Tools",        icon: Terminal  },
  { id: "github",     label: "GitHub",           icon: GitBranch },
  { id: "about",      label: "About",            icon: Info      },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="relative shrink-0 transition-colors"
      style={{ width: 36, height: 20, borderRadius: 10, background: checked ? "var(--color-accent)" : "var(--color-border)" }}>
      <span className="absolute top-0.5 transition-all"
        style={{ width: 16, height: 16, borderRadius: "50%", background: "#FFF", left: checked ? 18 : 2 }} />
    </button>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ background: "var(--color-elevated)", border: "1px solid var(--color-border)" }}>
      <div className="flex items-center px-4" style={{ height: 40, background: "var(--color-topbar)", borderBottom: "1px solid var(--color-border)" }}>
        <span className="text-[12px] font-semibold" style={{ color: "var(--color-fg-2)" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function SettingRow({ label, description, last, children }: {
  label: string; description?: string; last?: boolean; children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-4 px-4"
      style={{ height: description ? 56 : 52, borderBottom: last ? "none" : "1px solid var(--color-border)" }}>
      <div className="flex flex-col gap-0.5 flex-1">
        <span className="text-[13px] font-medium" style={{ color: "var(--color-fg)" }}>{label}</span>
        {description && <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>{description}</span>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function KbdKey({ children }: { children: string }) {
  return (
    <div className="flex items-center justify-center px-2 rounded"
      style={{ height: 24, background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
      <span className="text-[11px] font-medium" style={{ color: "var(--color-fg-2)", fontFamily: "Geist Mono, monospace" }}>{children}</span>
    </div>
  );
}

function ShortcutRow({ label, keys, last }: { label: string; keys: string[]; last?: boolean }) {
  return (
    <div className="flex items-center gap-4 px-4"
      style={{ height: 48, borderBottom: last ? "none" : "1px solid var(--color-card)" }}>
      <span className="flex-1 text-[13px]" style={{ color: "var(--color-fg)" }}>{label}</span>
      <div className="flex items-center gap-1 shrink-0">
        {keys.map((k, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>+</span>}
            <KbdKey>{k}</KbdKey>
          </span>
        ))}
      </div>
    </div>
  );
}

/*     SECTIONS     */

function GeneralSection() {
  const s = useSettingsStore();
  const [timeoutInput, setTimeoutInput] = useState(String(s.timeoutMs));

  function commitTimeout() {
    const n = parseInt(timeoutInput, 10);
    if (!isNaN(n) && n > 0) s.setTimeoutMs(n);
    else setTimeoutInput(String(s.timeoutMs));
  }

  return (
    <div className="flex flex-col gap-6">
      <Card title="Request Defaults">
        <SettingRow label="Default Timeout" description="Time in ms before a request is cancelled">
          <input
            value={timeoutInput}
            onChange={e => setTimeoutInput(e.target.value)}
            onBlur={commitTimeout}
            onKeyDown={e => e.key === "Enter" && commitTimeout()}
            className="h-8 px-3 rounded-md text-[12px] text-right"
            style={{ background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)", width: 180, fontFamily: "Geist Mono, monospace" }} />
        </SettingRow>
        <SettingRow label="Follow Redirects" description="Automatically follow HTTP redirects">
          <Toggle checked={s.followRedirects} onChange={s.setFollowRedirects} />
        </SettingRow>
        <SettingRow label="SSL Verification" description="Verify SSL certificates on requests" last>
          <Toggle checked={s.sslVerify} onChange={s.setSslVerify} />
        </SettingRow>
      </Card>
      <Card title="Onboarding">
        <SettingRow label="Launch Tour" description="Replay the getting-started walkthrough" last>
          <button
            onClick={() => s.setTourSeen(false)}
            className="flex items-center gap-1.5 px-3 rounded-md text-[12px] font-medium transition-opacity hover:opacity-80"
            style={{ height: 32, background: "var(--color-accent-10)", border: "1px solid var(--color-accent-20)", color: "var(--color-accent)" }}
          >
            <Play size={12} />
            Launch Tour
          </button>
        </SettingRow>
      </Card>
    </div>
  );
}

const MODELS = [
  { id: "claude-sonnet-4-6",       label: "claude-sonnet-4-6", badge: "Recommended", accent: true },
  { id: "claude-opus-4-7",         label: "claude-opus-4-7",   badge: "Most capable", accent: false },
  { id: "claude-haiku-4-5-20251001", label: "claude-haiku-4-5", badge: "Fastest",     accent: false },
];

function AiSection() {
  const s = useSettingsStore();
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tokenLimit = 100000;
  const tokenPct = Math.min(100, (s.tokensUsed / tokenLimit) * 100).toFixed(1);

  function handleKeyChange(val: string) {
    s.setClaudeApiKey(val);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    if (val) {
      setSaved(true);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
    } else {
      setSaved(false);
    }
  }

  async function handlePaste() {
    const text = await navigator.clipboard.readText();
    if (text.startsWith("sk-ant-")) handleKeyChange(text.trim());
  }

  async function openAnthropicConsole() {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl("https://console.anthropic.com/account/keys");
  }

  return (
    <div className="flex flex-col gap-6">
      <Card title="API Configuration">
        {/* Info callout */}
        <div className="flex items-start gap-3 mx-4 mt-4 mb-2 px-3 py-3 rounded-lg"
          style={{ background: "var(--color-accent-10)", border: "1px solid var(--color-accent-20)" }}>
          <Sparkles size={14} style={{ color: "var(--color-accent)", flexShrink: 0, marginTop: 1 }} />
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium" style={{ color: "var(--color-fg)" }}>
              Your API key is stored locally on this device
            </span>
            <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>
              It's never sent to our servers, only directly to Anthropic to power AI features like test generation, debug assist, and body editing.
            </span>
            <button onClick={openAnthropicConsole}
              className="flex items-center gap-1 mt-1 self-start transition-opacity hover:opacity-70"
              style={{ color: "var(--color-accent)", fontSize: 11 }}>
              <ExternalLink size={11} />
              Get your API key at console.anthropic.com
            </button>
          </div>
        </div>

        {/* Key input */}
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-[13px] font-medium" style={{ color: "var(--color-fg)" }}>Claude API Key</span>
            <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>Starts with <span style={{ fontFamily: "Geist Mono, monospace" }}>sk-ant-</span></span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saved && (
              <div className="flex items-center gap-1 px-2 rounded"
                style={{ height: 24, background: "#22C55E15", border: "1px solid #22C55E30" }}>
                <Check size={11} style={{ color: "#22C55E" }} />
                <span className="text-[11px]" style={{ color: "#22C55E" }}>Saved</span>
              </div>
            )}
            <div className="flex items-center gap-2 px-3 rounded-md"
              style={{ height: 36, width: 260, background: "var(--color-input)", border: `1px solid ${s.claudeApiKey ? "var(--color-accent-50)" : "var(--color-border)"}` }}>
              <input
                type={showKey ? "text" : "password"}
                value={s.claudeApiKey}
                onChange={e => handleKeyChange(e.target.value)}
                placeholder="sk-ant-••••••••••••••••"
                className="flex-1 text-[12px] bg-transparent"
                style={{ color: s.claudeApiKey ? "var(--color-fg-2)" : "var(--color-fg-3)", fontFamily: "Geist Mono, monospace" }}
              />
              <button onClick={() => setShowKey(v => !v)} className="shrink-0 hover:opacity-70 transition-opacity">
                {showKey
                  ? <Eye size={13} style={{ color: "var(--color-fg-4)" }} />
                  : <EyeOff size={13} style={{ color: "var(--color-fg-4)" }} />}
              </button>
            </div>
            <button onClick={handlePaste} title="Paste from clipboard"
              className="flex items-center justify-center rounded-md transition-colors hover:opacity-70"
              style={{ width: 36, height: 36, background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg-3)", flexShrink: 0 }}>
              <ClipboardPaste size={14} />
            </button>
          </div>
        </div>
        <div className="flex items-start gap-4 px-4 py-4">
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-[13px] font-medium" style={{ color: "var(--color-fg)" }}>Model</span>
            <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>Claude model used for all AI features in Flux</span>
          </div>
          <div className="flex flex-col gap-1.5" style={{ width: 260 }}>
            {MODELS.map(m => {
              const active = s.claudeModel === m.id;
              return (
                <button key={m.id} onClick={() => s.setClaudeModel(m.id)}
                  className="flex items-center gap-2 px-3 rounded-md transition-colors"
                  style={{
                    height: 36,
                    background: active ? "var(--color-accent-10)" : "var(--color-input)",
                    border: `1px solid ${active ? "var(--color-accent-50)" : "var(--color-border)"}`,
                  }}>
                  <div className="shrink-0 rounded-full" style={{
                    width: 14, height: 14,
                    background: active ? "var(--color-accent)" : "transparent",
                    border: active ? "none" : "1px solid var(--color-fg-4)",
                  }} />
                  <span className="flex-1 text-left text-[11px]" style={{ color: active ? "var(--color-fg)" : "var(--color-fg-3)", fontFamily: "Geist Mono, monospace" }}>
                    {m.label}
                  </span>
                  <div className="flex items-center px-1.5 rounded" style={{
                    height: 18,
                    background: active && m.accent ? "var(--color-accent-20)" : "var(--color-border)",
                  }}>
                    <span className="text-[10px] font-medium" style={{ color: active && m.accent ? "var(--color-accent)" : "var(--color-fg-4)" }}>
                      {m.badge}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card title="AI Features">
        <SettingRow label="Auto-generate tests" description="Show 'Generate Tests' button after each response">
          <Toggle checked={s.autoGenerateTests} onChange={v => s.patch({ autoGenerateTests: v })} />
        </SettingRow>
        <SettingRow label="AI debug assist" description="Show 'Debug with AI' button on failed requests">
          <Toggle checked={s.aiDebugAssist} onChange={v => s.patch({ aiDebugAssist: v })} />
        </SettingRow>
        <SettingRow label="Smart autocomplete" description="Autocomplete headers, paths and body fields using AI" last>
          <Toggle checked={s.smartAutocomplete} onChange={v => s.patch({ smartAutocomplete: v })} />
        </SettingRow>
      </Card>

      <Card title="Usage This Month">
        <div className="grid grid-cols-3 gap-3 p-4">
          {[
            { value: s.tokensUsed.toLocaleString(), label: "Tokens used",     sub: `of ${tokenLimit.toLocaleString()} est.`, color: "var(--color-accent)" },
            { value: String(s.testsGenerated),       label: "Tests generated", sub: `since ${s.usageMonth}`, color: "#22C55E" },
            { value: String(s.debugAssists),         label: "Debug assists",   sub: `since ${s.usageMonth}`, color: "#3B82F6" },
          ].map(stat => (
            <div key={stat.label} className="flex flex-col gap-1 rounded-lg p-3.5"
              style={{ background: "var(--color-topbar)", border: "1px solid var(--color-card)" }}>
              <span className="text-[22px] font-bold leading-none" style={{ color: stat.color, letterSpacing: "-0.5px", fontFamily: "Geist, Inter, sans-serif" }}>{stat.value}</span>
              <span className="text-[12px] font-medium" style={{ color: "var(--color-fg)" }}>{stat.label}</span>
              <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>{stat.sub}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 px-4 pb-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>{s.tokensUsed.toLocaleString()} / {tokenLimit.toLocaleString()} tokens</span>
            <span className="text-[11px]" style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>{tokenPct}%</span>
          </div>
          <div className="rounded" style={{ height: 6, background: "var(--color-border)" }}>
            <div className="h-full rounded" style={{ width: `${tokenPct}%`, background: "linear-gradient(90deg, var(--color-accent), #7C3AED)" }} />
          </div>
        </div>
      </Card>
    </div>
  );
}

function AppearanceSection() {
  const s = useSettingsStore();
  const ACCENT_COLORS = ["#A855F7", "#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#EC4899", "#14B8A6"];

  const themes: { id: "dark" | "light" | "system"; label: string; bg: string; lineColor: string }[] = [
    { id: "dark",   label: "Dark",   bg: "#0A0A0A", lineColor: "#27272A" },
    { id: "light",  label: "Light",  bg: "#F4F4F5", lineColor: "#E4E4E7" },
    { id: "system", label: "System", bg: "#1A1A1A", lineColor: "#27272A" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card title="Theme">
        <div className="flex gap-3 p-4">
          {themes.map(t => (
            <button key={t.id} onClick={() => s.patch({ theme: t.id })}
              className="flex flex-col gap-2 flex-1 text-left">
              <div className="rounded-lg p-2 flex flex-col gap-1"
                style={{
                  background: t.bg,
                  border: `${s.theme === t.id ? "2px solid var(--color-accent)" : "1px solid var(--color-border)"}`,
                  height: 80,
                }}>
                {[0,1,2].map(i => (
                  <div key={i} className="rounded" style={{ height: 8, background: t.lineColor, borderRadius: 3 }} />
                ))}
                <div className="rounded mt-auto" style={{ height: 14, width: 28, background: s.theme === t.id ? "var(--color-accent)" : "var(--color-fg-4)", borderRadius: 4 }} />
              </div>
              <div className="flex items-center gap-1.5">
                <div className="rounded-full" style={{ width: 8, height: 8, background: s.theme === t.id ? "var(--color-accent)" : "transparent", border: s.theme === t.id ? "none" : "1px solid var(--color-fg-4)" }} />
                <span className="text-[12px] font-medium" style={{ color: s.theme === t.id ? "var(--color-fg)" : "var(--color-fg-3)" }}>{t.label}</span>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Typography">
        <SettingRow label="Editor font" description="Font used in request/response body">
          <div className="flex items-center gap-2 px-3 rounded-md"
            style={{ height: 32, background: "var(--color-input)", border: "1px solid var(--color-border)", minWidth: 180 }}>
            <span className="flex-1 text-[12px]" style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg)" }}>{s.editorFont}</span>
            <ChevronDown size={13} style={{ color: "var(--color-fg-3)" }} className="shrink-0" />
          </div>
        </SettingRow>
        <SettingRow label="UI font size" description="Base size for interface text" last>
          <div className="flex items-center rounded-md overflow-hidden"
            style={{ height: 32, background: "var(--color-input)", border: "1px solid var(--color-border)" }}>
            <button onClick={() => s.patch({ uiFontSize: Math.max(11, s.uiFontSize - 1) })}
              className="flex items-center justify-center transition-colors hover:opacity-80"
              style={{ width: 30, height: "100%", borderRight: "1px solid var(--color-border)", fontSize: 16, color: "var(--color-fg-3)" }}>âˆ’</button>
            <span className="text-[12px] px-3" style={{ fontFamily: "Geist Mono, monospace", minWidth: 48, textAlign: "center", color: "var(--color-fg)" }}>{s.uiFontSize}px</span>
            <button onClick={() => s.patch({ uiFontSize: Math.min(18, s.uiFontSize + 1) })}
              className="flex items-center justify-center transition-colors hover:opacity-80"
              style={{ width: 30, height: "100%", borderLeft: "1px solid var(--color-border)", fontSize: 16, color: "var(--color-fg-3)" }}>+</button>
          </div>
        </SettingRow>
      </Card>

      <Card title="Accent Color">
        <div className="flex items-center gap-3 px-4" style={{ height: 60 }}>
          {ACCENT_COLORS.map(c => (
            <button key={c} onClick={() => s.patch({ accentColor: c })}
              className="flex items-center justify-center rounded-lg transition-transform hover:scale-110"
              style={{ width: 32, height: 32, background: c, border: s.accentColor === c ? "2px solid #FFFFFF" : "none" }}>
              {s.accentColor === c && (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 7L5.5 10.5L12 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Interface">
        <SettingRow label="Compact mode" description="Reduce spacing across the UI">
          <Toggle checked={s.compactMode} onChange={v => s.patch({ compactMode: v })} />
        </SettingRow>
        <SettingRow label="Show line numbers" description="Display line numbers in the editor">
          <Toggle checked={s.showLineNumbers} onChange={v => s.patch({ showLineNumbers: v })} />
        </SettingRow>
        <SettingRow label="Word wrap in editor" description="Wrap long lines in body editor">
          <Toggle checked={s.wordWrap} onChange={v => s.patch({ wordWrap: v })} />
        </SettingRow>
        <SettingRow label="Animate transitions" description="Enable smooth UI transitions" last>
          <Toggle checked={s.animations} onChange={v => s.patch({ animations: v })} />
        </SettingRow>
      </Card>
    </div>
  );
}

function KeyboardSection() {
  return (
    <div className="flex flex-col gap-6">
      <Card title="Requests">
        <ShortcutRow label="Send request"      keys={["Ctrl", "Enter"]} />
        <ShortcutRow label="Cancel request"    keys={["Esc"]} />
        <ShortcutRow label="New request tab"   keys={["Ctrl", "T"]} />
        <ShortcutRow label="Close request tab" keys={["Ctrl", "W"]} />
        <ShortcutRow label="Duplicate request" keys={["Ctrl", "D"]} last />
      </Card>
      <Card title="Navigation">
        <ShortcutRow label="Toggle sidebar"      keys={["Ctrl", "B"]} />
        <ShortcutRow label="Focus URL bar"        keys={["Ctrl", "L"]} />
        <ShortcutRow label="Switch to next tab"   keys={["Ctrl", "Tab"]} />
        <ShortcutRow label="Open command palette" keys={["Ctrl", "K"]} last />
      </Card>
      <Card title="Collections">
        <ShortcutRow label="New collection"    keys={["Ctrl", "Shift", "N"]} />
        <ShortcutRow label="Save request"      keys={["Ctrl", "S"]} />
        <ShortcutRow label="Import collection" keys={["Ctrl", "O"]} last />
      </Card>
    </div>
  );
}

function ProxySection() {
  const s = useSettingsStore();
  const [connInput, setConnInput]   = useState(String(s.connectionTimeoutMs));
  const [readInput, setReadInput]   = useState(String(s.readTimeoutMs));
  const [sizeInput, setSizeInput]   = useState(String(s.maxResponseSizeMb));

  function commitConn()  { const n = parseInt(connInput, 10);  if (!isNaN(n) && n > 0) s.patch({ connectionTimeoutMs: n }); else setConnInput(String(s.connectionTimeoutMs)); }
  function commitRead()  { const n = parseInt(readInput, 10);  if (!isNaN(n) && n > 0) s.patch({ readTimeoutMs: n });       else setReadInput(String(s.readTimeoutMs)); }
  function commitSize()  { const n = parseInt(sizeInput, 10);  if (!isNaN(n) && n > 0) s.patch({ maxResponseSizeMb: n });   else setSizeInput(String(s.maxResponseSizeMb)); }

  return (
    <div className="flex flex-col gap-6">
      <Card title="Proxy Configuration">
        <SettingRow label="Use system proxy" description="Automatically detect proxy settings from the OS">
          <Toggle checked={s.useSystemProxy} onChange={v => s.patch({ useSystemProxy: v })} />
        </SettingRow>

        {/* HTTP Proxy */}
        <div className="flex items-center gap-3 px-4" style={{ height: 64, borderBottom: "1px solid var(--color-card)" }}>
          <span className="text-[13px] font-medium shrink-0" style={{ width: 110, color: "var(--color-fg-2)" }}>HTTP Proxy</span>
          <input
            value={s.proxyHttp}
            onChange={e => s.patch({ proxyHttp: e.target.value })}
            placeholder="http://proxy.company.com"
            disabled={s.useSystemProxy}
            className="flex-1 px-3 rounded-md text-[12px]"
            style={{ height: 36, background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)", fontFamily: "Geist Mono, monospace", opacity: s.useSystemProxy ? 0.4 : 1 }}
          />
          <span className="text-sm" style={{ color: "var(--color-fg-4)" }}>:</span>
          <input
            value={s.proxyHttpPort}
            onChange={e => s.patch({ proxyHttpPort: e.target.value })}
            disabled={s.useSystemProxy}
            className="px-3 rounded-md text-[12px]"
            style={{ height: 36, width: 72, background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)", fontFamily: "Geist Mono, monospace", opacity: s.useSystemProxy ? 0.4 : 1 }}
          />
        </div>

        {/* HTTPS Proxy */}
        <div className="flex items-center gap-3 px-4" style={{ height: 64, borderBottom: "1px solid var(--color-card)" }}>
          <span className="text-[13px] font-medium shrink-0" style={{ width: 110, color: "var(--color-fg-2)" }}>HTTPS Proxy</span>
          <input
            value={s.proxyHttps}
            onChange={e => s.patch({ proxyHttps: e.target.value })}
            placeholder="https://proxy.company.com"
            disabled={s.useSystemProxy}
            className="flex-1 px-3 rounded-md text-[12px]"
            style={{ height: 36, background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)", fontFamily: "Geist Mono, monospace", opacity: s.useSystemProxy ? 0.4 : 1 }}
          />
          <span className="text-sm" style={{ color: "var(--color-fg-4)" }}>:</span>
          <input
            value={s.proxyHttpsPort}
            onChange={e => s.patch({ proxyHttpsPort: e.target.value })}
            disabled={s.useSystemProxy}
            className="px-3 rounded-md text-[12px]"
            style={{ height: 36, width: 72, background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)", fontFamily: "Geist Mono, monospace", opacity: s.useSystemProxy ? 0.4 : 1 }}
          />
        </div>

        {/* No Proxy */}
        <div className="flex items-center gap-3 px-4" style={{ height: 56 }}>
          <span className="text-[13px] font-medium shrink-0" style={{ width: 110, color: "var(--color-fg-2)" }}>No Proxy</span>
          <input
            value={s.noProxy}
            onChange={e => s.patch({ noProxy: e.target.value })}
            placeholder="localhost, 127.0.0.1, *.internal.com"
            disabled={s.useSystemProxy}
            className="flex-1 px-3 rounded-md text-[12px]"
            style={{ height: 36, background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg-3)", fontFamily: "Geist Mono, monospace", opacity: s.useSystemProxy ? 0.4 : 1 }}
          />
        </div>
      </Card>

      <Card title="SSL & Certificates">
        <SettingRow label="Verify SSL certificates" description="Reject invalid or self-signed certificates">
          <Toggle checked={s.proxySslVerify} onChange={v => s.patch({ proxySslVerify: v })} />
        </SettingRow>
        <SettingRow label="Client SSL certificates" description="Use client certs for mutual TLS" last={!s.clientCerts}>
          <Toggle checked={s.clientCerts} onChange={v => s.patch({ clientCerts: v })} />
        </SettingRow>
        {s.clientCerts && (
          <div className="flex flex-col gap-3 px-4 pb-4">
            <CertFilePicker
              label="Certificate (.pem / .crt)"
              value={s.clientCertPem}
              accept=".pem,.crt,.cer"
              onLoad={pem => s.patch({ clientCertPem: pem })}
              onClear={() => s.patch({ clientCertPem: "" })}
            />
            <CertFilePicker
              label="Private key (.pem / .key)"
              value={s.clientKeyPem}
              accept=".pem,.key"
              onLoad={pem => s.patch({ clientKeyPem: pem })}
              onClear={() => s.patch({ clientKeyPem: "" })}
            />
          </div>
        )}
      </Card>

      <Card title="Network Timeouts">
        <SettingRow label="Connection timeout">
          <div className="flex items-center gap-2">
            <input value={connInput} onChange={e => setConnInput(e.target.value)}
              onBlur={commitConn} onKeyDown={e => e.key === "Enter" && commitConn()}
              className="h-[34px] px-3 rounded-md text-[12px] text-right"
              style={{ background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg)", width: 100, fontFamily: "Geist Mono, monospace" }} />
            <span className="text-[12px]" style={{ color: "var(--color-fg-4)" }}>ms</span>
          </div>
        </SettingRow>
        <SettingRow label="Read timeout">
          <div className="flex items-center gap-2">
            <input value={readInput} onChange={e => setReadInput(e.target.value)}
              onBlur={commitRead} onKeyDown={e => e.key === "Enter" && commitRead()}
              className="h-[34px] px-3 rounded-md text-[12px] text-right"
              style={{ background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg)", width: 100, fontFamily: "Geist Mono, monospace" }} />
            <span className="text-[12px]" style={{ color: "var(--color-fg-4)" }}>ms</span>
          </div>
        </SettingRow>
        <SettingRow label="Max response size" last>
          <div className="flex items-center gap-2">
            <input value={sizeInput} onChange={e => setSizeInput(e.target.value)}
              onBlur={commitSize} onKeyDown={e => e.key === "Enter" && commitSize()}
              className="h-[34px] px-3 rounded-md text-[12px] text-right"
              style={{ background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg)", width: 100, fontFamily: "Geist Mono, monospace" }} />
            <span className="text-[12px]" style={{ color: "var(--color-fg-4)" }}>MB</span>
          </div>
        </SettingRow>
      </Card>
    </div>
  );
}

function CertFilePicker({ label, value, accept, onLoad, onClear }: {
  label: string;
  value: string;
  accept: string;
  onLoad: (pem: string) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    onLoad(text);
    e.target.value = "";
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>{label}</span>
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center px-3 rounded-md overflow-hidden"
          style={{ height: 32, background: "var(--color-input)", border: `1px solid ${value ? "var(--color-accent-50)" : "var(--color-border)"}` }}>
          <span className="flex-1 text-[11px] truncate" style={{ fontFamily: "Geist Mono, monospace", color: value ? "var(--color-fg)" : "var(--color-fg-4)" }}>
            {value ? `${value.split("\n")[0].slice(0, 40)}…` : "No file loaded"}
          </span>
          {value && (
            <button onClick={onClear} className="shrink-0 hover:opacity-70 transition-opacity ml-2" style={{ color: "var(--color-fg-3)" }}>
              <X size={12} />
            </button>
          )}
        </div>
        <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleFile} />
        <button onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 rounded-md text-[12px] transition-opacity hover:opacity-80 shrink-0"
          style={{ height: 32, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)" }}>
          <FileUp size={13} />
          {value ? "Replace" : "Load"}
        </button>
      </div>
    </div>
  );
}

const RETENTION_OPTIONS = [
  { label: "7 days",   value: 7  },
  { label: "30 days",  value: 30 },
  { label: "90 days",  value: 90 },
  { label: "Forever",  value: 0  },
];

function PrivacySection() {
  const s = useSettingsStore();
  const [clearing, setClearing]       = useState(false);
  const [historyCount, setHistoryCount] = useState<number | null>(null);
  const [exporting, setExporting]     = useState(false);
  const [showRetention, setShowRetention] = useState(false);

  useEffect(() => {
    getHistory().then(h => setHistoryCount(h.length)).catch(() => setHistoryCount(0));
  }, []);

  async function handleClearHistory() {
    setClearing(true);
    try {
      await clearHistory();
      setHistoryCount(0);
    } finally { setClearing(false); }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const history = await getHistory();
      exportDataAsJson(
        { exportedAt: new Date().toISOString(), history },
        "flux-export.json",
      );
    } finally { setExporting(false); }
  }

  const retentionLabel = RETENTION_OPTIONS.find(o => o.value === s.historyRetentionDays)?.label ?? `${s.historyRetentionDays} days`;

  return (
    <div className="flex flex-col gap-6">
      <Card title="Analytics & Telemetry">
        <SettingRow label="Send usage analytics" description="Help improve Flux by sharing anonymous usage data">
          <Toggle checked={s.analytics} onChange={v => s.patch({ analytics: v })} />
        </SettingRow>
        <SettingRow label="Crash reports" description="Automatically send crash reports to help fix bugs">
          <Toggle checked={s.crashReports} onChange={v => s.patch({ crashReports: v })} />
        </SettingRow>
        <SettingRow label="Performance metrics" description="Share performance data to improve response times" last>
          <Toggle checked={s.perfMetrics} onChange={v => s.patch({ perfMetrics: v })} />
        </SettingRow>
      </Card>

      <Card title="Your Data">
        <div className="flex items-center gap-4 px-4" style={{ height: 60, borderBottom: "1px solid var(--color-card)" }}>
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-[13px] font-medium" style={{ color: "var(--color-fg)" }}>Export all data</span>
            <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>Download a copy of your history as JSON</span>
          </div>
          <button onClick={handleExport} disabled={exporting}
            className="flex items-center gap-1.5 px-3.5 rounded-md text-[12px] transition-opacity hover:opacity-80 disabled:opacity-40 shrink-0"
            style={{ height: 32, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)" }}>
            <Download size={13} style={{ color: "var(--color-fg-2)" }} />
            {exporting ? "Exporting…" : "Export .json"}
          </button>
        </div>

        <div className="flex items-center gap-4 px-4" style={{ height: 60, borderBottom: "1px solid var(--color-card)" }}>
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-[13px] font-medium" style={{ color: "var(--color-fg)" }}>Request history</span>
            <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>
              {historyCount === null ? "Loading…" : `${historyCount} request${historyCount !== 1 ? "s" : ""} stored locally`}
            </span>
          </div>
          <button onClick={handleClearHistory} disabled={clearing}
            className="flex items-center gap-1.5 px-3.5 rounded-md text-[12px] transition-opacity hover:opacity-80 disabled:opacity-40 shrink-0"
            style={{ height: 32, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)" }}>
            <History size={13} style={{ color: "var(--color-fg-2)" }} />
            {clearing ? "Clearing…" : "Clear history"}
          </button>
        </div>

        {/* History retention dropdown */}
        <div className="flex items-center gap-4 px-4" style={{ height: 52, position: "relative" }}>
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-[13px] font-medium" style={{ color: "var(--color-fg)" }}>History retention</span>
          </div>
          <button onClick={() => setShowRetention(v => !v)}
            className="flex items-center gap-2 px-3 rounded-md"
            style={{ height: 34, width: 160, background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }}>
            <span className="flex-1 text-left text-[13px]">{retentionLabel}</span>
            <ChevronDown size={13} style={{ color: "var(--color-fg-3)" }} className="shrink-0" />
          </button>
          {showRetention && (
            <div className="absolute right-4 top-full mt-1 z-50 rounded-lg overflow-hidden"
              style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", width: 160, boxShadow: "0 8px 24px #00000060" }}>
              {RETENTION_OPTIONS.map(o => (
                <button key={o.value}
                  onClick={() => { s.patch({ historyRetentionDays: o.value }); setShowRetention(false); }}
                  className="flex items-center w-full px-3 transition-colors hover:opacity-80"
                  style={{ height: 36, color: s.historyRetentionDays === o.value ? "var(--color-accent)" : "var(--color-fg)", fontSize: 13 }}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card title="Sessions & Security">
        <SettingRow label="Remember me on this device" description="Stay signed in between sessions">
          <Toggle checked={s.rememberMe} onChange={v => s.patch({ rememberMe: v })} />
        </SettingRow>
        <SettingRow label="Lock on system sleep" description="Require password when waking from sleep" last>
          <Toggle checked={s.lockOnSleep} onChange={v => s.patch({ lockOnSleep: v })} />
        </SettingRow>
      </Card>

      <div className="rounded-lg overflow-hidden" style={{ background: "var(--color-elevated)", border: "1px solid #EF444440" }}>
        <div className="flex items-center gap-2 px-4" style={{ height: 40, background: "#150A0A", borderBottom: "1px solid #EF444430" }}>
          <TriangleAlert size={14} className="text-red" />
          <span className="text-[12px] font-semibold text-red">Danger Zone</span>
        </div>
        <div className="flex items-center gap-4 px-4" style={{ height: 56, borderBottom: "1px solid #EF444420" }}>
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-[13px] font-medium" style={{ color: "var(--color-fg)" }}>Sign out of all devices</span>
            <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>Clears all local session data on this device</span>
          </div>
          <button
            onClick={() => { localStorage.clear(); window.location.reload(); }}
            className="flex items-center gap-1.5 px-3.5 rounded-md text-[12px] transition-opacity hover:opacity-80 shrink-0"
            style={{ height: 32, background: "var(--color-card)", border: "1px solid #EF444440", color: "#EF4444" }}>
            <LogOut size={13} /> Sign out
          </button>
        </div>
        <div className="flex items-center gap-4 px-4" style={{ height: 56 }}>
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-[13px] font-medium text-red">Reset all settings</span>
            <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>Restore all settings to their defaults. Cannot be undone.</span>
          </div>
          <button
            onClick={() => { localStorage.removeItem("flux-settings"); window.location.reload(); }}
            className="flex items-center gap-1.5 px-3.5 rounded-md text-[12px] font-medium transition-opacity hover:opacity-80 shrink-0"
            style={{ height: 32, background: "#EF444418", border: "1px solid #EF444450", color: "#EF4444" }}>
            <Trash2 size={13} /> Reset settings
          </button>
        </div>
      </div>
    </div>
  );
}

function CookiesSection() {
  const s = useSettingsStore();
  const [cookies, setCookies] = useState<CookieEntry[]>([]);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    getAllCookies().then(setCookies).catch(() => setCookies([]));
  }, []);

  async function handleDelete(domain: string, name: string, path: string) {
    await deleteCookie(domain, name, path);
    setCookies(prev => prev.filter(c => !(c.domain === domain && c.name === name && c.path === path)));
  }

  async function handleClearAll() {
    setClearing(true);
    try {
      await clearCookies();
      setCookies([]);
    } finally { setClearing(false); }
  }

  async function handleClearDomain(domain: string) {
    await clearCookies(domain);
    setCookies(prev => prev.filter(c => c.domain !== domain));
  }

  // Group by domain
  const byDomain = cookies.reduce<Record<string, CookieEntry[]>>((acc, c) => {
    (acc[c.domain] ??= []).push(c);
    return acc;
  }, {});

  const domains = Object.keys(byDomain).sort();

  return (
    <div className="flex flex-col gap-6">
      <Card title="Cookie Jar">
        <SettingRow
          label="Enable Cookie Jar"
          description="Automatically send and receive cookies on every request"
          last
        >
          <Toggle checked={s.enableCookieJar} onChange={v => s.patch({ enableCookieJar: v })} />
        </SettingRow>
      </Card>

      <Card title="Stored Cookies">
        {cookies.length === 0 ? (
          <div className="flex items-center justify-center px-4" style={{ height: 64 }}>
            <span className="text-[12px]" style={{ color: "var(--color-fg-4)" }}>
              No cookies stored. Enable the Cookie Jar and make a request.
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-4" style={{ height: 44, borderBottom: "1px solid var(--color-border)" }}>
              <span className="flex-1 text-[12px]" style={{ color: "var(--color-fg-3)" }}>
                {cookies.length} {cookies.length === 1 ? "cookie" : "cookies"} across {domains.length} {domains.length === 1 ? "domain" : "domains"}
              </span>
              <button
                onClick={handleClearAll}
                disabled={clearing}
                className="flex items-center gap-1.5 px-3 rounded-md text-[12px] transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ height: 28, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-3)" }}
              >
                <Trash2 size={12} />
                {clearing ? "Clearing…" : "Clear all"}
              </button>
            </div>

            {domains.map(domain => (
              <div key={domain}>
                <div className="flex items-center gap-2 px-4"
                  style={{ height: 36, background: "var(--color-topbar)", borderBottom: "1px solid var(--color-border)" }}>
                  <Cookie size={12} style={{ color: "var(--color-accent)" }} />
                  <span className="flex-1 text-[12px] font-medium" style={{ color: "var(--color-fg-2)", fontFamily: "Geist Mono, monospace" }}>
                    {domain}
                  </span>
                  <button
                    onClick={() => handleClearDomain(domain)}
                    className="text-[11px] transition-opacity hover:opacity-70"
                    style={{ color: "var(--color-fg-4)" }}
                  >
                    Clear
                  </button>
                </div>
                {byDomain[domain].map(c => (
                  <div key={`${c.name}${c.path}`}
                    className="flex items-center gap-3 px-4"
                    style={{ height: 40, borderBottom: "1px solid var(--color-border)" }}>
                    <span className="shrink-0 text-[12px] font-medium" style={{ color: "var(--color-fg)", fontFamily: "Geist Mono, monospace", minWidth: 120 }}>
                      {c.name}
                    </span>
                    <span className="flex-1 text-[11px] truncate" style={{ color: "var(--color-fg-4)", fontFamily: "Geist Mono, monospace" }}>
                      {c.value}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {c.secure   && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#22C55E15", color: "#22C55E" }}>Secure</span>}
                      {c.httpOnly && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#3B82F615", color: "#3B82F6" }}>HttpOnly</span>}
                    </div>
                    <button
                      onClick={() => handleDelete(c.domain, c.name, c.path)}
                      className="shrink-0 flex items-center justify-center rounded transition-opacity hover:opacity-70"
                      style={{ width: 22, height: 22, color: "var(--color-fg-4)" }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </Card>
    </div>
  );
}

function AboutSection() {
  async function openUrl(url: string) {
    const { openUrl: open } = await import("@tauri-apps/plugin-opener");
    await open(url);
  }

  return (
    <div className="flex flex-col gap-6">

      {/* Hero */}
      <div className="rounded-lg overflow-hidden" style={{ background: "var(--color-elevated)", border: "1px solid var(--color-border)" }}>
        <div className="p-6 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="text-[24px] font-bold" style={{ fontFamily: "Geist, Inter, sans-serif", color: "var(--color-fg)", letterSpacing: "-0.5px" }}>Flux</span>
            <div className="flex items-center px-2 py-0.5 rounded" style={{ background: "var(--color-accent-20)", border: "1px solid var(--color-accent-30)" }}>
              <span className="text-[11px] font-semibold" style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>v0.1.5</span>
            </div>
          </div>
          <p className="text-[13px]" style={{ color: "var(--color-fg-3)", lineHeight: 1.7, maxWidth: 520 }}>
            Modern desktop API client. Local-first, AI-powered, cloud-synced. Under 30 MB RAM, no Electron, no account required to start.
          </p>
          <p className="text-[12px]" style={{ color: "var(--color-fg-4)", lineHeight: 1.6 }}>
            Built with Tauri 2 · React · Rust · MIT License
          </p>
        </div>

        <div className="grid grid-cols-3 border-t" style={{ borderColor: "var(--color-border)" }}>
          {[
            { value: "< 30 MB", label: "RAM usage" },
            { value: "10+",     label: "Feature modules" },
            { value: "MIT",     label: "License" },
          ].map((stat, i, arr) => (
            <div key={stat.label}
              className="flex flex-col items-center justify-center gap-0.5 py-4"
              style={{ borderRight: i < arr.length - 1 ? "1px solid var(--color-border)" : "none" }}>
              <span className="text-[18px] font-bold" style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>{stat.value}</span>
              <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>{stat.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Documentation CTA */}
      <div className="rounded-lg p-5 flex items-center gap-4"
        style={{ background: "var(--color-accent-10)", border: "1px solid var(--color-accent-20)" }}>
        <div className="flex items-center justify-center rounded-lg shrink-0"
          style={{ width: 40, height: 40, background: "var(--color-accent-20)", border: "1px solid var(--color-accent-30)" }}>
          <Info size={18} style={{ color: "var(--color-accent)" }} />
        </div>
        <div className="flex flex-col gap-0.5 flex-1">
          <span className="text-[13px] font-semibold" style={{ color: "var(--color-fg)" }}>Full documentation</span>
          <span className="text-[12px]" style={{ color: "var(--color-fg-3)" }}>
            Getting started, features, installation guide and keyboard shortcuts.
          </span>
        </div>
        <button onClick={() => openUrl("https://angeldevmobile.github.io/Flux-Post")}
          className="flex items-center gap-1.5 px-4 rounded-md text-[12px] font-medium transition-opacity hover:opacity-80 shrink-0"
          style={{ height: 34, background: "var(--color-accent)", color: "#fff" }}>
          <ExternalLink size={12} />
          Open docs
        </button>
      </div>

      {/* Links */}
      <Card title="Resources">
        {[
          { label: "Documentation",  desc: "Full user guide, features and installation", url: "https://angeldevmobile.github.io/Flux-Post" },
          { label: "GitHub",         desc: "Source code, issues and contributions",      url: "https://github.com/angeldevmobile/Flux-Post" },
          { label: "Releases",       desc: "Download installers for all platforms",       url: "https://github.com/angeldevmobile/Flux-Post/releases" },
          { label: "Report an issue",desc: "Found a bug? Open an issue on GitHub",       url: "https://github.com/angeldevmobile/Flux-Post/issues" },
          { label: "License",        desc: "MIT License free to use and modify",        url: "https://github.com/angeldevmobile/Flux-Post/blob/main/LICENSE" },
        ].map((link, i, arr) => (
          <button key={link.label} onClick={() => openUrl(link.url)}
            className="flex items-center gap-4 w-full px-4 transition-opacity hover:opacity-80 text-left"
            style={{ height: 52, borderBottom: i < arr.length - 1 ? "1px solid var(--color-border)" : "none" }}>
            <div className="flex flex-col gap-0.5 flex-1">
              <span className="text-[13px] font-medium" style={{ color: "var(--color-fg)" }}>{link.label}</span>
              <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>{link.desc}</span>
            </div>
            <ExternalLink size={13} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />
          </button>
        ))}
      </Card>

    </div>
  );
}


const GH_TOKEN_KEY = "flux_github_token";
const GH_USER_KEY  = "flux_github_user";

function GitHubSection() {
  const [user, setUser] = useState<{ login: string; avatar_url: string; name: string | null } | null>(() => {
    const raw = localStorage.getItem(GH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem(GH_TOKEN_KEY) ?? "");
  const [showToken, setShowToken] = useState(false);

  async function openTokenPage() {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl("https://github.com/settings/tokens/new?scopes=repo&description=Flux+API+Client");
  }

  function handleDisconnect() {
    localStorage.removeItem(GH_TOKEN_KEY);
    localStorage.removeItem(GH_USER_KEY);
    setToken("");
    setUser(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card title="Account">
        {user ? (
          <SettingRow label="Connected account" last>
            <div className="flex items-center gap-2">
              <img src={user.avatar_url} alt="" className="rounded-full" style={{ width: 22, height: 22 }} />
              <span className="text-[13px]" style={{ color: "var(--color-fg-2)" }}>{user.login}</span>
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-3 rounded-md text-[12px] transition-opacity hover:opacity-80"
                style={{ height: 28, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-3)" }}
              >
                <LogOut size={12} /> Disconnect
              </button>
            </div>
          </SettingRow>
        ) : (
          <SettingRow label="Not connected" description="Go to the GitHub screen to connect your account" last>
            <button
              onClick={openTokenPage}
              className="flex items-center gap-1.5 px-3 rounded-md text-[12px] transition-opacity hover:opacity-80"
              style={{ height: 28, background: "var(--color-accent-10)", border: "1px solid var(--color-accent-20)", color: "var(--color-accent)" }}
            >
              <ExternalLink size={12} /> Create token
            </button>
          </SettingRow>
        )}
      </Card>

      <Card title="Token">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center px-3 rounded-md overflow-hidden"
              style={{ height: 34, background: "var(--color-input)", border: `1px solid ${token ? "var(--color-accent-50)" : "var(--color-border)"}` }}>
              <span className="flex-1 text-[12px] truncate" style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg-2)" }}>
                {token ? (showToken ? token : "ghp_" + "•".repeat(Math.min(token.length - 4, 20))) : "No token saved"}
              </span>
              {token && (
                <button onClick={() => setShowToken(p => !p)} className="shrink-0 ml-2" style={{ color: "var(--color-fg-4)" }}>
                  {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              )}
            </div>
            {token && (
              <button
                onClick={handleDisconnect}
                className="flex items-center justify-center rounded-md shrink-0"
                style={{ width: 34, height: 34, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-4)" }}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <p className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>
            Token is stored locally on this device only. Needs <code style={{ background: "var(--color-card)", padding: "0 4px", borderRadius: 3 }}>repo</code> scope.
          </p>
        </div>
      </Card>
    </div>
  );
}

function CliSection() {
  const [status, setStatus] = useState<{ installed: boolean; path: string | null; version: string | null } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    invoke<{ installed: boolean; path: string | null; version: string | null }>("get_cli_status")
      .then(s => setStatus(s))
      .catch(() => setStatus({ installed: false, path: null, version: null }));
  }, []);

  async function handleInstall() {
    setInstalling(true);
    setMessage(null);
    try {
      const result = await invoke<{ path: string; alreadyInPath: boolean }>("install_cli");
      setStatus({ installed: true, path: result.path, version: null });
      setMessage({
        text: result.alreadyInPath
          ? `Installed at ${result.path} (already in PATH)`
          : `Installed at ${result.path} — restart your terminal to use flux`,
        ok: true,
      });
    } catch (e) {
      setMessage({ text: String(e), ok: false });
    } finally {
      setInstalling(false);
    }
  }

  async function handleUninstall() {
    setUninstalling(true);
    setMessage(null);
    try {
      await invoke("uninstall_cli");
      setStatus({ installed: false, path: null, version: null });
      setMessage({ text: "CLI uninstalled successfully", ok: true });
    } catch (e) {
      setMessage({ text: String(e), ok: false });
    } finally {
      setUninstalling(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card title="CLI Runner">
        <div className="flex items-start gap-3 mx-4 mt-4 mb-2 px-3 py-3 rounded-lg"
          style={{ background: "var(--color-accent-10)", border: "1px solid var(--color-accent-20)" }}>
          <Terminal size={14} style={{ color: "var(--color-accent)", flexShrink: 0, marginTop: 1 }} />
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium" style={{ color: "var(--color-fg)" }}>
              Run Flux collections from your terminal or CI/CD pipeline
            </span>
            <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>
              The CLI runner reads the same YAML collection files as the app and returns exit code 1 on test failures — perfect for GitHub Actions, Jenkins, and local automation.
            </span>
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center gap-4 px-4" style={{ height: 56, borderBottom: "1px solid var(--color-border)" }}>
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-[13px] font-medium" style={{ color: "var(--color-fg)" }}>Status</span>
            <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>
              {status === null
                ? "Checking..."
                : status.installed
                  ? `Installed${status.version ? ` · ${status.version}` : ""}`
                  : "Not installed"}
            </span>
          </div>
          <div className="flex items-center gap-2 px-2 py-1 rounded"
            style={{ background: status?.installed ? "#22C55E15" : "var(--color-card)", border: `1px solid ${status?.installed ? "#22C55E30" : "var(--color-border)"}` }}>
            <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: status?.installed ? "#22C55E" : "var(--color-fg-4)" }} />
            <span className="text-[11px] font-medium" style={{ color: status?.installed ? "#22C55E" : "var(--color-fg-4)" }}>
              {status?.installed ? "Installed" : "Not installed"}
            </span>
          </div>
        </div>

        {/* Install path */}
        {status?.installed && status.path && (
          <div className="flex items-center gap-4 px-4" style={{ height: 48, borderBottom: "1px solid var(--color-border)" }}>
            <span className="text-[12px] font-medium shrink-0" style={{ color: "var(--color-fg-2)" }}>Path</span>
            <span className="flex-1 text-[11px] truncate" style={{ color: "var(--color-fg-3)", fontFamily: "Geist Mono, monospace" }}>
              {status.path}
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-3 px-4" style={{ height: 60 }}>
          <button
            onClick={handleInstall}
            disabled={installing}
            className="flex items-center gap-1.5 px-4 rounded-md text-[12px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ height: 34, background: "var(--color-accent)", color: "#fff" }}>
            <Terminal size={13} />
            {installing ? "Installing…" : status?.installed ? "Reinstall CLI" : "Install CLI"}
          </button>
          {status?.installed && (
            <button
              onClick={handleUninstall}
              disabled={uninstalling}
              className="flex items-center gap-1.5 px-3 rounded-md text-[12px] transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ height: 34, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-3)" }}>
              <Trash2 size={12} />
              {uninstalling ? "Removing…" : "Uninstall"}
            </button>
          )}
        </div>

        {/* Feedback message */}
        {message && (
          <div className="mx-4 mb-4 px-3 py-2.5 rounded-lg text-[11px]"
            style={{
              background: message.ok ? "#22C55E15" : "#EF444415",
              border: `1px solid ${message.ok ? "#22C55E30" : "#EF444430"}`,
              color: message.ok ? "#22C55E" : "#EF4444",
              fontFamily: "Geist Mono, monospace",
            }}>
            {message.text}
          </div>
        )}
      </Card>

      {/* Usage examples */}
      <Card title="Usage">
        {[
          { cmd: "flux run ./collections/",                          desc: "Run all collections in a folder" },
          { cmd: "flux run ./api.yaml --env BASE_URL=https://...",   desc: "Override environment variables" },
          { cmd: "flux run ./api.yaml --reporter json",              desc: "Output JSON report to stdout" },
          { cmd: "flux run ./api.yaml --reporter json -o report.json", desc: "Save JSON report to file" },
          { cmd: "flux run ./api.yaml --bail",                       desc: "Stop on first failure" },
        ].map(({ cmd, desc }, i, arr) => (
          <div key={cmd} className="flex flex-col gap-0.5 px-4 py-3"
            style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--color-border)" : "none" }}>
            <code className="text-[11px]" style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>{cmd}</code>
            <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>{desc}</span>
          </div>
        ))}
      </Card>

      <Card title="CI/CD Example">
        <div className="px-4 py-4">
          <pre className="text-[11px] rounded-lg p-3 overflow-x-auto"
            style={{ background: "var(--color-topbar)", border: "1px solid var(--color-border)", color: "var(--color-fg-3)", fontFamily: "Geist Mono, monospace", lineHeight: 1.7 }}>
{`# GitHub Actions
- name: Run API tests
  run: flux run ./collections/ --reporter json --output report.json

- name: Upload report
  uses: actions/upload-artifact@v3
  with:
    name: api-test-report
    path: report.json`}
          </pre>
        </div>
      </Card>
    </div>
  );
}
/*     ROOT     */

export function SettingsRoute() {
  const [section, setSection] = useState<Section>("general");

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      <aside className="flex flex-col shrink-0 h-full" style={{ width: 220, background: "var(--color-sidebar)", borderRight: "1px solid var(--color-border)" }}>
        <div className="flex items-center px-4 shrink-0" style={{ height: 44, borderBottom: "1px solid var(--color-border)" }}>
          <span className="text-[12px] font-medium" style={{ color: "var(--color-fg-2)" }}>Settings</span>
        </div>
        <nav className="flex-1 overflow-y-auto py-1">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setSection(id)}
              className="flex items-center gap-2.5 w-full px-4 transition-colors"
              style={{
                height: 36,
                background: section === id ? "var(--color-card)" : "transparent",
                borderLeft: section === id ? "2px solid var(--color-accent)" : "2px solid transparent",
                color: section === id ? "var(--color-fg)" : "var(--color-fg-3)",
              }}>
              <Icon size={15} style={{ color: section === id ? "var(--color-accent)" : "var(--color-fg-4)" }} />
              <span className="text-[13px]">{label}</span>
            </button>
          ))}
        </nav>
        <div className="px-4 py-4 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
          <span className="text-[11px] px-2 py-0.5 rounded"
            style={{ background: "var(--color-accent-20)", color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>
            v0.1.5
          </span>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "var(--color-bg)" }}>
        <div className="flex items-center shrink-0 px-8" style={{ height: 52, borderBottom: "1px solid var(--color-border)" }}>
          <h2 className="text-[16px] font-semibold" style={{ fontFamily: "Geist, Inter, sans-serif", color: "var(--color-fg)" }}>
            {SECTIONS.find(s => s.id === section)?.label}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto px-8 py-7">
          {section === "general"    && <GeneralSection />}
          {section === "ai"         && <AiSection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "keyboard"   && <KeyboardSection />}
          {section === "proxy"      && <ProxySection />}
          {section === "cookies"    && <CookiesSection />}
          {section === "privacy"    && <PrivacySection />}
          {section === "cli"        && <CliSection />}
          {section === "github"     && <GitHubSection />}
          {section === "about"      && <AboutSection />}
        </div>
      </div>
    </div>
  );
}


