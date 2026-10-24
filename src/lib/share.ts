import { supabase } from "@/lib/supabase";
import type { Collection, CollectionAuth, CollectionFolder, CollectionRequest } from "@/lib/tauri";

/**
 * Colecciones compartidas por link.
 *
 * Un link es una copia de la coleccion en el momento de compartirla. Quien lo
 * abre importa la suya, y lo que cambie despues no viaja en ninguna direccion.
 * El esquema esta en `supabase/migrations/20261024000000_shared_collections.sql`.
 *
 * Lo delicado es que el link sale del equipo: cualquiera que lo tenga lo lee
 * sin cuenta. Por eso `sanitizeForShare` corre siempre antes de subir, y deja
 * en `{{VAR}}` todo valor de credencial que estuviera escrito literal.
 */

/** Donde vive la pagina que muestra un link a quien no tiene Flux todavia. */
export const SHARE_PAGE_URL = "https://fluxapi.dev/share.html";
/** Esquema registrado por la app; ver `deep-link` en tauri.conf.json. */
export const SHARE_DEEP_LINK = "flux://share/";

const SHARE_FORMAT = "flux-share";
const SHARE_VERSION = 1;

export interface SharePayload {
  format: typeof SHARE_FORMAT;
  version: number;
  collection: Collection;
}

export interface Redaction {
  /** Donde estaba: "Login › auth", "collection › header Authorization". */
  where: string;
  /** La variable que ocupa su lugar, sin llaves. */
  variable: string;
}

export interface SanitizeResult {
  collection: Collection;
  redactions: Redaction[];
}

const isReference = (v: string) => /^\s*\{\{[^{}]+\}\}\s*$/.test(v);
/** Contiene alguna `{{VAR}}`: ya esta parametrizado, aunque sea en parte. */
const hasReference = (v: string) => /\{\{[^{}]+\}\}/.test(v);

/** Campos de auth que son credencial, con el sufijo de la variable que los sustituye. */
const SECRET_AUTH_FIELDS: [keyof CollectionAuth, string][] = [
  ["token", "TOKEN"],
  ["password", "PASSWORD"],
  ["value", "API_KEY"],
  ["clientSecret", "CLIENT_SECRET"],
  ["accessKeyId", "AWS_ACCESS_KEY_ID"],
  ["secretAccessKey", "AWS_SECRET_ACCESS_KEY"],
  ["sessionToken", "AWS_SESSION_TOKEN"],
];

/**
 * Nombres de header o de parametro que casi siempre llevan una credencial. Por
 * nombre y no por valor: un token y un id de usuario no se distinguen mirando
 * los caracteres.
 */
const SENSITIVE_NAME =
  /^(authorization|proxy-authorization|cookie|set-cookie)$|api[-_]?key|token|secret|password|passwd|session|signature|^sig$|^key$|^auth$/i;

/** `Bearer abc` conserva el esquema: lo que se oculta es solo la credencial. */
const AUTH_SCHEME = /^(Bearer|Basic|Token|Digest|ApiKey)\s+(.+)$/i;

