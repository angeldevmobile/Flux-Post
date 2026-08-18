import { useState, useEffect, useCallback } from "react";
import { ArrowRight, ArrowLeft, X } from "lucide-react";
import { useSettingsStore } from "@/stores/settings";

type Position = "right" | "left" | "bottom" | "top";

interface Step {
  title: string;
  body: string;
  target?: string;
  position?: Position;
}

const STEPS: Step[] = [
  {
    title: "Welcome to Flux",
    body: "Your new API client — lightweight, offline-first, and AI-powered. This takes 30 seconds.",
  },
  {
    title: "Everything in one sidebar",
    body: "Switch between Requests, Collections, Environments, Tests, History, Compare, WebSocket, and SSE. Your full workflow, one click away.",
    target: "navrail",
    position: "right",
  },
  {
    title: "Build any request",
    body: "Pick a method, enter a URL, and press Send — or hit Ctrl+Enter. Use the tabs below to add headers, auth, a body, or pre/post-request scripts.",
    target: "request-builder",
    position: "bottom",
  },
  {
    title: "Stop hardcoding values",
    body: "Create environments (Dev, Staging, Prod) and use {{BASE_URL}} in any URL, header, or body. Switch environments in one click — no copy-pasting.",
    target: "env-selector",
    position: "bottom",
  },
  {
    title: "Everything in the response",
    body: "Status, headers, cookies, body with syntax highlighting. The Tests tab shows your pm.test() results and the Console tab logs your scripts.",
    target: "response-panel",
    position: "left",
  },
  {
    title: "AI that actually helps",
    body: "After any response, Claude can generate test assertions, explain 4xx/5xx errors, and fix failing tests. Free to try during the beta: 100 actions a month, no setup. Add your own API key for unlimited use, and requests go straight from your machine to Anthropic.",
    target: "ai-panel",
    position: "left",
  },
  {
    title: "You're all set",
    body: "Need this tour again? Open Settings → General → Launch Tour.\n\nStart with: GET https://jsonplaceholder.typicode.com/posts/1",
  },
];

const TOOLTIP_W = 280;
const SPOT_PAD = 8;
const GAP = 14;

interface Rect { top: number; left: number; width: number; height: number; }

function getRect(target: string): Rect | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function computeTooltipPos(rect: Rect, pos: Position): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.max(8, Math.min(x, vw - TOOLTIP_W - 8));
  const clampY = (y: number) => Math.max(8, Math.min(y, vh - 220 - 8));

  switch (pos) {
    case "right":
      return { top: clampY(rect.top + rect.height / 2 - 90), left: rect.left + rect.width + SPOT_PAD + GAP };
    case "left":
      return { top: clampY(rect.top + rect.height / 2 - 90), left: clampX(rect.left - TOOLTIP_W - SPOT_PAD - GAP) };
    case "bottom":
      return { top: rect.top + rect.height + SPOT_PAD + GAP, left: clampX(rect.left + rect.width / 2 - TOOLTIP_W / 2) };
    case "top":
      return { top: clampY(rect.top - SPOT_PAD - GAP - 200), left: clampX(rect.left + rect.width / 2 - TOOLTIP_W / 2) };
  }
}

interface ProductTourProps {
  open: boolean;
  onDone: () => void;
}

export function ProductTour({ open, onDone }: ProductTourProps) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const setTourSeen = useSettingsStore(s => s.setTourSeen);

  const current = STEPS[step];

  const updateRect = useCallback(() => {
    if (!current.target) { setRect(null); return; }
    setRect(getRect(current.target));
  }, [current.target]);

  // Reset to step 0 each time tour opens
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  // Update rect on step change and window resize
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(updateRect, 50);
    const onResize = () => updateRect();
    window.addEventListener("resize", onResize);
    return () => { clearTimeout(id); window.removeEventListener("resize", onResize); };
  }, [open, step, updateRect]);

  function done() {
    setTourSeen(true);
    onDone();
  }

  function next() {
    if (step === STEPS.length - 1) { done(); return; }
    setStep(s => s + 1);
  }

  function prev() {
    if (step > 0) setStep(s => s - 1);
  }

  if (!open) return null;

  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;
  const isModal = !current.target || !rect;

  const Dots = () => (
    <div className="flex items-center gap-1">
      {STEPS.map((_, i) => (
        <div key={i} style={{
          width: i === step ? 16 : 6,
          height: 6,
          borderRadius: 3,
          background: i === step ? "var(--color-accent)" : "var(--color-fg-4)",
          transition: "width 0.2s, background 0.2s",
          flexShrink: 0,
        }} />
      ))}
    </div>
  );

  const Card = () => (
    <div style={{
      width: TOOLTIP_W,
      background: "var(--color-elevated)",
      border: "1px solid var(--color-border)",
      borderRadius: 12,
      padding: 16,
      boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[14px] font-semibold" style={{ color: "var(--color-fg)", lineHeight: 1.3 }}>
          {current.title}
        </span>
        <button
          onClick={done}
          className="shrink-0 flex items-center justify-center rounded transition-opacity hover:opacity-70"
          style={{ width: 20, height: 20, color: "var(--color-fg-4)", marginTop: 1 }}
        >
          <X size={13} />
        </button>
      </div>
      <p className="text-[12px] whitespace-pre-line" style={{ color: "var(--color-fg-3)", lineHeight: 1.65 }}>
        {current.body}
      </p>
      <div className="flex items-center justify-between pt-1">
        <Dots />
        <div className="flex items-center gap-1.5">
          {!isFirst && (
            <button
              onClick={prev}
              className="flex items-center gap-1 px-2.5 rounded-md text-[12px] transition-opacity hover:opacity-80"
              style={{ height: 28, border: "1px solid var(--color-border)", color: "var(--color-fg-3)", background: "transparent" }}
            >
              <ArrowLeft size={12} />
              Back
            </button>
          )}
          <button
            onClick={next}
            className="flex items-center gap-1.5 px-3 rounded-md text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ height: 28, background: "var(--color-accent)" }}
          >
            {isLast ? "Let's go" : "Next"}
            {!isLast && <ArrowRight size={12} />}
          </button>
        </div>
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.78)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Card />
      </div>
    );
  }

  const tipPos = computeTooltipPos(rect, current.position!);

  return (
    <>
      {/* Full-screen click blocker (prevents interacting with app during tour) */}
      <div style={{ position: "fixed", inset: 0, zIndex: 998 }} />
      {/* Spotlight: transparent div whose box-shadow dims everything around it */}
      <div style={{
        position: "fixed",
        top: rect.top - SPOT_PAD,
        left: rect.left - SPOT_PAD,
        width: rect.width + SPOT_PAD * 2,
        height: rect.height + SPOT_PAD * 2,
        borderRadius: 10,
        boxShadow: "0 0 0 9999px rgba(0,0,0,0.78)",
        zIndex: 999,
        pointerEvents: "none",
      }} />
      {/* Tooltip */}
      <div style={{ position: "fixed", zIndex: 1000, ...tipPos }}>
        <Card />
      </div>
    </>
  );
}
