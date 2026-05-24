import { useState } from "react";
import { Settings2, Sparkles, Palette, Keyboard, Network, Shield, Info, ChevronDown, Upload, EyeOff, Download, History, LogOut, Trash2, TriangleAlert } from "lucide-react";
import { useSettingsStore } from "@/stores/settings";
import { clearHistory } from "@/lib/tauri";

type Section = "general" | "ai" | "appearance" | "keyboard" | "proxy" | "privacy" | "about";

const SECTIONS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "general",    label: "General",          icon: Settings2  },
  { id: "ai",         label: "AI & Claude",       icon: Sparkles   },
  { id: "appearance", label: "Appearance",        icon: Palette    },
  { id: "keyboard",   label: "Keyboard",          icon: Keyboard   },
  { id: "proxy",      label: "Proxy & Network",   icon: Network    },
  { id: "privacy",    label: "Data & Privacy",    icon: Shield     },
  { id: "about",      label: "About",             icon: Info       },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="relative shrink-0 transition-colors"
      style={{ width: 36, height: 20, borderRadius: 10, background: checked ? "#A855F7" : "#27272A" }}>
      <span className="absolute top-0.5 transition-all"
        style={{ width: 16, height: 16, borderRadius: "50%", background: "#FFF", left: checked ? 18 : 2 }} />
    </button>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ background: "#0D0D0D", border: "1px solid #27272A" }}>
      <div className="flex items-center px-4" style={{ height: 40, background: "#111111", borderBottom: "1px solid #27272A" }}>
        <span className="text-[12px] font-semibold text-[#A1A1AA]">{title}</span>
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
      style={{ height: description ? 56 : 52, borderBottom: last ? "none" : "1px solid #1A1A1A" }}>
      <div className="flex flex-col gap-0.5 flex-1">
        <span className="text-[13px] font-medium text-[#E4E4E7]">{label}</span>
        {description && <span className="text-[11px] text-[#71717A]">{description}</span>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SelectBox({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 px-3 rounded-md"
      style={{ height: 32, background: "#141414", border: "1px solid #27272A", minWidth: 180 }}>
      <span className="flex-1 text-[12px] text-[#E4E4E7]" style={{ fontFamily: "Geist Mono, monospace" }}>{value}</span>
      <ChevronDown size={13} className="text-[#71717A] shrink-0" />
    </div>
  );
}

function KbdKey({ children }: { children: string }) {
  return (
    <div className="flex items-center justify-center px-2 rounded"
      style={{ height: 24, background: "#1A1A1A", border: "1px solid #3F3F46" }}>
      <span className="text-[11px] font-medium text-[#A1A1AA]" style={{ fontFamily: "Geist Mono, monospace" }}>{children}</span>
    </div>
  );
}

function ShortcutRow({ label, keys, last }: { label: string; keys: string[]; last?: boolean }) {
  return (
    <div className="flex items-center gap-4 px-4"
      style={{ height: 48, borderBottom: last ? "none" : "1px solid #1A1A1A" }}>
      <span className="flex-1 text-[13px] text-[#E4E4E7]">{label}</span>
      <div className="flex items-center gap-1 shrink-0">
        {keys.map((k, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-[11px] text-[#52525B]">+</span>}
            <KbdKey>{k}</KbdKey>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── SECTIONS ─── */

function GeneralSection() {
  const { timeoutMs, setTimeoutMs, followRedirects, setFollowRedirects, sslVerify, setSslVerify } = useSettingsStore();
  const [timeoutInput, setTimeoutInput] = useState(String(timeoutMs));

  function commitTimeout() {
    const n = parseInt(timeoutInput, 10);
    if (!isNaN(n) && n > 0) setTimeoutMs(n);
    else setTimeoutInput(String(timeoutMs));
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
            style={{ background: "#141414", border: "1px solid #27272A", color: "#A1A1AA", width: 180, fontFamily: "Geist Mono, monospace" }} />
        </SettingRow>
        <SettingRow label="Follow Redirects" description="Automatically follow HTTP redirects">
          <Toggle checked={followRedirects} onChange={setFollowRedirects} />
        </SettingRow>
        <SettingRow label="SSL Verification" description="Verify SSL certificates on requests" last>
          <Toggle checked={sslVerify} onChange={setSslVerify} />
        </SettingRow>
      </Card>
    </div>
  );
}

const MODELS = [
  { id: "claude-sonnet-4-6", label: "claude-sonnet-4-6", badge: "Recommended", badgeBg: "#A855F720", badgeColor: "#A855F7", activeBg: "#1A1A2E", activeBorder: "#A855F750", dotColor: "#A855F7" },
  { id: "claude-opus-4-7",   label: "claude-opus-4-7",   badge: "Most capable",  badgeBg: "#1A1A1A",   badgeColor: "#52525B", activeBg: "#141414",  activeBorder: "#27272A",  dotColor: "#3F3F46"  },
  { id: "claude-haiku-4-5",  label: "claude-haiku-4-5",  badge: "Fastest",       badgeBg: "#1A1A1A",   badgeColor: "#52525B", activeBg: "#141414",  activeBorder: "#27272A",  dotColor: "#3F3F46"  },
];

function AiSection() {
  const { claudeApiKey, setClaudeApiKey, claudeModel, setClaudeModel } = useSettingsStore();
  const [showKey, setShowKey] = useState(false);
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [debugAssist, setDebugAssist] = useState(true);
  const [autocomplete, setAutocomplete] = useState(false);
  const [nlSearch, setNlSearch] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      {/* API Configuration */}
      <Card title="API Configuration">
        <SettingRow label="Claude API Key" description="Required for AI test generation and debug assist">
          <div className="flex items-center gap-2 px-3 rounded-md"
            style={{ height: 36, width: 260, background: "#141414", border: "1px solid #27272A" }}>
            <input
              type={showKey ? "text" : "password"}
              value={claudeApiKey}
              onChange={e => setClaudeApiKey(e.target.value)}
              placeholder="sk-ant-••••••••••••••••"
              className="flex-1 text-[12px] bg-transparent"
              style={{ color: claudeApiKey ? "#A1A1AA" : "#71717A", fontFamily: "Geist Mono, monospace" }}
            />
            <button onClick={() => setShowKey(v => !v)}>
              <EyeOff size={13} className="text-[#52525B]" />
            </button>
          </div>
        </SettingRow>
        <div className="flex items-start gap-4 px-4 py-4">
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-[13px] font-medium text-[#E4E4E7]">Model</span>
            <span className="text-[11px] text-[#71717A]">Claude model used for all AI features in Flux</span>
          </div>
          <div className="flex flex-col gap-1.5" style={{ width: 260 }}>
            {MODELS.map(m => (
              <button key={m.id} onClick={() => setClaudeModel(m.id)}
                className="flex items-center gap-2 px-3 rounded-md transition-colors"
                style={{ height: 36, background: claudeModel === m.id ? m.activeBg : "#141414", border: `1px solid ${claudeModel === m.id ? m.activeBorder : "#27272A"}` }}>
                <div className="shrink-0 rounded-full" style={{ width: 14, height: 14, background: claudeModel === m.id ? m.dotColor : "#27272A", border: claudeModel === m.id ? "none" : "1px solid #3F3F46" }} />
                <span className="flex-1 text-left text-[11px]" style={{ color: claudeModel === m.id ? "#E4E4E7" : "#71717A", fontFamily: "Geist Mono, monospace" }}>{m.label}</span>
                <div className="flex items-center px-1.5 rounded" style={{ height: 18, background: m.badgeBg }}>
                  <span className="text-[10px] font-medium" style={{ color: m.badgeColor }}>{m.badge}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* AI Features */}
      <Card title="AI Features">
        <SettingRow label="Auto-generate tests" description="Suggest tests automatically after each response">
          <Toggle checked={autoGenerate} onChange={setAutoGenerate} />
        </SettingRow>
        <SettingRow label="AI debug assist" description="Explain errors and suggest fixes on failed requests">
          <Toggle checked={debugAssist} onChange={setDebugAssist} />
        </SettingRow>
        <SettingRow label="Smart autocomplete" description="Autocomplete headers, paths and body fields using AI">
          <Toggle checked={autocomplete} onChange={setAutocomplete} />
        </SettingRow>
        <SettingRow label="Natural language search" description="Search collections using plain English" last>
          <Toggle checked={nlSearch} onChange={setNlSearch} />
        </SettingRow>
      </Card>

      {/* Usage This Month */}
      <Card title="Usage This Month">
        <div className="grid grid-cols-3 gap-3 p-4">
          {[
            { value: "48,210", label: "Tokens used",     sub: "of 100k limit", color: "#A855F7" },
            { value: "127",    label: "Tests generated", sub: "since May 1",   color: "#22C55E" },
            { value: "34",     label: "Debug assists",   sub: "since May 1",   color: "#3B82F6" },
          ].map(stat => (
            <div key={stat.label} className="flex flex-col gap-1 rounded-lg p-3.5"
              style={{ background: "#111111", border: "1px solid #1A1A1A" }}>
              <span className="text-[22px] font-bold leading-none" style={{ color: stat.color, letterSpacing: "-0.5px", fontFamily: "Geist, Inter, sans-serif" }}>{stat.value}</span>
              <span className="text-[12px] font-medium text-[#E4E4E7]">{stat.label}</span>
              <span className="text-[11px] text-[#52525B]">{stat.sub}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 px-4 pb-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[#71717A]">48,210 / 100,000 tokens</span>
            <span className="text-[11px] text-[#A855F7]" style={{ fontFamily: "Geist Mono, monospace" }}>48.2%</span>
          </div>
          <div className="rounded" style={{ height: 6, background: "#27272A" }}>
            <div className="h-full rounded" style={{ width: "48.2%", background: "linear-gradient(90deg, #A855F7, #7C3AED)" }} />
          </div>
        </div>
      </Card>
    </div>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [compactMode, setCompactMode] = useState(false);
  const [lineNumbers, setLineNumbers] = useState(true);
  const [wordWrap, setWordWrap] = useState(true);
  const [animations, setAnimations] = useState(true);
  const [accent, setAccent] = useState("#A855F7");
  const [fontSize, setFontSize] = useState(13);

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
            <button key={t.id} onClick={() => setTheme(t.id)}
              className="flex flex-col gap-2 flex-1 text-left">
              <div className="rounded-lg p-2 flex flex-col gap-1"
                style={{
                  background: t.bg,
                  border: `${theme === t.id ? "2px solid #A855F7" : "1px solid #27272A"}`,
                  height: 80,
                }}>
                {[0,1,2].map(i => (
                  <div key={i} className="rounded" style={{ height: 8, background: t.lineColor, borderRadius: 3 }} />
                ))}
                <div className="rounded mt-auto" style={{ height: 14, width: 28, background: theme === t.id ? "#A855F7" : "#52525B", borderRadius: 4 }} />
              </div>
              <div className="flex items-center gap-1.5">
                <div className="rounded-full" style={{ width: 8, height: 8, background: theme === t.id ? "#A855F7" : "transparent", border: theme === t.id ? "none" : "1px solid #52525B" }} />
                <span className="text-[12px] font-medium" style={{ color: theme === t.id ? "#E4E4E7" : "#71717A" }}>{t.label}</span>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Typography">
        <SettingRow label="Editor font" description="Font used in request/response body">
          <SelectBox value="Geist Mono" />
        </SettingRow>
        <SettingRow label="UI font size" description="Base size for interface text" last>
          <div className="flex items-center rounded-md overflow-hidden"
            style={{ height: 32, background: "#141414", border: "1px solid #27272A" }}>
            <button onClick={() => setFontSize(f => Math.max(11, f - 1))}
              className="flex items-center justify-center text-[#71717A] hover:text-[#A1A1AA] transition-colors"
              style={{ width: 30, height: "100%", borderRight: "1px solid #27272A", fontSize: 16 }}>−</button>
            <span className="text-[12px] text-[#E4E4E7] px-3" style={{ fontFamily: "Geist Mono, monospace", minWidth: 48, textAlign: "center" }}>{fontSize}px</span>
            <button onClick={() => setFontSize(f => Math.min(18, f + 1))}
              className="flex items-center justify-center text-[#71717A] hover:text-[#A1A1AA] transition-colors"
              style={{ width: 30, height: "100%", borderLeft: "1px solid #27272A", fontSize: 16 }}>+</button>
          </div>
        </SettingRow>
      </Card>

      <Card title="Accent Color">
        <div className="flex items-center gap-3 px-4" style={{ height: 60 }}>
          {ACCENT_COLORS.map(c => (
            <button key={c} onClick={() => setAccent(c)}
              className="flex items-center justify-center rounded-lg transition-transform hover:scale-110"
              style={{ width: 32, height: 32, background: c, border: accent === c ? "2px solid #FFFFFF" : "none" }}>
              {accent === c && (
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
          <Toggle checked={compactMode} onChange={setCompactMode} />
        </SettingRow>
        <SettingRow label="Show line numbers" description="Display line numbers in the editor">
          <Toggle checked={lineNumbers} onChange={setLineNumbers} />
        </SettingRow>
        <SettingRow label="Word wrap in editor" description="Wrap long lines in body editor">
          <Toggle checked={wordWrap} onChange={setWordWrap} />
        </SettingRow>
        <SettingRow label="Animate transitions" description="Enable smooth UI transitions" last>
          <Toggle checked={animations} onChange={setAnimations} />
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
        <ShortcutRow label="New collection"   keys={["Ctrl", "Shift", "N"]} />
        <ShortcutRow label="Save request"     keys={["Ctrl", "S"]} />
        <ShortcutRow label="Import collection" keys={["Ctrl", "O"]} last />
      </Card>
    </div>
  );
}

function ProxySection() {
  const [useSystemProxy, setUseSystemProxy] = useState(false);
  const [sslVerify, setSslVerify] = useState(true);
  const [clientCerts, setClientCerts] = useState(false);
  const [connTimeout, setConnTimeout] = useState("10000");
  const [readTimeout, setReadTimeout] = useState("30000");
  const [maxSize, setMaxSize] = useState("50");

  return (
    <div className="flex flex-col gap-6">
      <Card title="Proxy Configuration">
        <SettingRow label="Use system proxy" description="Automatically detect proxy settings from the OS">
          <Toggle checked={useSystemProxy} onChange={setUseSystemProxy} />
        </SettingRow>
        {/* HTTP Proxy row */}
        <div className="flex items-center gap-3 px-4" style={{ height: 64, borderBottom: "1px solid #1A1A1A" }}>
          <span className="text-[13px] font-medium text-[#A1A1AA] shrink-0" style={{ width: 110 }}>HTTP Proxy</span>
          <div className="flex-1 flex items-center px-3 rounded-md"
            style={{ height: 36, background: "#141414", border: "1px solid #27272A" }}>
            <span className="text-[12px] text-[#52525B]" style={{ fontFamily: "Geist Mono, monospace" }}>http://proxy.company.com</span>
          </div>
          <span className="text-[#52525B] text-sm">:</span>
          <div className="flex items-center px-3 rounded-md"
            style={{ height: 36, width: 72, background: "#141414", border: "1px solid #27272A" }}>
            <span className="text-[12px] text-[#A1A1AA]" style={{ fontFamily: "Geist Mono, monospace" }}>8080</span>
          </div>
        </div>
        {/* HTTPS Proxy row */}
        <div className="flex items-center gap-3 px-4" style={{ height: 64, borderBottom: "1px solid #1A1A1A" }}>
          <span className="text-[13px] font-medium text-[#A1A1AA] shrink-0" style={{ width: 110 }}>HTTPS Proxy</span>
          <div className="flex-1 flex items-center px-3 rounded-md"
            style={{ height: 36, background: "#141414", border: "1px solid #27272A" }}>
            <span className="text-[12px] text-[#52525B]" style={{ fontFamily: "Geist Mono, monospace" }}>https://proxy.company.com</span>
          </div>
          <span className="text-[#52525B] text-sm">:</span>
          <div className="flex items-center px-3 rounded-md"
            style={{ height: 36, width: 72, background: "#141414", border: "1px solid #27272A" }}>
            <span className="text-[12px] text-[#A1A1AA]" style={{ fontFamily: "Geist Mono, monospace" }}>8443</span>
          </div>
        </div>
        {/* No Proxy row */}
        <div className="flex items-center gap-3 px-4" style={{ height: 56 }}>
          <span className="text-[13px] font-medium text-[#A1A1AA] shrink-0" style={{ width: 110 }}>No Proxy</span>
          <div className="flex-1 flex items-center px-3 rounded-md"
            style={{ height: 36, background: "#141414", border: "1px solid #27272A" }}>
            <span className="text-[12px] text-[#71717A]" style={{ fontFamily: "Geist Mono, monospace" }}>localhost, 127.0.0.1, *.internal.com</span>
          </div>
        </div>
      </Card>

      <Card title="SSL & Certificates">
        <SettingRow label="Verify SSL certificates" description="Reject invalid or self-signed certificates">
          <Toggle checked={sslVerify} onChange={setSslVerify} />
        </SettingRow>
        <SettingRow label="Client SSL certificates" description="Use client certs for mutual TLS">
          <Toggle checked={clientCerts} onChange={setClientCerts} />
        </SettingRow>
        <div className="flex items-center gap-3 px-4" style={{ height: 56 }}>
          <span className="text-[13px] font-medium text-[#A1A1AA] shrink-0" style={{ width: 140 }}>CA Certificate</span>
          <button className="flex items-center gap-2 px-3 rounded-md transition-opacity hover:opacity-80"
            style={{ height: 34, background: "#1A1A1A", border: "1px solid #27272A" }}>
            <Upload size={13} className="text-[#71717A]" />
            <span className="text-[12px] text-[#71717A]">Upload .pem / .crt</span>
          </button>
        </div>
      </Card>

      <Card title="Network Timeouts">
        <SettingRow label="Connection timeout">
          <div className="flex items-center gap-2">
            <input value={connTimeout} onChange={e => setConnTimeout(e.target.value)}
              className="h-[34px] px-3 rounded-md text-[12px] text-right"
              style={{ background: "#141414", border: "1px solid #27272A", color: "#E4E4E7", width: 100, fontFamily: "Geist Mono, monospace" }} />
            <span className="text-[12px] text-[#52525B]">ms</span>
          </div>
        </SettingRow>
        <SettingRow label="Read timeout">
          <div className="flex items-center gap-2">
            <input value={readTimeout} onChange={e => setReadTimeout(e.target.value)}
              className="h-[34px] px-3 rounded-md text-[12px] text-right"
              style={{ background: "#141414", border: "1px solid #27272A", color: "#E4E4E7", width: 100, fontFamily: "Geist Mono, monospace" }} />
            <span className="text-[12px] text-[#52525B]">ms</span>
          </div>
        </SettingRow>
        <SettingRow label="Max response size" last>
          <div className="flex items-center gap-2">
            <input value={maxSize} onChange={e => setMaxSize(e.target.value)}
              className="h-[34px] px-3 rounded-md text-[12px] text-right"
              style={{ background: "#141414", border: "1px solid #27272A", color: "#E4E4E7", width: 100, fontFamily: "Geist Mono, monospace" }} />
            <span className="text-[12px] text-[#52525B]">MB</span>
          </div>
        </SettingRow>
      </Card>
    </div>
  );
}

function PrivacySection() {
  const [analytics, setAnalytics] = useState(false);
  const [crashReports, setCrashReports] = useState(true);
  const [perfMetrics, setPerfMetrics] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [lockOnSleep, setLockOnSleep] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function handleClearHistory() {
    setClearing(true);
    try { await clearHistory(); } finally { setClearing(false); }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Analytics & Telemetry */}
      <Card title="Analytics & Telemetry">
        <SettingRow label="Send usage analytics" description="Help improve Flux by sharing anonymous usage data">
          <Toggle checked={analytics} onChange={setAnalytics} />
        </SettingRow>
        <SettingRow label="Crash reports" description="Automatically send crash reports to help fix bugs">
          <Toggle checked={crashReports} onChange={setCrashReports} />
        </SettingRow>
        <SettingRow label="Performance metrics" description="Share performance data to improve response times" last>
          <Toggle checked={perfMetrics} onChange={setPerfMetrics} />
        </SettingRow>
      </Card>

      {/* Your Data */}
      <Card title="Your Data">
        <div className="flex items-center gap-4 px-4" style={{ height: 60, borderBottom: "1px solid #1A1A1A" }}>
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-[13px] font-medium text-[#E4E4E7]">Export all data</span>
            <span className="text-[11px] text-[#71717A]">Download a copy of your collections, environments and history</span>
          </div>
          <button className="flex items-center gap-1.5 px-3.5 rounded-md text-[12px] transition-opacity hover:opacity-80 shrink-0"
            style={{ height: 32, background: "#1A1A1A", border: "1px solid #27272A", color: "#A1A1AA" }}>
            <Download size={13} className="text-[#A1A1AA]" /> Export .zip
          </button>
        </div>
        <div className="flex items-center gap-4 px-4" style={{ height: 60, borderBottom: "1px solid #1A1A1A" }}>
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-[13px] font-medium text-[#E4E4E7]">Request history</span>
            <span className="text-[11px] text-[#71717A]">152 requests stored locally on this device</span>
          </div>
          <button onClick={handleClearHistory} disabled={clearing}
            className="flex items-center gap-1.5 px-3.5 rounded-md text-[12px] transition-opacity hover:opacity-80 disabled:opacity-40 shrink-0"
            style={{ height: 32, background: "#1A1A1A", border: "1px solid #27272A", color: "#A1A1AA" }}>
            <History size={13} className="text-[#A1A1AA]" />
            {clearing ? "Clearing…" : "Clear history"}
          </button>
        </div>
        <SettingRow label="History retention" description="How long to keep request history on this device" last>
          <div className="flex items-center gap-2 px-3 rounded-md"
            style={{ height: 34, width: 160, background: "#141414", border: "1px solid #27272A" }}>
            <span className="flex-1 text-[13px] text-[#E4E4E7]">30 days</span>
            <ChevronDown size={13} className="text-[#71717A] shrink-0" />
          </div>
        </SettingRow>
      </Card>

      {/* Sessions & Security */}
      <Card title="Sessions & Security">
        <SettingRow label="Remember me on this device" description="Stay signed in between sessions">
          <Toggle checked={rememberMe} onChange={setRememberMe} />
        </SettingRow>
        <SettingRow label="Lock on system sleep" description="Require password when waking from sleep" last>
          <Toggle checked={lockOnSleep} onChange={setLockOnSleep} />
        </SettingRow>
      </Card>

      {/* Danger Zone */}
      <div className="rounded-lg overflow-hidden" style={{ background: "#0D0D0D", border: "1px solid #EF444440" }}>
        <div className="flex items-center gap-2 px-4" style={{ height: 40, background: "#150A0A", borderBottom: "1px solid #EF444430" }}>
          <TriangleAlert size={14} className="text-[#EF4444]" />
          <span className="text-[12px] font-semibold text-[#EF4444]">Danger Zone</span>
        </div>
        <div className="flex items-center gap-4 px-4" style={{ height: 56, borderBottom: "1px solid #EF444420" }}>
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-[13px] font-medium text-[#E4E4E7]">Sign out of all devices</span>
            <span className="text-[11px] text-[#71717A]">Invalidates all active sessions across every device</span>
          </div>
          <button className="flex items-center gap-1.5 px-3.5 rounded-md text-[12px] transition-opacity hover:opacity-80 shrink-0"
            style={{ height: 32, background: "#1A1A1A", border: "1px solid #EF444440", color: "#EF4444" }}>
            <LogOut size={13} /> Sign out all
          </button>
        </div>
        <div className="flex items-center gap-4 px-4" style={{ height: 56 }}>
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-[13px] font-medium text-[#EF4444]">Delete account</span>
            <span className="text-[11px] text-[#71717A]">Permanently delete your account and all data. This cannot be undone.</span>
          </div>
          <button className="flex items-center gap-1.5 px-3.5 rounded-md text-[12px] font-medium transition-opacity hover:opacity-80 shrink-0"
            style={{ height: 32, background: "#EF444418", border: "1px solid #EF444450", color: "#EF4444" }}>
            <Trash2 size={13} /> Delete account
          </button>
        </div>
      </div>
    </div>
  );
}

function AboutSection() {
  return (
    <div className="flex flex-col gap-6">
      <Card title="About Flux">
        <div className="p-4 flex flex-col gap-3">
          <p className="text-[13px] text-[#A1A1AA]">The modern API client for developers. Local-first, git-native, AI-powered.</p>
          <p className="text-[12px] text-[#71717A]">Built with Tauri · React · Rust · Claude</p>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded"
              style={{ background: "#A855F720", border: "1px solid #A855F740" }}>
              <span className="text-[12px] font-medium text-[#A855F7]" style={{ fontFamily: "Geist Mono, monospace" }}>v0.1.0-beta</span>
            </div>
          </div>
        </div>
      </Card>
      <Card title="Licenses">
        <div className="p-4">
          <p className="text-[12px] text-[#71717A]">MIT License · Open source dependencies listed in the repository.</p>
        </div>
      </Card>
    </div>
  );
}

/* ─── ROOT ─── */

export function SettingsRoute() {
  const [section, setSection] = useState<Section>("general");

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* Sidebar */}
      <aside className="flex flex-col shrink-0 h-full" style={{ width: 220, background: "#0F0F0F", borderRight: "1px solid #27272A" }}>
        <div className="flex items-center px-4 shrink-0" style={{ height: 44, borderBottom: "1px solid #27272A" }}>
          <span className="text-[12px] font-medium text-[#A1A1AA]">Settings</span>
        </div>
        <nav className="flex-1 overflow-y-auto py-1">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setSection(id)}
              className="flex items-center gap-2.5 w-full px-4 transition-colors hover:bg-[#1A1A1A]"
              style={{
                height: 36,
                background: section === id ? "#1A1A1A" : "transparent",
                borderLeft: section === id ? "2px solid #A855F7" : "2px solid transparent",
                color: section === id ? "#E4E4E7" : "#71717A",
              }}>
              <Icon size={15} style={{ color: section === id ? "#A855F7" : "#52525B" }} />
              <span className="text-[13px]">{label}</span>
            </button>
          ))}
        </nav>
        <div className="px-4 py-4 shrink-0" style={{ borderTop: "1px solid #27272A" }}>
          <span className="text-[11px] px-2 py-0.5 rounded"
            style={{ background: "#A855F720", color: "#A855F7", fontFamily: "Geist Mono, monospace" }}>
            v0.1.0-beta
          </span>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#0A0A0A" }}>
        <div className="flex items-center shrink-0 px-8" style={{ height: 52, borderBottom: "1px solid #27272A" }}>
          <h2 className="text-[16px] font-semibold text-white" style={{ fontFamily: "Geist, Inter, sans-serif" }}>
            {SECTIONS.find(s => s.id === section)?.label}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto px-8 py-7">
          {section === "general"    && <GeneralSection />}
          {section === "ai"         && <AiSection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "keyboard"   && <KeyboardSection />}
          {section === "proxy"      && <ProxySection />}
          {section === "privacy"    && <PrivacySection />}
          {section === "about"      && <AboutSection />}
        </div>
      </div>
    </div>
  );
}
