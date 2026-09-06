import { APP_VERSION } from "@/lib/version";

export interface Release {
  version: string;
  date: string;
  title: string;
  points: string[];
  /** Muestra el panel de bienvenida al arrancar tras actualizar. */
  major?: boolean;
}

// Más reciente primero. Viaja dentro del binario a propósito: Flux es
// offline-first y esto no debería depender de la red.
export const RELEASES: Release[] = [
  {
    version: "0.2.1",
    date: "2026-09-05",
    title: "Fixes to what Flux sends, and what it never should have",
    major: true,
    points: [
      "Usage telemetry was sending the request URL after variable interpolation, so a request to `?api_key={{API_KEY}}` put the literal key in the analytics table. It now reports only the method, the scheme, and whether the host was localhost — never the URL, and never the hostname.",
      "Crash reports are now redacted before they leave your machine: URLs, home-directory paths, e-mail addresses and credential-shaped strings are stripped.",
      "Anonymous usage analytics now actually works if you turn it on. It has been silently discarded for months for anyone not signed in, which is most people. It remains off by default — Settings → Data & Privacy.",
      "Update checks now go through Flux's own endpoint instead of GitHub, so we can tell how many installations are still active. It stores a salted hash of your IP, never the address, and the salt is thrown away after two days. GitHub stays configured as a fallback, so updates keep working if the service is down.",
      "The Data & Privacy page in the docs now lists exactly what is sent and what never is, with links to the code. The previous description was wrong.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-08-17",
    title: "Free AI tier, collections that keep everything, one assertion engine",
    major: true,
    points: [
      "AI is now free to try: 100 actions a month, up to 20 a day, no API key and no setup. Your own key still works as before, unlimited and going straight from your machine to Anthropic.",
      "Collections now save the whole request: auth, query params, pre and post-request scripts, extractors, GraphQL and form bodies. Reopening a request gives back what you built.",
      "The app, the collection runner and the CLI now share one assertion engine, so the same assertion means the same thing everywhere.",
      "The CLI now runs pre and post-request scripts, so collections that authenticate through a script work in CI instead of being skipped.",
      "Heads up: an assertion with an unrecognised path used to resolve to null and pass. It now fails with `unknown path`. A CI pipeline that was silently green may start reporting real failures.",
      "Security: selecting a collection request or replaying from history carried the previous request's auth over to the new one. All entry points now reset the request first.",
      "Also: gRPC streaming, the QUERY method, nested collection folders, and a CLI that reports what it cannot run instead of running something subtly different.",
    ],
  },
];

function toParts(version: string): number[] {
  return version.split(".").map(n => parseInt(n, 10) || 0);
}

/** true si a es más nueva que b. */
export function isNewer(a: string, b: string): boolean {
  const pa = toParts(a);
  const pb = toParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return false;
}

/** No se anuncia una versión más nueva que la que corre. */
export function unseenReleases(lastSeenVersion: string): Release[] {
  return RELEASES.filter(
    r => isNewer(r.version, lastSeenVersion) && !isNewer(r.version, APP_VERSION),
  );
}

/**
 * Entrada que merece el panel de bienvenida: marcada como major, no vista, y
 * que no sea más nueva que la versión instalada.
 */
export function pendingMajorRelease(lastSeenVersion: string): Release | null {
  return unseenReleases(lastSeenVersion).find(r => r.major) ?? null;
}
