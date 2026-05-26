import { supabase } from "@/lib/supabase";
import { useSettingsStore } from "@/stores/settings";
import { useCollectionsStore, type Collection } from "@/stores/collections";

// Keys that should never leave the device
const DEVICE_ONLY_KEYS = ["claudeApiKey", "clientCertPem", "clientKeyPem"];

// ─────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────

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
  }).then(() => {}).catch(() => {});
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

// ─────────────────────────────────────────
// COLLECTIONS
// ─────────────────────────────────────────

export function pushCollection(userId: string, collection: Collection) {
  supabase.from("flux_collections").upsert({
    id: collection.id,
    user_id: userId,
    data: collection,
    updated_at: new Date().toISOString(),
  }).then(() => {}).catch(() => {});
}

async function pullCollections(userId: string) {
  const { data } = await supabase
    .from("flux_collections")
    .select("data")
    .eq("user_id", userId);

  if (!data) return;
  for (const row of data) {
    useCollectionsStore.getState().loadCollection(row.data as Collection);
  }
}

// ─────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────

let settingsTimer: ReturnType<typeof setTimeout> | null = null;
let _syncingUserId: string | null = null;

export function pushSettingsDebounced(userId: string) {
  if (settingsTimer) clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => pushSettings(userId), 1500);
}

async function pushSettings(userId: string) {
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
    await supabase.from("flux_settings").upsert({
      user_id: userId,
      data: syncable,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // silent — sync is best-effort
  }
}

async function pullSettings(userId: string) {
  const { data } = await supabase
    .from("flux_settings")
    .select("data")
    .eq("user_id", userId)
    .single();

  if (!data?.data) return;

  const cloud = data.data as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cloud)) {
    if (!DEVICE_ONLY_KEYS.includes(k)) patch[k] = v;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useSettingsStore.getState().patch(patch as any);
}

// ─────────────────────────────────────────
// SUBSCRIPTION — settings auto-push
// ─────────────────────────────────────────

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

// ─────────────────────────────────────────
// ON LOGIN — pull everything
// ─────────────────────────────────────────

export async function syncOnLogin(userId: string) {
  // Pull first, then start subscription (avoids echoing pulled data back immediately)
  await Promise.allSettled([
    pullSettings(userId),
    pullCollections(userId),
    pullHistory(userId),
  ]);
  startSettingsSync(userId);
}
