import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { checkSchemaVersion } from "@/lib/schemaVersion";
import { getKnownVersion, setKnownVersion } from "@/lib/syncVersions";
import { useSettingsStore } from "@/stores/settings";
import { useCollectionsStore, type Collection } from "@/stores/collections";
import { useEnvironmentStore, type Environment } from "@/stores/environment";

// Keys that should never leave the device
const DEVICE_ONLY_KEYS = ["claudeApiKey", "clientCertPem", "clientKeyPem"];

// Stop all sync attempts if we detect a definitively invalid session
let _sessionInvalid = false;

function markSessionInvalid() {
  if (_sessionInvalid) return;
  _sessionInvalid = true;
  stopSettingsSync();
  stopEnvironmentsSync();
  // Trigger sign-out so onAuthStateChange redirects to login
  supabase.auth.signOut({ scope: "local" }).catch(() => {});
}

function isSupabase401(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 401;
}

//                                          
// HISTORY
//                                          

export function pushHistory(userId: string, entry: {
  method: string;
  url: string;
  status: number;
  durationMs: number;
  environment: string;
  timestamp: string;
}) {
  supabase.from("flux_history").insert({
    user_id: userId,
    method: entry.method,
    url: entry.url,
    status: entry.status,
    duration_ms: entry.durationMs,
    environment: entry.environment,
    created_at: entry.timestamp,
  }).then(() => {}, () => {});
}