function varBase(scope: string): string {
  return scope
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

function varName(scope: string, suffix: string): string {
  const base = varBase(scope);
  return base ? `${base}_${suffix}` : suffix;
}

function suffixFor(name: string): string {
  const s = varBase(name);
  return s || "SECRET";
}

class Sanitizer {
  redactions: Redaction[] = [];

  private note(where: string, variable: string): string {
    this.redactions.push({ where, variable });
    return `{{${variable}}}`;
  }

  auth(auth: CollectionAuth | undefined, scope: string, label: string): CollectionAuth | undefined {
    if (!auth) return auth;
    const out: CollectionAuth = { ...auth };
    for (const [field, suffix] of SECRET_AUTH_FIELDS) {
      const v = out[field];
      if (typeof v === "string" && v.trim() && !isReference(v)) {
        out[field] = this.note(`${label} › auth ${field}`, varName(scope, suffix));
      }
    }
    return out;
  }

  headers(h: Record<string, string> | undefined, scope: string, label: string): Record<string, string> | undefined {
    if (!h) return h;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(h)) {
      if (!SENSITIVE_NAME.test(k) || !v.trim() || hasReference(v)) {
        out[k] = v;
        continue;
      }
      const variable = varName(scope, suffixFor(k));
      const m = v.match(AUTH_SCHEME);
      out[k] = m
        ? `${m[1]} ${this.note(`${label} › header ${k}`, variable)}`
        : this.note(`${label} › header ${k}`, variable);
    }
    return out;
  }

  params(p: Record<string, string> | undefined, scope: string, label: string): Record<string, string> | undefined {
    if (!p) return p;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(p)) {
      out[k] = SENSITIVE_NAME.test(k) && v.trim() && !hasReference(v)
        ? this.note(`${label} › param ${k}`, varName(scope, suffixFor(k)))
        : v;
    }
    return out;
  }

  /** La query que va escrita dentro del path: `/users?api_key=abc`. */
  path(path: string, scope: string, label: string): string {
    const q = path.indexOf("?");
    if (q < 0) return path;
    const head = path.slice(0, q + 1);
    const rest = path.slice(q + 1);
    const hash = rest.indexOf("#");
    const query = hash < 0 ? rest : rest.slice(0, hash);
    const tail = hash < 0 ? "" : rest.slice(hash);
    const parts = query.split("&").map(pair => {
      const eq = pair.indexOf("=");
      if (eq < 0) return pair;
      const k = pair.slice(0, eq);
      const v = pair.slice(eq + 1);
      if (!SENSITIVE_NAME.test(decodeSafe(k)) || !v || hasReference(v)) return pair;
      return `${k}=${this.note(`${label} › query ${decodeSafe(k)}`, varName(scope, suffixFor(decodeSafe(k))))}`;
    });
    return head + parts.join("&") + tail;
  }

  request(r: CollectionRequest): CollectionRequest {
    const label = r.name || "request";
    return {
      ...r,
      path: this.path(r.path, r.name, label),
      headers: this.headers(r.headers, r.name, label) ?? {},
      params: this.params(r.params, r.name, label),
      auth: this.auth(r.auth, r.name, label),
      grpc: r.grpc
        ? { ...r.grpc, metadata: this.headers(r.grpc.metadata, r.name, `${label} (gRPC)`) ?? {} }
        : r.grpc,
    };
  }

  folder(f: CollectionFolder): CollectionFolder {
    const label = `folder ${f.name}`;
    return {
      ...f,
      expanded: true,
      auth: this.auth(f.auth, f.name, label),
      headers: this.headers(f.headers, f.name, label),
      requests: f.requests.map(r => this.request(r)),
      folders: (f.folders ?? []).map(sub => this.folder(sub)),
    };
  }
}

