import { useMemo, useState } from "react";
import { X, Shield, Plus, Trash2, Loader2 } from "lucide-react";
import { CodeEditor } from "@/components/CodeEditor";
import { findFolder, updateFolder, compactHeaders } from "@/lib/collectionTree";
import { resolveFolderAncestors } from "@/lib/inheritance";
import {
  buildScopeAuth,
  buildScopeScripts,
  choiceFromAuth,
  type AuthChoice,
} from "@/lib/scopeSettings";
import type { Collection, CollectionAuth } from "@/lib/tauri";

/**
 * Editor del auth, los headers y los scripts que una coleccion o una carpeta
 * pasan a todo lo que cuelga de ellas.
 *
 * Sin esto la herencia solo se podia configurar editando el YAML a mano.
 */

interface Props {
  collection: Collection;
  /** null = se edita la coleccion entera. */
  folderId: string | null;
  saving: boolean;
  onClose: () => void;
  onSave: (updated: Collection) => void;
}

type Tab = "auth" | "headers" | "scripts";

interface HeaderRow {
  id: number;
  key: string;
  value: string;
}

function toRows(headers: Record<string, string> | undefined): HeaderRow[] {
  return Object.entries(headers ?? {}).map(([key, value], i) => ({ id: i, key, value }));
}

