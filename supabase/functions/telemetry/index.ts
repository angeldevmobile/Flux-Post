/**
 * Flux · Ingesta de telemetría anónima.
 *
 * Existe porque las tablas están cerradas al rol anon. La anon key viaja
 * dentro del binario, así que es pública: abrir un insert a anon en RLS sería
 * abrir `analytics_events` a cualquiera con un curl. Aquí se valida el payload
 * y se escribe con service_role.
 *
 * El endpoint es deliberadamente tonto: acepta, valida, escribe, devuelve 204.
 * Nunca devuelve datos. Si algo del payload no cuadra se descarta esa entrada
 * en vez de fallar el lote entero — perder un evento no vale un reintento.
 *
 * Requiere `verify_jwt = false` en supabase/config.toml: la mayoría de las
 * instalaciones de Flux no tienen sesión.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1";

/**
 * La webview de Tauri manda `Origin: tauri://localhost` (macOS/Linux) o
 * `http://tauri.localhost` (Windows), y en `npm run dev` manda
 * `http://localhost:1420`. No hay una lista fija que compense mantener: este
 * endpoint no lee nada ni usa cookies, así que un origen abierto no expone
 * nada que no exponga ya el binario.
 *
 * Va aquí y no en `_shared/` a propósito: el archivo tiene que poder pegarse
 * entero en el editor del panel de Supabase sin arrastrar dependencias.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Topes por lote. La app manda cada 60s; nadie legítimo se acerca a esto. */
const MAX_EVENTS = 100;
const MAX_CRASHES = 20;
const MAX_TYPE_LEN = 64;
const MAX_MESSAGE_LEN = 2000;
const MAX_DATA_BYTES = 2048;
const MAX_BODY_BYTES = 128 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;
const PLATFORMS = new Set(["windows", "macos", "linux", "unknown"]);

/**
 * Lista blanca de eventos. Sin ella, un `trackEvent` nuevo en el cliente
 * escribiría lo que le diera la gana y la tabla acabaría siendo un vertedero.
 * Añadir un evento aquí es una decisión consciente, no un efecto secundario.
 */
const ALLOWED_TYPES = new Set([
  "app_open",
  "route_view",
  "request_send",
  "request_perf",
  "collection_run",
  "test_run",
  "import",
  "export",
  "ai_action",
  "sync_run",
  "update_installed",
]);

interface Incoming {
  install_id?: unknown;
  app_version?: unknown;
  platform?: unknown;
  events?: unknown;
  crashes?: unknown;
  count_active?: unknown;
}

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

/** `ts` viene del reloj del cliente, que puede estar en cualquier año. */
function saneTs(v: unknown): number {
  const n = typeof v === "number" ? v : NaN;
  const now = Date.now();
  if (!Number.isFinite(n)) return now;
  if (n < now - 30 * 24 * 3600 * 1000 || n > now + 24 * 3600 * 1000) return now;
  return Math.floor(n);
}

/**
 * `data` es un objeto plano de escalares y nada más. Un jsonb anidado
 * arbitrario es justo por donde se colaría una URL con un token dentro.
 */
function sanitizeData(v: unknown): Record<string, string | number | boolean> | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k.length > 40) continue;
    if (typeof val === "string") out[k] = val.slice(0, 120);
    else if (typeof val === "number" && Number.isFinite(val)) out[k] = val;
    else if (typeof val === "boolean") out[k] = val;
  }
  if (Object.keys(out).length === 0) return null;
  if (JSON.stringify(out).length > MAX_DATA_BYTES) return null;
  return out;
}

/**
 * Supabase inyecta la key de servicio sola, pero el nombre depende de la
 * generación del proyecto: los antiguos traen `SUPABASE_SERVICE_ROLE_KEY` y el
 * modelo nuevo de keys (`publishable` / `secret`) usa `SUPABASE_SECRET_KEY`.
 * Se prueban los dos para que la función no dependa de cuál toque.
 */
function serviceKey(): string {
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
  if (!k) throw new Error("no service key in env");
  return k;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: "payload too large" }, 413);
  }

  let body: Incoming;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const installId = str(body.install_id, 64);
  if (!installId || !UUID_RE.test(installId)) {
    return json({ error: "invalid install_id" }, 400);
  }

  const appVersion = str(body.app_version, 32);
  if (appVersion && !VERSION_RE.test(appVersion)) {
    return json({ error: "invalid app_version" }, 400);
  }

  const platformRaw = str(body.platform, 16) ?? "unknown";
  const platform = PLATFORMS.has(platformRaw) ? platformRaw : "unknown";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey(),
    { auth: { persistSession: false } },
  );

  // ── Eventos ──
  const eventsIn = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
  const events = eventsIn
    .map((e) => {
      const ev = e as Record<string, unknown>;
      const type = str(ev.type, MAX_TYPE_LEN);
      if (!type || !ALLOWED_TYPES.has(type)) return null;
      return {
        install_id: installId,
        user_id: null,
        type,
        data: sanitizeData(ev.data),
        ts: saneTs(ev.ts),
        app_version: appVersion,
        platform,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  // ── Crashes ──
  const crashesIn = Array.isArray(body.crashes) ? body.crashes.slice(0, MAX_CRASHES) : [];
  const crashes = crashesIn
    .map((c) => {
      const cr = c as Record<string, unknown>;
      const message = str(cr.message, MAX_MESSAGE_LEN);
      if (!message) return null;
      return {
        install_id: installId,
        user_id: null,
        message,
        ts: saneTs(cr.ts),
        app_version: appVersion,
        platform,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  try {
    if (events.length > 0) {
      await supabase.from("analytics_events").insert(events);
    }
    if (crashes.length > 0) {
      await supabase.from("crash_reports").insert(crashes);
    }

    // El ping de instalación es lo que produce usuarios activos y retención.
    // Solo se registra si el cliente dice que la telemetría de uso está
    // aceptada: un lote que solo trae un crash llega con `count_active: false`
    // y no debe convertir a esa persona en un usuario activo contabilizado.
    if (body.count_active === true) {
      await supabase.rpc("record_app_ping", {
        p_install_id: installId,
        p_app_version: appVersion,
        p_platform: platform,
      });
    }
  } catch (err) {
    console.error("telemetry insert failed", err);
    return json({ error: "write failed" }, 500);
  }

  return new Response(null, { status: 204, headers: corsHeaders });
});