function decodeSafe(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * La coleccion tal como puede salir del equipo.
 *
 * Cambia por `{{VAR}}` las credenciales literales en auth, headers sensibles,
 * parametros y la query del path, a todos los niveles. Quita lo que solo tiene
 * sentido en esta maquina (`rootDir`, `group`).
 *
 * No toca bodies ni scripts: ahi un secreto no se puede reconocer sin romper lo
 * que no lo es, y la pantalla de compartir lo avisa.
 */
export function sanitizeForShare(col: Collection): SanitizeResult {
  const s = new Sanitizer();
  const label = "collection";
  const collection: Collection = {
    id: col.id,
    name: col.name,
    description: col.description,
    baseUrl: col.baseUrl,
    auth: s.auth(col.auth, col.name, label),
    headers: s.headers(col.headers, col.name, label),
    scripts: col.scripts,
    requests: col.requests.map(r => s.request(r)),
    folders: col.folders.map(f => s.folder(f)),
    expanded: true,
  };
  // `undefined` no sobrevive a JSON, pero dejarlo fuera aqui hace que lo que se
  // compara en los tests sea lo mismo que se sube.
  return { collection: JSON.parse(JSON.stringify(collection)), redactions: s.redactions };
}

/** Las scripts y los bodies van tal cual: se avisa si hay alguno. */
export function hasUnscannedContent(col: Collection): boolean {
  const reqHas = (r: CollectionRequest) =>
    !!(r.body?.trim() || r.scripts?.preRequest?.trim() || r.scripts?.postResponse?.trim());
  const folderHas = (f: CollectionFolder): boolean =>
    !!(f.scripts?.preRequest?.trim() || f.scripts?.postResponse?.trim()) ||
    f.requests.some(reqHas) || (f.folders ?? []).some(folderHas);
  return !!(col.scripts?.preRequest?.trim() || col.scripts?.postResponse?.trim()) ||
    col.requests.some(reqHas) || col.folders.some(folderHas);
}

// ─────────────────────────────────────
// Links
// ─────────────────────────────────────

const ID_RE = /^[0-9a-f]{32}$/;

export function shareUrl(id: string): string {
  // En el fragmento y no en la query: el fragmento no llega al servidor de la
  // pagina ni a los logs de ningun proxy por el camino.
  return `${SHARE_PAGE_URL}#${id}`;
}

/**
 * Saca el id de lo que pegue el usuario: el link web, el `flux://share/…`, o el
 * id solo. Devuelve null si no hay ninguno reconocible.
 */
export function parseShareId(input: string): string | null {
  const text = input.trim();
  if (ID_RE.test(text)) return text;
  const m = text.match(/(?:share\.html#|share\/|[#?&]s=)([0-9a-f]{32})(?![0-9a-f])/i);
  return m ? m[1].toLowerCase() : null;
}

export interface CreatedShare {
  id: string;
  url: string;
  expiresAt: string | null;
}

export async function createShare(col: Collection, expiresInDays: number | null): Promise<CreatedShare> {
  const { collection } = sanitizeForShare(col);
  const payload: SharePayload = { format: SHARE_FORMAT, version: SHARE_VERSION, collection };
  const { data, error } = await supabase.rpc("flux_share_collection", {
    p_name: col.name,
    p_data: payload,
    p_expires_in_days: expiresInDays,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) throw new Error("The server did not return a link");
  return { id: row.id, url: shareUrl(row.id), expiresAt: row.expires_at ?? null };
}

export interface SharedCollection {
  name: string;
  collection: Collection;
  createdAt: string;
  expiresAt: string | null;
}

/** Null si el link no existe, se revoco o caduco: el servidor no dice cual. */
export async function fetchShare(id: string): Promise<SharedCollection | null> {
  const { data, error } = await supabase.rpc("flux_get_shared_collection", { p_id: id });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const payload = row.data as Partial<SharePayload> | null;
  if (payload?.format !== SHARE_FORMAT || !payload.collection) {
    throw new Error("This link was made by a newer version of Flux. Update Flux to open it.");
  }
  if ((payload.version ?? 0) > SHARE_VERSION) {
    throw new Error("This link was made by a newer version of Flux. Update Flux to open it.");
  }
  return {
    name: row.name,
    collection: payload.collection,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? null,
  };
}

export interface MyShare {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  openCount: number;
}

/** Los links vigentes del usuario, los mas nuevos primero. */
export async function listMyShares(): Promise<MyShare[]> {
  const { data, error } = await supabase
    .from("flux_shared_collections")
    .select("id, name, created_at, expires_at, revoked_at, open_count")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const now = Date.now();
  return (data ?? [])
    .filter(r => !r.expires_at || new Date(r.expires_at).getTime() > now)
    .map(r => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      openCount: Number(r.open_count ?? 0),
    }));
}

export async function revokeShare(id: string): Promise<void> {
  const { error } = await supabase.rpc("flux_revoke_shared_collection", { p_id: id });
  if (error) throw new Error(error.message);
}

// ─────────────────────────────────────
// Importar
// ─────────────────────────────────────

function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "shared";
}

/**
 * La coleccion recibida, lista para guardarse junto a las que ya hay.
 *
 * El id es el nombre del fichero, asi que sale del nombre y se desambigua
 * contra los existentes. Los ids de requests y carpetas se rehacen colgando del
 * nuevo: abrir el mismo link dos veces no puede dejar dos requests con el mismo
 * id, porque la barra lateral selecciona por id.
 */
export function toImportable(shared: Collection, existingIds: Iterable<string>): Collection {
  const taken = new Set(existingIds);
  const base = slug(shared.name);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;

  let r = 0;
  let f = 0;
  const req = (x: CollectionRequest): CollectionRequest => ({ ...x, id: `${id}-r${++r}` });
  const folder = (x: CollectionFolder): CollectionFolder => ({
    ...x,
    id: `${id}-f${++f}`,
    expanded: true,
    requests: x.requests.map(req),
    folders: (x.folders ?? []).map(folder),
  });

  return {
    ...shared,
    id,
    expanded: true,
    group: undefined,
    rootDir: undefined,
    requests: shared.requests.map(req),
    folders: shared.folders.map(folder),
  };
}