export function InheritanceModal({ collection, folderId, saving, onClose, onSave }: Props) {
  const isFolder = folderId !== null;
  const target = useMemo(
    () => (isFolder ? findFolder(collection, folderId) : collection),
    [collection, folderId, isFolder],
  );

  const inheritedFromAbove = useMemo(
    () => (isFolder ? resolveFolderAncestors(collection, folderId) : null),
    [collection, folderId, isFolder],
  );

  const [tab, setTab] = useState<Tab>("auth");
  const [choice, setChoice] = useState<AuthChoice>(() =>
    choiceFromAuth(target?.auth, isFolder),
  );
  const [auth, setAuth] = useState<CollectionAuth>(() => target?.auth ?? { type: "none" });
  const [rows, setRows] = useState<HeaderRow[]>(() => toRows(target?.headers));
  const [nextRowId, setNextRowId] = useState(() => toRows(target?.headers).length);
  const [preRequest, setPreRequest] = useState(target?.scripts?.preRequest ?? "");
  const [postResponse, setPostResponse] = useState(target?.scripts?.postResponse ?? "");

  // Una carrera de recarga puede dejar el id sin carpeta; no se renderiza a medias.
  if (!target) return null;

  const scopeLabel = isFolder ? `Folder · ${target.name}` : `Collection · ${collection.name}`;

  function patch(field: keyof CollectionAuth, value: string) {
    setAuth((a) => ({ ...a, [field]: value }));
  }

  function handleSave() {
    if (saving) return;

    const headers = compactHeaders(rows);

    const changes = {
      auth: buildScopeAuth(choice, auth, isFolder),
      scripts: buildScopeScripts(preRequest, postResponse),
      // Un mapa vacio se omite del YAML, que es lo que hace el serializador.
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    };

    onSave(
      isFolder
        ? updateFolder(collection, folderId, changes)
        : { ...collection, ...changes },
    );
  }

  const label = (text: string) => (
    <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--color-fg-4)" }}>
      {text}
    </span>
  );

  const input = (
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    mono = true,
  ) => (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      className="w-full px-2 rounded text-[11px]"
      style={{
        height: 28,
        background: "var(--color-input)",
        border: "1px solid var(--color-border)",
        color: "var(--color-fg-2)",
        fontFamily: mono ? "Geist Mono, monospace" : undefined,
        outline: "none",
      }}
    />
  );

  const AUTH_CHOICES: { id: AuthChoice; label: string }[] = [
    ...(isFolder
      ? [{ id: "inherit" as AuthChoice, label: "Inherit" }]
      : []),
    { id: "none", label: isFolder ? "None (stop inheriting)" : "None" },
    { id: "bearer", label: "Bearer" },
    { id: "basic", label: "Basic" },
    { id: "apikey", label: "API Key" },
    { id: "oauth2", label: "OAuth 2.0 token" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex flex-col rounded-xl shadow-2xl"
        style={{
          width: 560,
          maxHeight: "82vh",
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
        }}
      >
        {/* Title bar */}
        <div
          className="flex items-center gap-2 shrink-0 px-4"
          style={{ height: 48, borderBottom: "1px solid var(--color-border)" }}
        >
          <Shield size={15} style={{ color: "var(--color-accent)" }} />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold truncate" style={{ color: "var(--color-fg)" }}>
              Inherited settings
            </div>
            <div className="text-[10px] truncate" style={{ color: "var(--color-fg-4)" }}>
              {scopeLabel}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded transition-colors"
            style={{ width: 26, height: 26, color: "var(--color-fg-3)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-card)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <X size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div
          className="flex shrink-0 px-4 gap-1"
          style={{ height: 40, borderBottom: "1px solid var(--color-border)", alignItems: "flex-end" }}
        >
          {([
            ["auth", "Auth"],
            ["headers", `Headers${rows.length ? ` (${rows.length})` : ""}`],
            ["scripts", "Scripts"],
          ] as [Tab, string][]).map(([id, text]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex items-center gap-1.5 px-3 text-[12px] transition-colors rounded-t"
              style={{
                height: 32,
                paddingBottom: 2,
                color: tab === id ? "var(--color-fg)" : "var(--color-fg-3)",
                borderBottom: tab === id ? "2px solid var(--color-accent)" : "2px solid transparent",
              }}
            >
              {text}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col gap-3 p-4 overflow-auto" style={{ minHeight: 260 }}>
          <p className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>
            {isFolder
              ? "Applies to every request in this folder and its subfolders. A request that sets its own value wins."
              : "Applies to every request in this collection. A folder or a request that sets its own value wins."}
          </p>

          {tab === "auth" && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                {label("Type")}
                <div className="flex flex-wrap gap-1">
                  {AUTH_CHOICES.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setChoice(c.id)}
                      className="px-2.5 rounded text-[11px] transition-colors"
                      style={{
                        height: 26,
                        background: choice === c.id ? "var(--color-accent-10)" : "var(--color-card)",
                        border: `1px solid ${choice === c.id ? "var(--color-accent)" : "var(--color-border)"}`,
                        color: choice === c.id ? "var(--color-fg)" : "var(--color-fg-3)",
                      }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {choice === "inherit" && (
                <div
                  className="rounded p-2 text-[11px]"
                  style={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-fg-3)",
                  }}
                >
                  {inheritedFromAbove?.authSource
                    ? `Uses ${inheritedFromAbove.auth?.type} from ${inheritedFromAbove.authSource.kind} "${inheritedFromAbove.authSource.name}".`
                    : "Nothing above defines auth, so requests here send none."}
                </div>
              )}

              {choice === "none" && isFolder && (
                <div
                  className="rounded p-2 text-[11px]"
                  style={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-fg-3)",
                  }}
                >
                  Requests here send no auth, even if the collection defines one.
                </div>
              )}

              {(choice === "bearer" || choice === "oauth2") && (
                <div className="flex flex-col gap-1.5">
                  {label("Token")}
                  {input(auth.token ?? "", (v) => patch("token", v), "{{TOKEN}}")}
                </div>
              )}

              {choice === "basic" && (
                <>
                  <div className="flex flex-col gap-1.5">
                    {label("Username")}
                    {input(auth.username ?? "", (v) => patch("username", v), "{{USER}}")}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {label("Password")}
                    {input(auth.password ?? "", (v) => patch("password", v), "{{PASSWORD}}")}
                  </div>
                </>
              )}

              {choice === "apikey" && (
                <>
                  <div className="flex flex-col gap-1.5">
                    {label("Key")}
                    {input(auth.key ?? "", (v) => patch("key", v), "X-API-Key")}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {label("Value")}
                    {input(auth.value ?? "", (v) => patch("value", v), "{{API_KEY}}")}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {label("Send in")}
                    <div className="flex gap-1">
                      {(["header", "query"] as const).map((where) => (
                        <button
                          key={where}
                          onClick={() => patch("in", where)}
                          className="px-2.5 rounded text-[11px] transition-colors"
                          style={{
                            height: 26,
                            background:
                              (auth.in ?? "header") === where
                                ? "var(--color-accent-10)"
                                : "var(--color-card)",
                            border: `1px solid ${(auth.in ?? "header") === where ? "var(--color-accent)" : "var(--color-border)"}`,
                            color:
                              (auth.in ?? "header") === where ? "var(--color-fg)" : "var(--color-fg-3)",
                          }}
                        >
                          {where}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {choice !== "inherit" && choice !== "none" && (
                <p className="text-[10px]" style={{ color: "var(--color-fg-4)" }}>
                  Use <code style={{ fontFamily: "Geist Mono, monospace" }}>{"{{VAR}}"}</code> instead
                  of pasting a secret — the collection file is meant to be committed.
                </p>
              )}
            </div>
          )}

          {tab === "headers" && (
            <div className="flex flex-col gap-2">
              {rows.length === 0 && (
                <p className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>
                  No headers yet.
                </p>
              )}
              {rows.map((row) => (
                <div key={row.id} className="flex items-center gap-2">
                  {input(
                    row.key,
                    (v) => setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, key: v } : r))),
                    "X-Header-Name",
                  )}
                  {input(
                    row.value,
                    (v) => setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, value: v } : r))),
                    "value or {{VAR}}",
                  )}
                  <button
                    onClick={() => setRows((rs) => rs.filter((r) => r.id !== row.id))}
                    className="flex items-center justify-center rounded shrink-0 transition-colors"
                    style={{ width: 26, height: 26, color: "var(--color-fg-4)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-card)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    aria-label="Remove header"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  setRows((rs) => [...rs, { id: nextRowId, key: "", value: "" }]);
                  setNextRowId((n) => n + 1);
                }}
                className="flex items-center gap-1.5 px-2.5 rounded text-[11px] self-start transition-opacity hover:opacity-80"
                style={{
                  height: 26,
                  background: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-fg-2)",
                }}
              >
                <Plus size={12} /> Add header
              </button>
            </div>
          )}

          {tab === "scripts" && (
            <div className="flex flex-col gap-3">
              <p className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>
                These run before the ones on the request, not instead of them.
              </p>
              <div className="flex flex-col gap-1.5">
                {label("Pre-request")}
                <div style={{ height: 110 }}>
                  <CodeEditor
                    value={preRequest}
                    onChange={setPreRequest}
                    lang="javascript"
                    placeholder='pm.request.headers.upsert("X-Trace", crypto.randomUUID());'
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {label("Post-response")}
                <div style={{ height: 110 }}>
                  <CodeEditor
                    value={postResponse}
                    onChange={setPostResponse}
                    lang="javascript"
                    placeholder='pm.test("is ok", () => pm.expect(pm.response.status).to.equal(200));'
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-2 shrink-0 px-4"
          style={{ height: 52, borderTop: "1px solid var(--color-border)" }}
        >
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-3 rounded text-[12px] transition-opacity hover:opacity-80"
            style={{
              height: 30,
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              color: "var(--color-fg-2)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-1.5 px-4 rounded font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ height: 30, fontSize: 12, background: "var(--color-accent)" }}
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