async function pullHistory(userId: string) {
  const { data } = await supabase
    .from("flux_history")
    .select("method, url, status, duration_ms, environment, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (!data || data.length === 0) return;

  const { getHistory, restoreHistory } = await import("@/lib/tauri");
  const local = await getHistory();
  const localKeys = new Set(
    local.map(e => `${e.method}|${e.url}|${e.timestamp.slice(0, 16)}`)
  );

  const toRestore = data.filter(
    e => !localKeys.has(`${e.method}|${e.url}|${(e.created_at as string).slice(0, 16)}`)
  );

  if (toRestore.length > 0) {
    await restoreHistory(toRestore.map(e => ({
      method: e.method as string,
      url: e.url as string,
      status: e.status as number,
      durationMs: e.duration_ms as number,
      environment: (e.environment as string) ?? "",
      timestamp: e.created_at as string,
    })));
  }
}

//                                          
// COLLECTIONS
//                                          

/**
 * Borra el historial remoto. Sin esto, `clearHistory` solo vaciaba SQLite y la
 * siguiente sincronizacion lo repescaba entero desde Supabase: el usuario creia
 * haberlo borrado y reaparecia al reabrir la app.
 */
export async function clearRemoteHistory(userId: string): Promise<void> {
  const { error } = await supabase.from("flux_history").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/** Aplica la retencion tambien en Supabase, por el mismo motivo. */
export async function pruneRemoteHistory(userId: string, days: number): Promise<void> {
  if (days <= 0) return;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { error } = await supabase
    .from("flux_history")
    .delete()
    .eq("user_id", userId)
    .lt("created_at", cutoff);
  if (error) throw new Error(error.message);
}

interface PutCollectionRow {
  version: number;
  conflict: boolean;
  remote: Collection | null;
}

export type PushResult =
  | { status: "saved" }
  /** Alguien escribio despues de la version sobre la que se edito. */
  | { status: "conflict"; remote: Collection }
  | { status: "failed" };

/**
 * Guarda la coleccion en la nube declarando sobre que version se edito.
 *
 * Antes era un `upsert` fire-and-forget: el ultimo en escribir ganaba, sin
 * aviso ni forma de recuperar lo pisado. Ahora el servidor rechaza el guardado
 * si la version base ya no es la suya.
 *
 * En conflicto **no** se actualiza la version conocida a proposito. Si se
 * actualizara, el siguiente guardado pasaria el control y pisaria el cambio
 * ajeno en silencio, que es exactamente el fallo que esto viene a cerrar.
 *
 * El fichero local ya esta escrito antes de llamar aqui, asi que un conflicto
 * nunca le cuesta al usuario lo que acaba de teclear.
 */
export async function pushCollection(collection: Collection): Promise<PushResult> {
  if (_sessionInvalid) return { status: "failed" };

  try {
    const { data, error } = await supabase.rpc("flux_put_collection", {
      p_id: collection.id,
      p_data: collection,
      p_base: getKnownVersion(collection.id),
    });

    if (error) {
      if (isSupabase401(error)) { markSessionInvalid(); return { status: "failed" }; }
      toast.warning("Sync failed — working offline", { id: "sync-fail", duration: 4000 });
      return { status: "failed" };
    }

    const row = (data as PutCollectionRow[] | null)?.[0];
    if (!row) return { status: "failed" };

    if (row.conflict) {
      toast.warning(
        `"${collection.name}" changed somewhere else. Your edit is saved on this machine but not in the cloud.`,
        { id: `conflict-${collection.id}`, duration: 8000 },
      );
      return { status: "conflict", remote: row.remote as Collection };
    }

    setKnownVersion(collection.id, row.version);
    return { status: "saved" };
  } catch {
    toast.warning("Sync failed — working offline", { id: "sync-fail", duration: 4000 });
    return { status: "failed" };
  }
}

async function pullCollections(userId: string) {
  const { data } = await supabase
    .from("flux_collections")
    .select("data, version")
    .eq("user_id", userId);

  if (!data) return;
  for (const row of data) {
    const collection = row.data as Collection;
    useCollectionsStore.getState().loadCollection(collection);

    // Primer arranque tras la actualizacion: una coleccion que ya existe en
    // las dos partes no tiene base registrada, y sin base cada guardado
    // saldria como conflicto. Se siembra una sola vez con la version remota.
    //
    // La hipotesis es que local y remoto coinciden, que es lo que dejaba el
    // comportamiento anterior de ultimo-en-escribir-gana. Si no coinciden, el
    // resultado es el que ya se obtenia antes, no una regresion.
    if (getKnownVersion(collection.id) === null) {
      setKnownVersion(collection.id, row.version as number);
    }
  }
}

//                                          
// SETTINGS
//                                          

let settingsTimer: ReturnType<typeof setTimeout> | null = null;
let _syncingUserId: string | null = null;

export function pushSettingsDebounced(userId: string) {
  if (settingsTimer) clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => pushSettings(userId), 1500);
}

async function pushSettings(userId: string) {
  if (_sessionInvalid) return;
  try {
    const raw = localStorage.getItem("flux-settings");
    if (!raw) return;
    const { state } = JSON.parse(raw) as { state: Record<string, unknown> };
    const syncable: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(state)) {
      if (!DEVICE_ONLY_KEYS.includes(k) && typeof v !== "function") {
        syncable[k] = v;
      }
    }
    const { error } = await supabase.from("flux_settings").upsert({
      user_id: userId,
      data: syncable,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      if (isSupabase401(error)) { markSessionInvalid(); return; }
      toast.warning("Sync failed — working offline", { id: "sync-fail", duration: 4000 });
    }
  } catch {
    toast.warning("Sync failed — working offline", { id: "sync-fail", duration: 4000 });
  }
}

async function pullSettings(userId: string) {
  const { data } = await supabase
    .from("flux_settings")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data?.data) return;

  const cloud = data.data as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cloud)) {
    if (!DEVICE_ONLY_KEYS.includes(k)) patch[k] = v;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useSettingsStore.getState().patch(patch as any);
}

//
// ENVIRONMENTS
//

let environmentsTimer: ReturnType<typeof setTimeout> | null = null;

export function pushEnvironmentsDebounced(userId: string) {
  if (environmentsTimer) clearTimeout(environmentsTimer);
  environmentsTimer = setTimeout(() => pushEnvironments(userId), 1500);
}

async function pushEnvironments(userId: string) {
  if (_sessionInvalid) return;
  try {
    const { environments, globalVariables, globalSecretKeys } = useEnvironmentStore.getState();
    const syncable = environments.filter((e) => e.id !== "default");
    const results = await Promise.allSettled([
      ...syncable.map((env) =>
        supabase.from("flux_environments").upsert({
          id: env.id,
          user_id: userId,
          data: env,
          updated_at: new Date().toISOString(),
        })
      ),
      supabase.from("flux_environments").upsert({
        id: "__globals__",
        user_id: userId,
        data: { globalVariables, globalSecretKeys },
        updated_at: new Date().toISOString(),
      }),
    ]);
    const any401 = results.some(r =>
      r.status === "fulfilled" && isSupabase401((r.value as { error: unknown }).error)
    );
    if (any401) { markSessionInvalid(); return; }
    const anyFailed = results.some(r => r.status === "rejected" || (r.status === "fulfilled" && (r.value as { error: unknown }).error));
    if (anyFailed) toast.warning("Sync failed — working offline", { id: "sync-fail", duration: 4000 });
  } catch {
    toast.warning("Sync failed — working offline", { id: "sync-fail", duration: 4000 });
  }
}

