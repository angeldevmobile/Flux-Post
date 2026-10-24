import { useEffect, useMemo, useState } from "react";
import { X, Link2, Copy, Check, Loader2, ShieldCheck, AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useUserStore } from "@/stores/user";
import {
  sanitizeForShare, hasUnscannedContent, createShare, listMyShares, revokeShare, shareUrl,
  type CreatedShare, type MyShare,
} from "@/lib/share";
import { trackEvent } from "@/lib/analytics";
import type { Collection } from "@/stores/collections";

interface Props {
  collection: Collection | null;
  onClose: () => void;
}

const EXPIRY: { label: string; days: number | null }[] = [
  { label: "Never", days: null },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
];

function countRequests(col: Collection): number {
  const walk = (fs: Collection["folders"]): number =>
    fs.reduce((n, f) => n + f.requests.length + walk(f.folders ?? []), 0);
  return col.requests.length + walk(col.folders);
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Link copied");
  } catch {
    toast.error("Could not copy. Select the link and copy it by hand.");
  }
}

/**
 * Crear un link de solo lectura a una copia de la coleccion, y gestionar los
 * que ya hay. Ver `src/lib/share.ts`.
 */
export function ShareModal({ collection, onClose }: Props) {
  const user = useUserStore(s => s.user);
  const [expiry, setExpiry] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedShare | null>(null);
  const [copied, setCopied] = useState(false);
  const [mine, setMine] = useState<MyShare[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  // Lo que se va a quitar se calcula con la coleccion en pantalla: es lo mismo
  // que hara `createShare` al subir, y el usuario lo ve antes de pulsar.
  const preview = useMemo(() => collection ? sanitizeForShare(collection) : null, [collection]);
  const unscanned = useMemo(() => collection ? hasUnscannedContent(collection) : false, [collection]);

  useEffect(() => {
    setCreated(null);
    setCopied(false);
    if (!collection || !user) return;
    listMyShares().then(setMine).catch(() => setMine([]));
  }, [collection, user]);

  if (!collection) return null;

  async function handleCreate() {
    if (!collection) return;
    setCreating(true);
    try {
      const share = await createShare(collection, expiry);
      setCreated(share);
      trackEvent("share_create", { requests: countRequests(collection), expires: expiry ?? 0 });
      await copy(share.url);
      setCopied(true);
      listMyShares().then(setMine).catch(() => {});
    } catch (e) {
      toast.error(`Could not create the link: ${e instanceof Error ? e.message : e}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevoking(id);
    try {
      await revokeShare(id);
      setMine(m => (m ?? []).filter(s => s.id !== id));
      if (created?.id === id) setCreated(null);
      toast.success("Link revoked. It no longer opens.");
    } catch (e) {
      toast.error(`Could not revoke: ${e instanceof Error ? e.message : e}`);
    } finally {
      setRevoking(null);
    }
  }

  async function handleSignIn() {
    const { setLocalMode } = await import("@/lib/localMode");
    setLocalMode(false);
    window.location.reload();
  }

  const redactions = preview?.redactions ?? [];
  const linksForThis = (mine ?? []).filter(s => s.name === collection.name);
  const otherLinks = (mine ?? []).filter(s => s.name !== collection.name);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="flex flex-col rounded-xl shadow-2xl"
        style={{ width: 520, maxHeight: "80vh", background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>

        <div className="flex items-center gap-2 shrink-0 px-4"
          style={{ height: 48, borderBottom: "1px solid var(--color-border)" }}>
          <Link2 size={15} style={{ color: "var(--color-accent)" }} />
          <span className="flex-1 text-[13px] font-semibold truncate" style={{ color: "var(--color-fg)" }}>
            Share “{collection.name}”
          </span>
          <button onClick={onClose}
            className="flex items-center justify-center rounded transition-colors"
            style={{ width: 26, height: 26, color: "var(--color-fg-3)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--color-card)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 flex flex-col gap-3 p-4 overflow-auto">
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--color-fg-3)" }}>
            Anyone with the link can view and import a copy of this collection, without an account.
            It is a snapshot: later edits are not sent, and nothing they change comes back.
            Environments are never included.
          </p>

          {/* Lo que se quita */}
          <div className="rounded-lg p-3 flex flex-col gap-1.5"
            style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "var(--color-fg-2)" }}>
              <ShieldCheck size={12} style={{ color: "#22C55E" }} />
              {redactions.length === 0
                ? "No literal credentials found in auth, headers or query params."
                : `${redactions.length} credential${redactions.length === 1 ? "" : "s"} will be replaced by variables:`}
            </div>
            {redactions.length > 0 && (
              <ul className="flex flex-col gap-0.5 pl-4 max-h-28 overflow-auto">
                {redactions.map((r, i) => (
                  <li key={i} className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>
                    {r.where} → <code style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg-2)" }}>{`{{${r.variable}}}`}</code>
                  </li>
                ))}
              </ul>
            )}
            {unscanned && (
              <div className="flex items-start gap-1.5 text-[11px] mt-1" style={{ color: "#F59E0B" }}>
                <AlertTriangle size={12} className="shrink-0 mt-px" />
                Request bodies and scripts are shared as they are. Check they hold no secrets.
              </div>
            )}
          </div>

          {!user ? (
            <div className="flex items-center gap-2 rounded-lg p-3"
              style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
              <span className="flex-1 text-[11px]" style={{ color: "var(--color-fg-2)" }}>
                Creating a link needs an account. Opening one does not.
              </span>
              <button onClick={() => void handleSignIn()}
                className="px-3 rounded text-[12px] font-semibold text-white"
                style={{ height: 28, background: "var(--color-accent)" }}>
                Sign in
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>Expires</span>
                {EXPIRY.map(o => (
                  <button key={o.label} onClick={() => setExpiry(o.days)}
                    className="px-2 rounded text-[11px]"
                    style={{
                      height: 24,
                      background: expiry === o.days ? "var(--color-accent)" : "var(--color-card)",
                      color: expiry === o.days ? "#fff" : "var(--color-fg-2)",
                      border: "1px solid var(--color-border)",
                    }}>
                    {o.label}
                  </button>
                ))}
                <div className="flex-1" />
                <button onClick={() => void handleCreate()} disabled={creating}
                  className="flex items-center gap-1.5 px-4 rounded font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  style={{ height: 30, fontSize: 12, background: "var(--color-accent)" }}>
                  {creating ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
                  Create link
                </button>
              </div>

              {created && (
                <div className="flex items-center gap-2 rounded-lg p-2"
                  style={{ background: "#22C55E12", border: "1px solid #22C55E30" }}>
                  <input readOnly value={created.url} onFocus={e => e.currentTarget.select()}
                    className="flex-1 bg-transparent text-[11px] outline-none"
                    style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg)" }} />
                  <button onClick={() => { void copy(created.url); setCopied(true); }}
                    className="flex items-center gap-1 px-2 rounded text-[11px]"
                    style={{ height: 24, background: "var(--color-card)", color: "var(--color-fg-2)", border: "1px solid var(--color-border)" }}>
                    {copied ? <Check size={11} /> : <Copy size={11} />} Copy
                  </button>
                </div>
              )}

              {mine && mine.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium mt-1" style={{ color: "var(--color-fg-2)" }}>Your active links</span>
                  {[...linksForThis, ...otherLinks].map(s => (
                    <div key={s.id} className="flex items-center gap-2 rounded px-2"
                      style={{ height: 30, background: "var(--color-card)" }}>
                      <span className="flex-1 text-[11px] truncate" style={{ color: s.name === collection.name ? "var(--color-fg)" : "var(--color-fg-3)" }}>
                        {s.name}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--color-fg-4)" }}>
                        {s.openCount} open{s.openCount === 1 ? "" : "s"}
                        {" · "}
                        {s.expiresAt ? `expires ${new Date(s.expiresAt).toLocaleDateString()}` : "no expiry"}
                      </span>
                      <button onClick={() => void copy(shareUrl(s.id))} title="Copy link"
                        className="flex items-center justify-center rounded"
                        style={{ width: 22, height: 22, color: "var(--color-fg-3)" }}>
                        <Copy size={11} />
                      </button>
                      <button onClick={() => void handleRevoke(s.id)} disabled={revoking === s.id} title="Revoke link"
                        className="flex items-center justify-center rounded"
                        style={{ width: 22, height: 22, color: "#EF4444" }}>
                        {revoking === s.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
