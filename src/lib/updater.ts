import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { Update };

export async function checkForUpdates(): Promise<Update | null> {
  try {
    const update = await check();
    return update ?? null;
  } catch (err) {
    // Sin conexión es normal, pero un error de permisos o de firma deja a
    // todos los usuarios sin actualizaciones: que al menos se vea en consola.
    console.error("update check failed", err);
    return null;
  }
}

export async function installAndRestart(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}