async function pullEnvironments(userId: string) {
  const { data } = await supabase
    .from("flux_environments")
    .select("id, data")
    .eq("user_id", userId);

  if (!data || data.length === 0) return;

  const store = useEnvironmentStore.getState();
  for (const row of data) {
    if (row.id === "__globals__") {
      const { globalVariables, globalSecretKeys } = row.data as {
        globalVariables: Record<string, string>;
        globalSecretKeys: string[];
      };
      store.loadGlobals(globalVariables ?? {}, globalSecretKeys ?? []);
    } else {
      store.loadEnvironment(row.data as Environment);
    }
  }
}

//
// SUBSCRIPTION — settings auto-push
//

let settingsUnsubscribe: (() => void) | null = null;

export function startSettingsSync(userId: string) {
  _syncingUserId = userId;
  if (settingsUnsubscribe) settingsUnsubscribe();
  settingsUnsubscribe = useSettingsStore.subscribe(() => {
    if (_syncingUserId) pushSettingsDebounced(_syncingUserId);
  });
}

export function stopSettingsSync() {
  _syncingUserId = null;
  settingsUnsubscribe?.();
  settingsUnsubscribe = null;
  if (settingsTimer) clearTimeout(settingsTimer);
  settingsTimer = null;
}

let environmentsUnsubscribe: (() => void) | null = null;
let _envSyncUserId: string | null = null;

export function startEnvironmentsSync(userId: string) {
  _envSyncUserId = userId;
  if (environmentsUnsubscribe) environmentsUnsubscribe();
  environmentsUnsubscribe = useEnvironmentStore.subscribe(() => {
    if (_envSyncUserId) pushEnvironmentsDebounced(_envSyncUserId);
  });
}

export function stopEnvironmentsSync() {
  _envSyncUserId = null;
  environmentsUnsubscribe?.();
  environmentsUnsubscribe = null;
  if (environmentsTimer) clearTimeout(environmentsTimer);
  environmentsTimer = null;
}

//
// SCHEMA VERSION
//

/**
 * Avisa una vez si la base de datos va por detras de lo que esta version de la
 * app espera. No bloquea el sync: lo que ya funcione seguira funcionando, y lo
 * que dependa de una migracion ausente fallara por su cuenta con su propio
 * mensaje. El aviso existe para que ese fallo no parezca un misterio.
 */
async function warnIfSchemaBehind(): Promise<void> {
  const check = await checkSchemaVersion();
  if (check.status !== "behind") return;
  toast.warning(
    `The database is behind this version of Flux (${check.found} < ${check.required}). Some features may not work until the pending migrations are applied.`,
    { id: "schema-behind", duration: 8000 },
  );
}

//
// ON LOGIN — pull everything
//

let _syncInProgress = false;

export async function syncOnLogin(userId: string) {
  // Prevent concurrent syncs (e.g. SIGNED_IN firing while restoreSession also calls this)
  if (_syncInProgress) return;
  _syncInProgress = true;
  _sessionInvalid = false;

  try {
    // Verify the session is still valid before making any API calls
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || session.user.id !== userId) {
      // Session gone or mismatched — try a refresh
      const { error } = await supabase.auth.refreshSession();
      if (error) {
        // Refresh also failed: token is truly expired → sign out cleanly
        await supabase.auth.signOut({ scope: "local" });
        return;
      }
    }

    await warnIfSchemaBehind();

    // Pull first, then start subscriptions (avoids echoing pulled data back immediately)
    await Promise.allSettled([
      pullSettings(userId),
      pullCollections(userId),
      pullHistory(userId),
      pullEnvironments(userId),
    ]);
    startSettingsSync(userId);
    startEnvironmentsSync(userId);
  } finally {
    _syncInProgress = false;
  }
}
