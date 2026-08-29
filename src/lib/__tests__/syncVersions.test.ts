import { describe, it, expect } from "vitest";
import { decidePull, type SyncEntry } from "@/lib/syncVersions";

const synced = (version: number): SyncEntry => ({ version, dirty: false });
const dirty = (version: number): SyncEntry => ({ version, dirty: true });

describe("decidePull", () => {
  it("trae lo que no esta en esta maquina", () => {
    expect(decidePull(false, null, 1)).toBe("take");
    // Aunque hubiera una entrada huerfana de un borrado anterior.
    expect(decidePull(false, synced(9), 12)).toBe("take");
  });

  it("siembra la version cuando existe en los dos lados sin base", () => {
    expect(decidePull(true, null, 4)).toBe("seed");
    expect(decidePull(true, { version: null, dirty: false }, 4)).toBe("seed");
  });

  it("siembra tambien si hay cambios locales pero ninguna base", () => {
    // Sin base no se puede saber si el remoto ha avanzado, asi que no hay
    // conflicto que declarar: se ancla y el proximo guardado ya comparara.
    expect(decidePull(true, { version: null, dirty: true }, 4)).toBe("seed");
  });

  it("no hace nada si esta al dia", () => {
    expect(decidePull(true, synced(7), 7)).toBe("skip");
    expect(decidePull(true, dirty(7), 7)).toBe("skip");
  });

  it("no hace nada si lo local va por delante", () => {
    // Puede pasar tras un guardado confirmado que el pull todavia no ve.
    expect(decidePull(true, synced(9), 7)).toBe("skip");
  });

  it("adopta el remoto cuando ha avanzado y no hay nada pendiente", () => {
    expect(decidePull(true, synced(3), 4)).toBe("adopt");
    expect(decidePull(true, synced(3), 30)).toBe("adopt");
  });

  it("declara conflicto cuando ha avanzado en los dos sitios", () => {
    expect(decidePull(true, dirty(3), 4)).toBe("conflict");
  });

  it("nunca adopta por encima de cambios locales pendientes", () => {
    // La propiedad que importa: con `dirty`, ningun avance remoto puede
    // acabar en "adopt". Es lo que separa avisar de perder trabajo.
    for (let remote = 4; remote < 40; remote++) {
      expect(decidePull(true, dirty(3), remote)).not.toBe("adopt");
    }
  });
});
