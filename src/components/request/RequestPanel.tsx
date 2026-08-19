import { useState, useId, useRef, useEffect } from "react";
import { useAiAvailable } from "@/lib/aiAvailable";
import { toast } from "sonner";
import { Send, Plus, Trash2, ChevronDown, Bookmark, Eye, EyeOff, FileUp, X, Code2, TriangleAlert } from "lucide-react";
import { useRequestStore } from "@/stores/request";
import type { AuthType, ApiKeyTarget, OAuthGrantType } from "@/stores/request";
import { sendRequest, saveHistory, saveCollection, editContent } from "@/lib/tauri";
import { networkOptions } from "@/lib/networkOptions";
import { trackEvent, trackCrash, trackPerf } from "@/lib/analytics";
import { pushHistory, pushCollection } from "@/lib/sync";
import { useUserStore } from "@/stores/user";
import { methodColor, methodBg, HTTP_METHODS } from "@/lib/methods";
import { useEnvironmentStore } from "@/stores/environment";
import { useCollectionsStore } from "@/stores/collections";
import { runPreRequestScript, runPostResponseScript } from "@/lib/preRequest";
import { useTestResultsStore } from "@/stores/testResults";
import { useSettingsStore } from "@/stores/settings";
import { CodeEditor } from "@/components/CodeEditor";
import { fetchGraphQLSchema, setCurrentSchema } from "@/lib/graphqlIntrospection";
import { SnippetModal } from "@/components/SnippetModal";
import { evaluatePath } from "@/lib/jsonpath";
import { toCollectionRequest, findLiteralSecrets, type LiteralSecret, type RequestSnapshot } from "@/lib/requestFidelity";
import type { Extractor } from "@/stores/request";
import type { CollectionFolder } from "@/stores/collections";

const DIR_KEY = "flux_collections_dir";

/** Older collections may lack `headers` or `tests`; fill them in at any depth. */
function normalizeFolders(folders: CollectionFolder[]): CollectionFolder[] {
  return folders.map(f => ({
    ...f,
    requests: f.requests.map(r => ({ ...r, headers: r.headers ?? {}, tests: r.tests ?? [] })),
    folders: normalizeFolders(f.folders ?? []),
  }));
}


