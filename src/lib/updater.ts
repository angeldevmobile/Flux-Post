import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { Update };

export async function checkForUpdates(): Promise<Update | null> {
  try {
    const update = await check();
    return update ?? null;
  } catch {
    return null;
  }
}

export async function installAndRestart(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}
