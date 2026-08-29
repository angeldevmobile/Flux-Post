import { saveHistory } from "@/lib/tauri";
import { pushHistory } from "@/lib/sync";
import { maskSecrets, type Secret } from "@/lib/secretMasking";
import { useEnvironmentStore, type Environment } from "@/stores/environment";
import { useUserStore } from "@/stores/user";

/**
 * Los secretos del entorno activo y los globales. Son los unicos que
 * `resolveVariable` ha podido interpolar en la URL que se acaba de enviar.
 */
function activeSecrets(
  env: Environment | undefined,
  globalVariables: Record<string, string>,
  globalSecretKeys: string[],
): Secret[] {
  const out: Secret[] = [];
  for (const key of globalSecretKeys) {
    const value = globalVariables[key];
    if (value) out.push({ key, value });
  }
  for (const key of env?.secretKeys ?? []) {
    const value = env?.variables[key];
    if (value) out.push({ key, value });
  }
  return out;
}

/**
 * Unico punto de escritura del historial: SQLite y, si hay sesion, la nube.
 *
 * El enmascarado vive aqui y no en cada llamada para que no se pueda olvidar al
 * anadir un tercer sitio que registre historial.
 */
export async function recordHistory(entry: {
  method: string;
  url: string;
  status: number;
  durationMs: number;
}): Promise<void> {
  const { environments, activeId, globalVariables, globalSecretKeys } =
    useEnvironmentStore.getState();
  const env = environments.find((e) => e.id === activeId);
  const environment = env?.name ?? "";

  const url = maskSecrets(
    entry.url,
    activeSecrets(env, globalVariables, globalSecretKeys),
  );

  await saveHistory(entry.method, url, entry.status, entry.durationMs, environment);

  const userId = useUserStore.getState().user?.id;
  if (userId) {
    pushHistory(userId, {
      method: entry.method,
      url,
      status: entry.status,
      durationMs: entry.durationMs,
      environment,
      timestamp: new Date().toISOString(),
    });
  }
}