function SavePopover({ onClose }: { onClose: () => void }) {
  const url = useRequestStore(s => s.url);
  const { collections } = useCollectionsStore();
  const { updateEnvironment, toggleSecretKey, setGlobalVariable, toggleGlobalSecretKey } = useEnvironmentStore();
  const [name, setName] = useState(url.split("/").filter(Boolean).pop() ?? "New request");
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [secrets, setSecrets] = useState<LiteralSecret[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  /** Moves a pasted credential into the active environment and leaves a {{VAR}} behind. */
  function convertToVariable(secret: LiteralSecret) {
    const { environments, activeId } = useEnvironmentStore.getState();
    const env = environments.find(e => e.id === activeId);

    if (env) {
      updateEnvironment(env.id, { variables: { ...env.variables, [secret.suggested]: secret.value } });
      if (!(env.secretKeys ?? []).includes(secret.suggested)) toggleSecretKey(env.id, secret.suggested);
    } else {
      // No environment selected, so globals are the only place it can live.
      setGlobalVariable(secret.suggested, secret.value);
      if (!useEnvironmentStore.getState().globalSecretKeys.includes(secret.suggested)) {
        toggleGlobalSecretKey(secret.suggested);
      }
    }

    useRequestStore.setState({ [secret.field]: `{{${secret.suggested}}}` } as never);
    setSecrets(prev => prev.filter(s => s.field !== secret.field));
    toast.success(`Moved to {{${secret.suggested}}}`);
  }

  async function handleSave(force = false) {
    const dir = localStorage.getItem(DIR_KEY);
    if (!dir || !collectionId) return;
    const col = collections.find(c => c.id === collectionId);
    if (!col) return;

    const snapshot = useRequestStore.getState() as unknown as RequestSnapshot;

    // Warn before writing a literal credential into a file the GitHub sync commits.
    if (!force) {
      const found = findLiteralSecrets(snapshot, name);
      if (found.length > 0) {
        setSecrets(found);
        return;
      }
    }

    setSaving(true);
    try {
      const updated = {
        ...col,
        requests: [
          ...col.requests.map(r => ({ ...r, headers: r.headers ?? {}, tests: r.tests ?? [] })),
          toCollectionRequest(snapshot, { id: `${col.id}-${Date.now()}`, name }),
        ],
        folders: normalizeFolders(col.folders),
      };
      await saveCollection(dir, updated);
      useCollectionsStore.setState({ collections: useCollectionsStore.getState().collections.map(c => c.id === col.id ? updated : c) });
      const userId = useUserStore.getState().user?.id;
      if (userId) pushCollection(userId, updated);
      toast.success(`Saved to ${col.name}`);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={ref} className="absolute top-full right-0 mt-1 z-50 rounded-lg p-3 flex flex-col gap-2"
      style={{ width: 280, background: "var(--color-card)", border: "1px solid var(--color-border)", boxShadow: "0 8px 32px #00000060" }}>
      <span className="text-[12px] font-semibold" style={{ color: "var(--color-fg)" }}>Save to collection</span>
      <input value={name} onChange={e => setName(e.target.value)}
        placeholder="Request name"
        className="w-full px-2 rounded text-[12px]"
        style={{ height: 30, background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }} />
      {collections.length > 0 ? (
        <select value={collectionId} onChange={e => setCollectionId(e.target.value)}
          className="w-full px-2 rounded text-[12px]"
          style={{ height: 30, background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)" }}>
          {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      ) : (
        <p className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>No collections loaded — set a folder first.</p>
      )}
      {secrets.length > 0 && (
        <div className="flex flex-col gap-2 rounded p-2"
          style={{ background: "var(--color-amber-10, #F59E0B18)", border: "1px solid #F59E0B50" }}>
          <div className="flex items-start gap-1.5">
            <TriangleAlert size={12} style={{ color: "#F59E0B", flexShrink: 0, marginTop: 1 }} />
            <span className="text-[11px]" style={{ color: "var(--color-fg-2)", lineHeight: 1.5 }}>
              {secrets.length === 1 ? "This credential would be" : "These credentials would be"} written
              in plain text into the collection file.
            </span>
          </div>
          {secrets.map(s => (
            <div key={String(s.field)} className="flex flex-col gap-1">
              <span className="text-[10px]" style={{ color: "var(--color-fg-3)" }}>{s.label}</span>
              <button onClick={() => convertToVariable(s)}
                className="flex items-center justify-center w-full rounded transition-opacity hover:opacity-80"
                style={{ height: 26, fontSize: 11, background: "var(--color-accent-20)", color: "var(--color-accent)", border: "1px solid var(--color-accent-50)" }}>
                Move to {`{{${s.suggested}}}`}
              </button>
            </div>
          ))}
          <button onClick={() => handleSave(true)}
            className="text-[10px] underline transition-opacity hover:opacity-80"
            style={{ color: "var(--color-fg-4)" }}>
            Save anyway
          </button>
        </div>
      )}
      <button onClick={() => handleSave()} disabled={saving || !collectionId || !name}
        className="flex items-center justify-center gap-1.5 w-full rounded-md font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        style={{ height: 28, fontSize: 12, background: "var(--color-accent)" }}>
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

function MethodSelector() {
  const { method, setMethod } = useRequestStore();
  const [open, setOpen] = useState(false);
  const color = methodColor(method);
  const bg = methodBg(method);

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 rounded-md font-bold transition-opacity hover:opacity-80"
        style={{
          height: 32, fontSize: 12, fontFamily: "Geist Mono, monospace",
          color, background: bg, border: `1px solid ${color}40`,
        }}>
        {method}
        <ChevronDown size={12} style={{ color }} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 rounded-lg overflow-hidden py-1"
          style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", minWidth: 120 }}>
          {HTTP_METHODS.map(m => (
            <button key={m} onClick={() => { setMethod(m); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-1.5 transition-colors"
              style={{ fontSize: 12, fontFamily: "Geist Mono, monospace", fontWeight: 700, color: methodColor(m) }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--color-border)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Tab = "Params" | "Headers" | "Auth" | "Body" | "Pre-req" | "Post-req" | "Extract";

function AuthTab() {
  const {
    authType, setAuthType,
    authBearer, setAuthBearer,
    authBasicUser, setAuthBasicUser,
    authBasicPass, setAuthBasicPass,
    authApiKeyName, setAuthApiKeyName,
    authApiKeyValue, setAuthApiKeyValue,
    authApiKeyIn, setAuthApiKeyIn,
    authOAuthGrantType, setAuthOAuthGrantType,
    authOAuthClientId, setAuthOAuthClientId,
    authOAuthClientSecret, setAuthOAuthClientSecret,
    authOAuthAuthUrl, setAuthOAuthAuthUrl,
    authOAuthTokenUrl, setAuthOAuthTokenUrl,
    authOAuthScopes, setAuthOAuthScopes,
    authOAuthToken, setAuthOAuthToken,
    authOAuthTokenExpiry,
    authAwsRegion, setAuthAwsRegion,
    authAwsService, setAuthAwsService,
    authAwsAccessKeyId, setAuthAwsAccessKeyId,
    authAwsSecretAccessKey, setAuthAwsSecretAccessKey,
    authAwsSessionToken, setAuthAwsSessionToken,
  } = useRequestStore();

  const [showBearer, setShowBearer] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showApiVal, setShowApiVal] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<"idle" | "waiting" | "error">("idle");
  const [oauthError, setOauthError] = useState<string | null>(null);

  // Listen for oauth events from Rust
  useEffect(() => {
    if (authType !== "oauth2") return;
    let unToken: (() => void) | undefined;
    let unError: (() => void) | undefined;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unToken = await listen<{ accessToken: string; expiresIn?: number }>("oauth-token", e => {
        setAuthOAuthToken(e.payload.accessToken, e.payload.expiresIn);
        setOauthStatus("idle");
        setOauthError(null);
      });
      unError = await listen<string>("oauth-error", e => {
        setOauthError(e.payload);
        setOauthStatus("error");
      });
    })();
    return () => { unToken?.(); unError?.(); };
  }, [authType, setAuthOAuthToken]);

  const [showAwsSecret, setShowAwsSecret] = useState(false);

  const AUTH_TYPES: { type: AuthType; label: string }[] = [
    { type: "none", label: "No Auth" },
    { type: "bearer", label: "Bearer Token" },
    { type: "basic", label: "Basic Auth" },
    { type: "apikey", label: "API Key" },
    { type: "oauth2", label: "OAuth 2.0" },
    { type: "awssigv4", label: "AWS Sig V4" },
  ];

  const field = (label: string, node: React.ReactNode) => (
    <div className="flex flex-col gap-1">
      <label className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>{label}</label>
      {node}
    </div>
  );

  const textInput = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="h-8 px-3 rounded text-[12px]"
      style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg)", fontFamily: "Geist Mono, monospace" }} />
  );

  const secretInput = (value: string, onChange: (v: string) => void, placeholder: string, show: boolean, toggle: () => void) => (
    <div className="flex items-center rounded overflow-hidden" style={{ border: "1px solid var(--color-border)", background: "var(--color-card)" }}>
      <input type={show ? "text" : "password"} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="flex-1 px-3 h-8 text-[12px] bg-transparent"
        style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg)" }} />
      <button onClick={toggle} className="px-2 shrink-0 transition-opacity hover:opacity-80" style={{ color: "var(--color-fg-3)" }}>
        {show ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  );

  const hint = (text: React.ReactNode) => (
    <p className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>{text}</p>
  );

  const mono = (s: string) => (
    <span style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg-3)" }}>{s}</span>
  );

  async function handleGetToken() {
    const { oauthAuthCode, oauthClientCredentials } = await import("@/lib/tauri");
    setOauthError(null);
    if (authOAuthGrantType === "client_credentials") {
      setOauthStatus("waiting");
      try {
        const token = await oauthClientCredentials({
          clientId: authOAuthClientId,
          clientSecret: authOAuthClientSecret,
          tokenUrl: authOAuthTokenUrl,
          scopes: authOAuthScopes,
        });
        setAuthOAuthToken(token.accessToken, token.expiresIn);
        setOauthStatus("idle");
      } catch (e) {
        setOauthError(String(e));
        setOauthStatus("error");
      }
    } else {
      setOauthStatus("waiting");
      try {
        await oauthAuthCode({
          clientId: authOAuthClientId,
          clientSecret: authOAuthClientSecret || undefined,
          authUrl: authOAuthAuthUrl,
          tokenUrl: authOAuthTokenUrl,
          scopes: authOAuthScopes,
        });
        // result comes via "oauth-token" event
      } catch (e) {
        setOauthError(String(e));
        setOauthStatus("waiting"); // stay waiting — event listener handles success
      }
    }
  }

  const tokenExpiresLabel = authOAuthTokenExpiry
    ? authOAuthTokenExpiry > Date.now()
      ? `Expires in ${Math.round((authOAuthTokenExpiry - Date.now()) / 60000)}m`
      : "Token expired"
    : null;

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto">
      {/* Type selector */}
      <div className="flex gap-1.5 flex-wrap">
        {AUTH_TYPES.map(({ type, label }) => (
          <button key={type} onClick={() => setAuthType(type)}
            className="px-3 py-1 rounded text-[12px] transition-colors"
            style={{
              background: authType === type ? "var(--color-accent-20)" : "var(--color-card)",
              color: authType === type ? "var(--color-accent)" : "var(--color-fg-3)",
              border: `1px solid ${authType === type ? "var(--color-accent-50)" : "var(--color-border)"}`,
            }}>
            {label}
          </button>
        ))}
      </div>

      {authType === "none" && hint("This request has no authentication. Select a type above to configure credentials.")}

      {authType === "bearer" && (
        <>
          {field("Token", secretInput(authBearer, setAuthBearer, "Enter token...", showBearer, () => setShowBearer(v => !v)))}
          {hint(<>Sends as: {mono("Authorization: Bearer <token>")}</>)}
        </>
      )}

      {authType === "basic" && (
        <>
          {field("Username", textInput(authBasicUser, setAuthBasicUser, "username"))}
          {field("Password", secretInput(authBasicPass, setAuthBasicPass, "password", showPass, () => setShowPass(v => !v)))}
          {hint(<>Sends as: {mono("Authorization: Basic <base64(user:pass)>")}</>)}
        </>
      )}

      {authType === "apikey" && (
        <>
          <div className="flex gap-2 items-end">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>Key name</label>
              {textInput(authApiKeyName, setAuthApiKeyName, "X-API-Key")}
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <label className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>Add to</label>
              <div className="flex rounded overflow-hidden h-8" style={{ border: "1px solid var(--color-border)" }}>
                {(["header", "query"] as ApiKeyTarget[]).map(t => (
                  <button key={t} onClick={() => setAuthApiKeyIn(t)}
                    className="px-3 text-[12px] capitalize transition-colors"
                    style={{
                      background: authApiKeyIn === t ? "var(--color-accent)" : "var(--color-card)",
                      color: authApiKeyIn === t ? "#fff" : "var(--color-fg-3)",
                    }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {field("Value", secretInput(authApiKeyValue, setAuthApiKeyValue, "api-key-value", showApiVal, () => setShowApiVal(v => !v)))}
          {hint(<>Adds {mono(authApiKeyName || "key")} to {authApiKeyIn === "header" ? "request headers" : "query string"}</>)}
        </>
      )}

      {authType === "oauth2" && (
        <>
          {/* Grant type toggle */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>Grant type</label>
            <div className="flex rounded overflow-hidden h-8" style={{ border: "1px solid var(--color-border)", width: "fit-content" }}>
              {([
                { v: "authorization_code", label: "Auth Code + PKCE" },
                { v: "client_credentials", label: "Client Credentials" },
              ] as { v: OAuthGrantType; label: string }[]).map(({ v, label }) => (
                <button key={v} onClick={() => setAuthOAuthGrantType(v)}
                  className="px-3 text-[12px] transition-colors"
                  style={{
                    background: authOAuthGrantType === v ? "var(--color-accent)" : "var(--color-card)",
                    color: authOAuthGrantType === v ? "#fff" : "var(--color-fg-3)",
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {field("Client ID", textInput(authOAuthClientId, setAuthOAuthClientId, "your-client-id"))}
          {field("Client Secret", secretInput(authOAuthClientSecret, setAuthOAuthClientSecret, "your-client-secret", showSecret, () => setShowSecret(v => !v)))}
          {authOAuthGrantType === "authorization_code" && field("Auth URL", textInput(authOAuthAuthUrl, setAuthOAuthAuthUrl, "https://provider.com/oauth/authorize"))}
          {field("Token URL", textInput(authOAuthTokenUrl, setAuthOAuthTokenUrl, "https://provider.com/oauth/token"))}
          {field("Scopes", textInput(authOAuthScopes, setAuthOAuthScopes, "read write"))}

          {/* Token status + Get Token button */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleGetToken}
              disabled={oauthStatus === "waiting" || !authOAuthClientId || !authOAuthTokenUrl}
              className="flex items-center gap-1.5 px-4 rounded-md font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ height: 32, fontSize: 12, background: "var(--color-accent)" }}>
              {oauthStatus === "waiting" ? <span className="animate-spin text-[14px]">⟳</span> : null}
              {oauthStatus === "waiting"
                ? authOAuthGrantType === "authorization_code" ? "Waiting for browser..." : "Getting token..."
                : authOAuthToken ? "Refresh Token" : "Get New Token"}
            </button>
            {authOAuthToken && oauthStatus !== "waiting" && (
              <span className="text-[11px]" style={{ color: tokenExpiresLabel?.includes("expired") ? "#EF4444" : "#22C55E" }}>
                {tokenExpiresLabel ?? "Token acquired"}
              </span>
            )}
          </div>

          {oauthError && (
            <div className="rounded-lg px-3 py-2 text-[11px]" style={{ background: "#EF444415", border: "1px solid #EF444430", color: "#EF4444" }}>
              {oauthError}
            </div>
          )}

          {authOAuthToken && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>Current token</label>
              <div className="flex items-center rounded overflow-hidden" style={{ border: "1px solid var(--color-border)", background: "var(--color-card)" }}>
                <span className="flex-1 px-3 py-1.5 text-[11px] truncate" style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg-3)" }}>
                  {authOAuthToken.slice(0, 40)}…
                </span>
                <button onClick={() => { navigator.clipboard.writeText(authOAuthToken); toast.success("Token copied", { duration: 1500 }); }}
                  className="px-2 shrink-0 text-[11px] transition-opacity hover:opacity-80"
                  style={{ color: "var(--color-fg-3)" }}>
                  Copy
                </button>
              </div>
              {hint(<>Added to requests as: {mono("Authorization: Bearer <token>")}</>)}
            </div>
          )}
        </>
      )}

      {authType === "awssigv4" && (
        <>
          <div className="flex gap-2">
            {field("Region", textInput(authAwsRegion, setAuthAwsRegion, "us-east-1"))}
            {field("Service", textInput(authAwsService, setAuthAwsService, "execute-api"))}
          </div>
          {field("Access Key ID", textInput(authAwsAccessKeyId, setAuthAwsAccessKeyId, "AKIAIOSFODNN7EXAMPLE"))}
          {field("Secret Access Key", secretInput(authAwsSecretAccessKey, setAuthAwsSecretAccessKey, "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", showAwsSecret, () => setShowAwsSecret(v => !v)))}
          {field("Session Token (optional)", textInput(authAwsSessionToken, setAuthAwsSessionToken, ""))}
          {hint("Signing is computed per-request using AWS SigV4. Headers are added automatically.")}
        </>
      )}
    </div>
  );
}

const COMMON_HEADERS = [
  "Accept", "Accept-Encoding", "Accept-Language", "Authorization",
  "Cache-Control", "Content-Type", "Content-Length", "Cookie",
  "Host", "If-Modified-Since", "If-None-Match", "Origin",
  "Pragma", "Referer", "User-Agent", "X-Api-Key", "X-Auth-Token",
  "X-Correlation-Id", "X-Forwarded-For", "X-Request-Id",
];

function KeyValueEditor({ label, autocomplete }: { label: string; autocomplete?: boolean }) {
  const { headers, setHeaders, params, setParams, formFields, setFormFields } = useRequestStore();
  const items = label === "Headers" ? headers : label === "Form" ? formFields : params;
  const setItems = label === "Headers" ? setHeaders : label === "Form" ? setFormFields : setParams;
  const uid = useId();
  const listId = `${uid}-header-list`;

  function addRow() { setItems([...items, { id: `${uid}-${Date.now()}`, key: "", value: "", enabled: true }]); }
  function removeRow(id: string) { setItems(items.filter(i => i.id !== id)); }
  function updateRow(id: string, field: "key" | "value", val: string) { setItems(items.map(i => i.id === id ? { ...i, [field]: val } : i)); }
  function toggleRow(id: string) { setItems(items.map(i => i.id === id ? { ...i, enabled: !i.enabled } : i)); }

  const showAutocomplete = autocomplete && label === "Headers";

  return (
    <div className="flex flex-col gap-1.5 h-full overflow-y-auto">
      {showAutocomplete && (
        <datalist id={listId}>
          {COMMON_HEADERS.map(h => <option key={h} value={h} />)}
        </datalist>
      )}
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-2">
          <input type="checkbox" checked={item.enabled} onChange={() => toggleRow(item.id)} className="accent-accent shrink-0" />
          <input
            value={item.key}
            onChange={e => updateRow(item.id, "key", e.target.value)}
            placeholder="Key"
            list={showAutocomplete ? listId : undefined}
            className="flex-1 h-7 px-2 rounded text-[12px]"
            style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)" }}
          />
          <input value={item.value} onChange={e => updateRow(item.id, "value", e.target.value)} placeholder="Value"
            className="flex-1 h-7 px-2 rounded text-[12px]"
            style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)" }} />
          <button onClick={() => removeRow(item.id)} style={{ color: "var(--color-fg-3)" }} className="hover:text-red transition-colors"><Trash2 size={12} /></button>
        </div>
      ))}
      <button onClick={addRow} className="flex items-center gap-1.5 text-[12px] mt-1 self-start transition-colors" style={{ color: "var(--color-fg-3)" }}>
        <Plus size={12} /> Add {label === "Headers" ? "header" : label === "Form" ? "field" : "parameter"}
      </button>
    </div>
  );
}

async function readFileAsBase64(file: File): Promise<{ base64: string; name: string; type: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve({ base64: result.split(",")[1] ?? "", name: file.name, type: file.type || "application/octet-stream" });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function MultipartEditor() {
  const { multipartItems, setMultipartItems } = useRequestStore();
  const uid = useId();

  function addText() {
    setMultipartItems([...multipartItems, { id: `${uid}-${Date.now()}`, key: "", enabled: true, isFile: false, value: "", fileBase64: "", fileName: "", mimeType: "" }]);
  }
  function addFile() {
    setMultipartItems([...multipartItems, { id: `${uid}-${Date.now()}`, key: "", enabled: true, isFile: true, value: "", fileBase64: "", fileName: "", mimeType: "" }]);
  }
  function remove(id: string) { setMultipartItems(multipartItems.filter(i => i.id !== id)); }
  function update<K extends keyof (typeof multipartItems)[0]>(id: string, key: K, value: (typeof multipartItems)[0][K]) {
    setMultipartItems(multipartItems.map(i => i.id === id ? { ...i, [key]: value } : i));
  }

  async function handleFileChange(id: string, file: File | null) {
    if (!file) return;
    const { base64, name, type } = await readFileAsBase64(file);
    setMultipartItems(multipartItems.map(i => i.id === id ? { ...i, fileBase64: base64, fileName: name, mimeType: type } : i));
  }

  return (
    <div className="flex flex-col gap-1.5 h-full overflow-y-auto">
      {multipartItems.map(item => (
        <div key={item.id} className="flex items-center gap-2">
          <input type="checkbox" checked={item.enabled} onChange={() => update(item.id, "enabled", !item.enabled)} className="accent-accent shrink-0" />
          <input value={item.key} onChange={e => update(item.id, "key", e.target.value)} placeholder="Key"
            className="flex-1 h-7 px-2 rounded text-[12px]"
            style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)", maxWidth: 140 }} />
          <button onClick={() => update(item.id, "isFile", !item.isFile)}
            className="shrink-0 px-2 rounded text-[10px] transition-colors"
            style={{ height: 28, background: item.isFile ? "var(--color-accent-20)" : "var(--color-card)", color: item.isFile ? "var(--color-accent)" : "var(--color-fg-3)", border: `1px solid ${item.isFile ? "var(--color-accent-50)" : "var(--color-border)"}` }}>
            {item.isFile ? "File" : "Text"}
          </button>
          {item.isFile ? (
            <label className="flex-1 flex items-center gap-1.5 h-7 px-2 rounded cursor-pointer truncate text-[12px]"
              style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-3)" }}>
              <FileUp size={11} className="shrink-0" />
              <span className="truncate">{item.fileName || "Choose file…"}</span>
              <input type="file" className="hidden" onChange={e => handleFileChange(item.id, e.target.files?.[0] ?? null)} />
            </label>
          ) : (
            <input value={item.value} onChange={e => update(item.id, "value", e.target.value)} placeholder="Value"
              className="flex-1 h-7 px-2 rounded text-[12px]"
              style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)" }} />
          )}
          <button onClick={() => remove(item.id)} className="hover:text-red transition-colors shrink-0" style={{ color: "var(--color-fg-3)" }}><Trash2 size={12} /></button>
        </div>
      ))}
      <div className="flex items-center gap-2 mt-1">
        <button onClick={addText} className="flex items-center gap-1.5 text-[12px] transition-colors" style={{ color: "var(--color-fg-3)" }}>
          <Plus size={12} /> Add text
        </button>
        <span style={{ color: "var(--color-border)" }}>·</span>
        <button onClick={addFile} className="flex items-center gap-1.5 text-[12px] transition-colors" style={{ color: "var(--color-fg-3)" }}>
          <FileUp size={12} /> Add file
        </button>
      </div>
    </div>
  );
}

function BinaryFilePicker() {
  const { binaryFileName, binaryMimeType, binaryFileBase64, setBinaryFile } = useRequestStore();
  const ref = useRef<HTMLInputElement>(null);

  async function handleChange(file: File | null) {
    if (!file) return;
    const { base64, name, type } = await readFileAsBase64(file);
    setBinaryFile(base64, name, type);
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="file" ref={ref} className="hidden" onChange={e => handleChange(e.target.files?.[0] ?? null)} />
      {binaryFileBase64 ? (
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
          <FileUp size={16} style={{ color: "var(--color-accent)", flexShrink: 0 }} />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium truncate" style={{ color: "var(--color-fg)" }}>{binaryFileName}</p>
            <p className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>{binaryMimeType}</p>
          </div>
          <button onClick={() => setBinaryFile("", "", "")} className="shrink-0 transition-opacity hover:opacity-60" style={{ color: "var(--color-fg-3)" }}><X size={13} /></button>
        </div>
      ) : (
        <button onClick={() => ref.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-lg transition-colors"
          style={{ height: 120, border: "2px dashed var(--color-border)", color: "var(--color-fg-4)" }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--color-accent-50)")}
          onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--color-border)")}>
          <FileUp size={24} />
          <span className="text-[12px]">Click to choose a file</span>
        </button>
      )}
    </div>
  );
}

export function RequestPanel() {
  const { url, setUrl, body, setBody, bodyType, setBodyType, graphqlQuery, setGraphqlQuery, graphqlVariables, setGraphqlVariables, preRequestScript, setPreRequestScript, postResponseScript, setPostResponseScript, extractors, setExtractors, authType, isLoading, setLoading, setResponse, setError, getRequest } = useRequestStore();
  const { resolveVariable } = useEnvironmentStore();
  const { showLineNumbers, claudeApiKey, claudeModel, smartAutocomplete } = useSettingsStore();
  const aiAvailable = useAiAvailable();

  function makeAiEdit(content: string, lang: string) {
    if (!aiAvailable) return undefined;
    return (instruction: string) =>
      editContent(content, instruction, lang, claudeApiKey, claudeModel);
  }
  const [tab, setTab] = useState<Tab>("Body");
  const [showSave, setShowSave] = useState(false);
  const [showSnippet, setShowSnippet] = useState(false);
  const [schemaStatus, setSchemaStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");

  async function handleFetchSchema() {
    const resolvedUrl = resolveVariable(url);
    if (!resolvedUrl) return;
    setSchemaStatus("loading");
    try {
      const req = getRequest();
      const schema = await fetchGraphQLSchema(resolvedUrl, req.headers);
      setCurrentSchema(schema);
      setSchemaStatus("loaded");
      toast.success("GraphQL schema loaded");
    } catch (e) {
      setSchemaStatus("error");
      toast.error(`Schema fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleSend() {
    if (!url) return;
    setLoading(true); setError(null); setResponse(null);
    try {
      const req = getRequest();

      if (preRequestScript.trim()) {
        const { environments, activeId, updateEnvironment } = useEnvironmentStore.getState();
        const activeEnv = environments.find(e => e.id === activeId);
        const envVars = activeEnv?.variables ?? {};
        const mutations = runPreRequestScript(preRequestScript, envVars);
        Object.assign(req.headers, mutations.headers);
        if (activeId && Object.keys(mutations.envVars).length > 0) {
          updateEnvironment(activeId, { variables: { ...envVars, ...mutations.envVars } });
        }
      }

      req.url = resolveVariable(req.url);
      const resolved: typeof req = {
        ...req,
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, resolveVariable(v)])
        ),
        body: req.body ? resolveVariable(req.body) : undefined,
      };

      // Apply AWS SigV4 (async — must run after env resolution)
      const authState = useRequestStore.getState();
      if (authState.authType === "awssigv4" && authState.authAwsAccessKeyId) {
        const { signAwsRequest } = await import("@/lib/awsSigV4");
        const awsHeaders = await signAwsRequest(
          resolved.method,
          resolved.url,
          resolved.headers,
          resolved.body,
          {
            accessKeyId: authState.authAwsAccessKeyId,
            secretAccessKey: authState.authAwsSecretAccessKey,
            sessionToken: authState.authAwsSessionToken || undefined,
            region: authState.authAwsRegion,
            service: authState.authAwsService,
          },
        );
        Object.assign(resolved.headers, awsHeaders);
      }
      trackEvent("request_send", { method: resolved.method, url: resolved.url });

      const resp = await sendRequest({ ...resolved, ...networkOptions() });
      setResponse(resp);
      trackPerf(resolved.url, resolved.method, resp.durationMs, resp.status);

      if (postResponseScript.trim()) {
        const { environments, activeId, updateEnvironment } = useEnvironmentStore.getState();
        const activeEnv = environments.find(e => e.id === activeId);
        const envVars = activeEnv?.variables ?? {};
        const postMutations = runPostResponseScript(postResponseScript, {
          status: resp.status,
          body: resp.body,
          headers: resp.headers,
          durationMs: resp.durationMs,
        }, envVars);
        if (activeId && Object.keys(postMutations.envVars).length > 0) {
          updateEnvironment(activeId, { variables: { ...envVars, ...postMutations.envVars } });
        }
        useTestResultsStore.getState().setResults(postMutations.testResults);
      }

      const activeExtractors = useRequestStore.getState().extractors.filter(e => e.enabled && e.path && e.variable);
      if (activeExtractors.length > 0) {
        let parsed: unknown = null;
        try { parsed = JSON.parse(resp.body); } catch { /* non-JSON response */ }
        if (parsed !== null) {
          const { environments, activeId, updateEnvironment } = useEnvironmentStore.getState();
          const activeEnv = environments.find(e => e.id === activeId);
          const extracted: Record<string, string> = {};
          for (const ex of activeExtractors) {
            const val = evaluatePath(ex.path, parsed);
            if (val !== null) extracted[ex.variable] = val;
          }
          if (activeId && Object.keys(extracted).length > 0) {
            updateEnvironment(activeId, { variables: { ...(activeEnv?.variables ?? {}), ...extracted } });
            const count = Object.keys(extracted).length;
            toast.success(`${count} variable${count > 1 ? "s" : ""} extracted`, { duration: 2000 });
          }
        }
      }

      const { environments: envs, activeId: envActiveId } = useEnvironmentStore.getState();
      const envName = envs.find(e => e.id === envActiveId)?.name ?? "";
      const timestamp = new Date().toISOString();
      await saveHistory(resolved.method, resolved.url, resp.status, resp.durationMs, envName);
      const userId = useUserStore.getState().user?.id;
      if (userId) {
        pushHistory(userId, {
          method: resolved.method, url: resolved.url,
          status: resp.status, durationMs: resp.durationMs,
          environment: envName, timestamp,
        });
      }
    } catch (e) {
      const msg = String(e);
      setError(msg);
      trackCrash(msg);
      toast.error("Request failed — " + (msg.includes("timed out") ? "timed out" : msg.includes("dns") || msg.includes("connect") ? "could not connect" : "network error"), { duration: 4000 });
    } finally {
      setLoading(false);
    }
  }

  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        handleSendRef.current();
      } else if (e.key === "s") {
        e.preventDefault();
        if (useRequestStore.getState().url) setShowSave(v => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const TABS: Tab[] = ["Params", "Headers", "Auth", "Body", "Pre-req", "Post-req", "Extract"];

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden" style={{ background: "var(--color-bg)", borderRight: "1px solid var(--color-border)" }}>
      {/* URL Bar */}
      <div data-tour="request-builder" className="flex items-center gap-2 shrink-0 px-4" style={{ height: 52, borderBottom: "1px solid var(--color-border)" }}>
        <MethodSelector />
        <div className="flex-1 flex items-center px-3 rounded-md" style={{ height: 32, background: "var(--color-input)", border: "1px solid var(--color-border)" }}>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSend()}
            placeholder="https://api.myapp.com/endpoint"
            className="flex-1 text-[12px] bg-transparent"
            style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg)" }}
          />
        </div>
        <button
          onClick={handleSend}
          disabled={isLoading || !url}
          title="Send request (Ctrl+Enter)"
          className="flex items-center gap-1.5 px-4 rounded-md font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 shrink-0"
          style={{ height: 32, fontSize: 13, background: "var(--color-accent)" }}>
          {isLoading ? <span className="animate-spin text-[14px]">⟳</span> : <Send size={13} />}
          Send
        </button>
        <div className="relative shrink-0">
          <button
            onClick={() => setShowSave(v => !v)}
            disabled={!url}
            title="Save to collection (Ctrl+S)"
            className="flex items-center justify-center rounded-md transition-colors disabled:opacity-40"
            style={{ width: 32, height: 32, border: "1px solid var(--color-border)", color: "var(--color-fg-3)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--color-card)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            <Bookmark size={14} />
          </button>
          {showSave && <SavePopover onClose={() => setShowSave(false)} />}
        </div>
        <button
          onClick={() => setShowSnippet(true)}
          disabled={!url}
          title="Code snippet"
          className="flex items-center justify-center rounded-md transition-colors disabled:opacity-40 shrink-0"
          style={{ width: 32, height: 32, border: "1px solid var(--color-border)", color: "var(--color-fg-3)" }}
          onMouseEnter={e => (e.currentTarget.style.background = "var(--color-card)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
          <Code2 size={14} />
        </button>
      </div>
      {showSnippet && <SnippetModal req={getRequest()} onClose={() => setShowSnippet(false)} />}

      {/* Tab bar */}
      <div className="flex flex-col shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="flex items-center px-4" style={{ height: 38 }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="relative px-3 h-full text-[12px] transition-colors flex items-center gap-1"
              style={{ color: tab === t ? "var(--color-fg)" : "var(--color-fg-3)" }}>
              {t}
              {t === "Pre-req" && preRequestScript.trim() && (
                <span className="w-1 h-1 rounded-full shrink-0" style={{ background: "var(--color-accent)" }} />
              )}
              {t === "Auth" && authType !== "none" && (
                <span className="w-1 h-1 rounded-full shrink-0" style={{ background: "var(--color-accent)" }} />
              )}
              {t === "Extract" && extractors.some(e => e.enabled && e.path && e.variable) && (
                <span className="w-1 h-1 rounded-full shrink-0" style={{ background: "var(--color-accent)" }} />
              )}
              {tab === t && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: "var(--color-accent)" }} />}
            </button>
          ))}
        </div>
        {bodyType !== "none" && tab === "Body" && (
          <div className="flex items-center gap-1 px-4" style={{ height: 32, borderTop: "1px solid var(--color-border)" }}>
            {(["json", "form", "multipart", "binary", "raw", "graphql"] as const).map(bt => (
              <button key={bt} onClick={() => setBodyType(bt)}
                className="px-2.5 rounded text-[11px] transition-colors"
                style={{
                  height: 22,
                  background: bodyType === bt ? "var(--color-card)" : "transparent",
                  color: bodyType === bt ? "var(--color-accent)" : "var(--color-fg-3)",
                  border: bodyType === bt ? "1px solid var(--color-border)" : "1px solid transparent",
                }}>
                {bt}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden p-4">
        {tab === "Body" && (
          <div className="flex flex-col h-full gap-2">
            {bodyType === "none" ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px]" style={{ color: "var(--color-fg-3)" }}>Body type:</span>
                {(["none", "json", "form", "multipart", "binary", "raw", "graphql"] as const).map(bt => (
                  <button key={bt} onClick={() => setBodyType(bt)}
                    className="px-3 py-1 rounded text-[12px] transition-colors"
                    style={{
                      background: bodyType === bt ? "var(--color-accent-20)" : "var(--color-card)",
                      color: bodyType === bt ? "var(--color-accent)" : "var(--color-fg-3)",
                      border: `1px solid ${bodyType === bt ? "var(--color-accent-50)" : "var(--color-border)"}`,
                    }}>
                    {bt}
                  </button>
                ))}
              </div>
            ) : bodyType === "form" ? (
              <KeyValueEditor label="Form" />
            ) : bodyType === "multipart" ? (
              <MultipartEditor />
            ) : bodyType === "binary" ? (
              <BinaryFilePicker />
            ) : bodyType === "graphql" ? (
              <div className="flex flex-col h-full gap-2">
                <div className="flex flex-col gap-1 flex-2 min-h-0">
                  <div className="flex items-center justify-between shrink-0">
                    <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>Query</span>
                    <button
                      onClick={handleFetchSchema}
                      disabled={schemaStatus === "loading" || !url}
                      className="flex items-center gap-1 px-2 rounded text-[11px] transition-colors"
                      style={{
                        height: 20,
                        background: schemaStatus === "loaded" ? "#16a34a18" : "transparent",
                        border: `1px solid ${schemaStatus === "loaded" ? "#16a34a50" : schemaStatus === "error" ? "#dc262650" : "var(--color-border)"}`,
                        color: schemaStatus === "loaded" ? "#4ade80" : schemaStatus === "error" ? "#f87171" : schemaStatus === "loading" ? "var(--color-fg-3)" : "var(--color-fg-2)",
                        cursor: schemaStatus === "loading" || !url ? "not-allowed" : "pointer",
                        opacity: !url ? 0.4 : 1,
                      }}
                    >
                      {schemaStatus === "loading" ? "Fetching…" : schemaStatus === "loaded" ? "✓ Schema" : schemaStatus === "error" ? "↺ Retry" : "Fetch Schema"}
                    </button>
                  </div>
                  <CodeEditor
                    value={graphqlQuery}
                    onChange={setGraphqlQuery}
                    lang="graphql"
                    placeholder="Write your GraphQL query here..."
                    showLineNumbers={showLineNumbers}
                    onAiEdit={makeAiEdit(graphqlQuery, "graphql")}
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1 min-h-0">
                  <span className="text-[11px] shrink-0">
                    <span style={{ color: "#71717A" }}>Variables</span>
                    <span style={{ color: "#4A4A52" }}> (JSON)</span>
                  </span>
                  <CodeEditor
                    value={graphqlVariables}
                    onChange={setGraphqlVariables}
                    lang="json"
                    placeholder='{ "variable": "value" }'
                    showLineNumbers={showLineNumbers}
                    onAiEdit={makeAiEdit(graphqlVariables, "json")}
                  />
                </div>
              </div>
            ) : (
              <CodeEditor
                value={body}
                onChange={setBody}
                lang={bodyType === "json" ? "json" : "javascript"}
                placeholder={bodyType === "json" ? '{ "key": "value" }' : ""}
                showLineNumbers={showLineNumbers}
                onAiEdit={makeAiEdit(body, bodyType === "json" ? "json" : "javascript")}
              />
            )}
          </div>
        )}
        {(tab === "Headers" || tab === "Params") && <KeyValueEditor label={tab} autocomplete={smartAutocomplete} />}
        {tab === "Auth" && <AuthTab />}
        {tab === "Pre-req" && (
          <div className="flex flex-col h-full gap-2">
            <p className="text-[11px] shrink-0" style={{ color: "var(--color-fg-3)" }}>
              Runs before each request. Use{" "}
              <span style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>pm</span>{" "}
              to read/write environment variables and override headers.
            </p>
            <CodeEditor
              value={preRequestScript}
              onChange={setPreRequestScript}
              lang="javascript"
              placeholder={"// pm.environment.set(\"token\", \"abc\");\n// pm.request.headers.upsert(\"Authorization\", \"Bearer \" + pm.environment.get(\"token\"));"}
              showLineNumbers={showLineNumbers}
              onAiEdit={makeAiEdit(preRequestScript, "javascript")}
            />
            <div className="shrink-0 flex flex-col gap-0.5" style={{ fontSize: 11, color: "var(--color-fg-4)" }}>
              <span><span style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>pm.environment.get(key)</span> — read variable</span>
              <span><span style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>pm.environment.set(key, value)</span> — write variable</span>
              <span><span style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>pm.request.headers.upsert(key, value)</span> — add / override header</span>
            </div>
          </div>
        )}
        {tab === "Post-req" && (
          <div className="flex flex-col h-full gap-2">
            <p className="text-[11px] shrink-0" style={{ color: "var(--color-fg-3)" }}>
              Runs after the response is received. Use{" "}
              <span style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>pm.response</span>{" "}
              to read status, body and headers, and{" "}
              <span style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>pm.environment.set</span>{" "}
              to store values.
            </p>
            <CodeEditor
              value={postResponseScript}
              onChange={setPostResponseScript}
              lang="javascript"
              placeholder={"// const data = pm.response.json();\n// pm.environment.set(\"userId\", data.id);"}
              showLineNumbers={showLineNumbers}
              onAiEdit={makeAiEdit(postResponseScript, "javascript")}
            />
            <div className="shrink-0 flex flex-col gap-0.5" style={{ fontSize: 11, color: "var(--color-fg-4)" }}>
              <span><span style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>pm.response.status</span> — HTTP status code</span>
              <span><span style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>pm.response.json()</span> — parsed JSON body</span>
              <span><span style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>pm.response.text()</span> — raw body string</span>
              <span><span style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>pm.response.responseTime</span> — duration in ms</span>
            </div>
          </div>
        )}
        {tab === "Extract" && (
          <div className="flex flex-col h-full gap-3">
            <p className="text-[11px] shrink-0" style={{ color: "var(--color-fg-3)" }}>
              Extract values from the JSON response into environment variables automatically after each request.
            </p>
            <div className="flex flex-col gap-1 flex-1 overflow-auto">
              {extractors.length === 0 && (
                <p className="text-[11px] py-4 text-center" style={{ color: "var(--color-fg-4)" }}>
                  No extractors — click + to add one
                </p>
              )}
              {extractors.map((ex: Extractor) => (
                <div key={ex.id} className="flex items-center gap-2">
                  <button
                    onClick={() => setExtractors(extractors.map(e => e.id === ex.id ? { ...e, enabled: !e.enabled } : e))}
                    className="shrink-0 w-3.5 h-3.5 rounded-sm border transition-colors"
                    style={{
                      background: ex.enabled ? "var(--color-accent)" : "transparent",
                      borderColor: ex.enabled ? "var(--color-accent)" : "var(--color-border)",
                    }}
                  />
                  <input
                    value={ex.path}
                    onChange={e => setExtractors(extractors.map(x => x.id === ex.id ? { ...x, path: e.target.value } : x))}
                    placeholder="$.data.token"
                    className="flex-1 px-2 rounded text-[11px] bg-transparent"
                    style={{ height: 28, border: "1px solid var(--color-border)", fontFamily: "Geist Mono, monospace", color: "var(--color-fg)" }}
                  />
                  <span className="text-[11px] shrink-0" style={{ color: "var(--color-fg-4)" }}>→</span>
                  <input
                    value={ex.variable}
                    onChange={e => setExtractors(extractors.map(x => x.id === ex.id ? { ...x, variable: e.target.value } : x))}
                    placeholder="token"
                    className="flex-1 px-2 rounded text-[11px] bg-transparent"
                    style={{ height: 28, border: "1px solid var(--color-border)", fontFamily: "Geist Mono, monospace", color: "var(--color-fg)" }}
                  />
                  <button
                    onClick={() => setExtractors(extractors.filter(e => e.id !== ex.id))}
                    className="shrink-0 flex items-center justify-center rounded transition-colors"
                    style={{ width: 24, height: 24, color: "var(--color-fg-4)" }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                    onMouseLeave={e => (e.currentTarget.style.color = "var(--color-fg-4)")}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setExtractors([...extractors, { id: Math.random().toString(36).slice(2), path: "", variable: "", enabled: true }])}
              className="flex items-center gap-1.5 shrink-0 text-[11px] transition-colors self-start"
              style={{ color: "var(--color-fg-3)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--color-fg)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--color-fg-3)")}>
              <Plus size={12} /> Add extractor
            </button>
            <div className="shrink-0 flex flex-col gap-0.5" style={{ fontSize: 11, color: "var(--color-fg-4)" }}>
              <span><span style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>$.token</span> — root field</span>
              <span><span style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>$.data.user.id</span> — nested field</span>
              <span><span style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>$.items[0].name</span> — array index</span>
              <span><span style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>$.ids[*]</span> — all array values (joined)</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
