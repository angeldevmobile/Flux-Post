/**
 * Flux · Endpoint de actualización con conteo de instalaciones activas.
 *
 * POR QUÉ EXISTE
 *
 * Hasta ahora el updater apuntaba directo a GitHub Releases, así que GitHub se
 * quedaba con la única señal recurrente que emite Flux. Cada instalación viva
 * comprueba actualizaciones al arrancar: es una medida de usuarios activos que
 * ya se estaba generando y que se estaba tirando a la basura.
 *
 * Esta función sirve el mismo `latest.json` (proxy literal desde GitHub, sin
 * tocar el contenido ni las firmas) y de paso cuenta la visita.
 *
 * PRIVACIDAD
 *
 * No hay identificador persistente. Se guarda sha256(sal_del_día + ip + UA);
 * la sal rota a diario y se borra a los dos días, así que el hash no se puede
 * revertir ni correlacionar entre días. La IP en crudo no se escribe nunca.
 * Aun así es un dato que antes recibía GitHub y ahora recibes tú: tiene que
 * constar en la política de privacidad.
 *
 * ROBUSTEZ
 *
 * Si algo aquí falla, el usuario NO se queda sin actualizaciones: en
 * tauri.conf.json este endpoint va primero y GitHub queda como segundo, y el
 * updater de Tauri recorre la lista hasta que uno responde. Además el conteo
 * va después de tener la respuesta y nunca puede tumbarla.
 *
 * Requiere `verify_jwt = false`: el updater de Tauri no manda Authorization.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1";

const UPSTREAM =
  "https://github.com/angeldevmobile/Flux-Post/releases/latest/download/latest.json";

/** Un fallo de red hacia GitHub no debe dejar la petición colgada. */
const UPSTREAM_TIMEOUT_MS = 8000;

const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;
const SAFE_RE = /^[a-z0-9_-]{1,32}$/i;

function clean(v: string | null, re: RegExp): string | null {
  return v && re.test(v) ? v : null;
}

/**
 * Detrás del proxy de Supabase la IP real viene en `x-forwarded-for`, que es
 * una lista; la primera entrada es el cliente.
 */
function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? "unknown";
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
  // ── 1. Traer el manifiesto. Es lo único que no puede fallar ──
  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM, {
      redirect: "follow",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("upstream fetch failed", err);
    // Cualquier status no exitoso hace que Tauri pase al siguiente endpoint de
    // la lista, que es GitHub. Un 204 NO valdría: para el updater significa
    // "no hay actualización" y corta el bucle sin probar el respaldo.
    // Ver tauri-plugin-updater 2.10.1, updater.rs:484.
    return new Response(null, { status: 502 });
  }

  if (!upstream.ok) {
    console.error("upstream status", upstream.status);
    return new Response(null, { status: 502 });
  }

  const body = await upstream.text();

  // ── 2. Contar la visita. Nunca puede afectar a la respuesta ──
  try {
    const url = new URL(req.url);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceKey(),
      { auth: { persistSession: false } },
    );

    await supabase.rpc("record_updater_ping", {
      p_ip: clientIp(req),
      p_user_agent: req.headers.get("user-agent") ?? "",
      p_app_version: clean(url.searchParams.get("v"), VERSION_RE),
      p_target: clean(url.searchParams.get("target"), SAFE_RE),
      p_arch: clean(url.searchParams.get("arch"), SAFE_RE),
    });
  } catch (err) {
    console.error("updater ping failed", err);
  }

  // ── 3. Devolver el manifiesto tal cual ──
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // El updater consulta al arrancar. Cinco minutos de caché absorben los
      // picos tras publicar una release sin retrasar la propagación.
      "Cache-Control": "public, max-age=300",
    },
  });
});
