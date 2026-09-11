import { describe, it, expect, beforeEach } from "vitest";
import {
  addRoot,
  clearRoots,
  getRoots,
  normalizeRoot,
  removeRoot,
  rootFor,
  rootLabel,
  mergeRootCollections,
} from "@/lib/collectionRoots";
import type { Collection } from "@/lib/tauri";

const ROOTS_KEY = "flux_collection_roots";
const LEGACY_KEY = "flux_collections_dir";

function col(id: string, rootDir?: string): Collection {
  return { id, name: id, requests: [], folders: [], expanded: true, ...(rootDir ? { rootDir } : {}) };
}

beforeEach(() => {
  localStorage.clear();
});

describe("normalizeRoot", () => {
  it("trims whitespace", () => {
    expect(normalizeRoot("  C:/api  ")).toBe("C:/api");
  });

  it("drops a trailing slash so the same folder is not added twice", () => {
    expect(normalizeRoot("C:/api/")).toBe("C:/api");
    expect(normalizeRoot("C:\\api\\")).toBe("C:\\api");
    expect(normalizeRoot("/home/me/api//")).toBe("/home/me/api");
  });

  it("leaves an inner separator alone", () => {
    expect(normalizeRoot("C:/repos/payments/api")).toBe("C:/repos/payments/api");
  });
});

describe("getRoots", () => {
  it("starts empty", () => {
    expect(getRoots()).toEqual([]);
  });

  it("migrates the old single-folder key on first read", () => {
    localStorage.setItem(LEGACY_KEY, "C:/old-collections");
    expect(getRoots()).toEqual(["C:/old-collections"]);
    // Y queda persistido en el formato nuevo.
    expect(JSON.parse(localStorage.getItem(ROOTS_KEY)!)).toEqual(["C:/old-collections"]);
  });

  it("normalises what it migrates", () => {
    localStorage.setItem(LEGACY_KEY, "C:/old/");
    expect(getRoots()).toEqual(["C:/old"]);
  });

  it("ignores the old key once there are roots", () => {
    localStorage.setItem(ROOTS_KEY, JSON.stringify(["C:/new"]));
    localStorage.setItem(LEGACY_KEY, "C:/old");
    expect(getRoots()).toEqual(["C:/new"]);
  });

  it("does not migrate an empty old value", () => {
    localStorage.setItem(LEGACY_KEY, "   ");
    expect(getRoots()).toEqual([]);
  });

  it("survives a corrupt value instead of throwing", () => {
    localStorage.setItem(ROOTS_KEY, "{not json");
    expect(getRoots()).toEqual([]);
  });

  it("drops non-string entries", () => {
    localStorage.setItem(ROOTS_KEY, JSON.stringify(["C:/a", 7, null, "", "C:/b"]));
    expect(getRoots()).toEqual(["C:/a", "C:/b"]);
  });
});

describe("addRoot", () => {
  it("appends in order", () => {
    addRoot("C:/a");
    addRoot("C:/b");
    expect(getRoots()).toEqual(["C:/a", "C:/b"]);
  });

  it("does not duplicate the same folder, with or without a trailing slash", () => {
    addRoot("C:/a");
    addRoot("C:/a/");
    addRoot("  C:/a  ");
    expect(getRoots()).toEqual(["C:/a"]);
  });

  it("keeps the original position when adding an existing root again", () => {
    addRoot("C:/a");
    addRoot("C:/b");
    addRoot("C:/a");
    expect(getRoots()).toEqual(["C:/a", "C:/b"]);
  });

  it("ignores an empty path", () => {
    addRoot("   ");
    expect(getRoots()).toEqual([]);
  });
});

describe("removeRoot", () => {
  it("removes one and leaves the rest", () => {
    addRoot("C:/a");
    addRoot("C:/b");
    expect(removeRoot("C:/a")).toEqual(["C:/b"]);
  });

  it("matches regardless of a trailing slash", () => {
    addRoot("C:/a");
    expect(removeRoot("C:/a/")).toEqual([]);
  });

  it("is a no-op for an unknown root", () => {
    addRoot("C:/a");
    expect(removeRoot("C:/nope")).toEqual(["C:/a"]);
  });
});

describe("clearRoots", () => {
  it("empties the list", () => {
    addRoot("C:/a");
    expect(clearRoots()).toEqual([]);
    expect(getRoots()).toEqual([]);
  });
});

describe("rootFor", () => {
  it("uses the collection's own root", () => {
    addRoot("C:/a");
    expect(rootFor(col("x", "C:/b"))).toBe("C:/b");
  });

  it("falls back to the root of a loaded collection with the same id", () => {
    addRoot("C:/a");
    // El caso real: una coleccion que baja de la nube no trae rootDir.
    expect(rootFor(col("x"), [col("x", "C:/b")])).toBe("C:/b");
  });

  it("falls back to the first open root", () => {
    addRoot("C:/a");
    addRoot("C:/b");
    expect(rootFor(col("x"))).toBe("C:/a");
  });

  it("returns null when nothing is open, so there is no file to write", () => {
    expect(rootFor(col("x"))).toBeNull();
  });
});

describe("rootLabel", () => {
  it("shows the last path segment", () => {
    expect(rootLabel("C:/repos/payments/api")).toBe("api");
    expect(rootLabel("/home/me/collections")).toBe("collections");
    expect(rootLabel("C:\\repos\\billing")).toBe("billing");
  });

  it("falls back to the whole path when there is no segment", () => {
    expect(rootLabel("/")).toBe("/");
  });
});

describe("mergeRootCollections", () => {
  const c = (id: string): Collection => ({
    id, name: id, requests: [], folders: [], expanded: true,
  });

  it("tags every collection with the root it came from", () => {
    const out = mergeRootCollections([
      { root: "C:/a", collections: [c("users")] },
      { root: "C:/b", collections: [c("orders")] },
    ]);
    expect(out.map((x) => [x.id, x.rootDir])).toEqual([
      ["users", "C:/a"],
      ["orders", "C:/b"],
    ]);
  });

  it("leaves ids untouched when there is a single root", () => {
    // Lo que evita que la nube vea colecciones nuevas tras actualizar.
    const out = mergeRootCollections([
      { root: "C:/only", collections: [c("users"), c("orders")] },
    ]);
    expect(out.map((x) => x.id)).toEqual(["users", "orders"]);
  });

  it("disambiguates a clash with the folder name, first one keeps its id", () => {
    const out = mergeRootCollections([
      { root: "C:/repos/payments", collections: [c("api")] },
      { root: "C:/repos/billing", collections: [c("api")] },
    ]);
    expect(out.map((x) => x.id)).toEqual(["api", "billing/api"]);
  });

  it("numbers a clash when two roots share a folder name", () => {
    const out = mergeRootCollections([
      { root: "C:/one/api", collections: [c("main")] },
      { root: "C:/two/api", collections: [c("main")] },
      { root: "C:/three/api", collections: [c("main")] },
    ]);
    expect(out.map((x) => x.id)).toEqual(["main", "api/main", "api-2/main"]);
  });

  it("keeps the save path intact: group decides the subfolder, not the id", () => {
    const grouped: Collection = { ...c("api"), group: "Admin" };
    const out = mergeRootCollections([
      { root: "C:/a", collections: [c("api")] },
      { root: "C:/b", collections: [grouped] },
    ]);
    expect(out[1].id).toBe("b/api");
    expect(out[1].group).toBe("Admin");
  });

  it("does not disambiguate collections that do not clash", () => {
    const out = mergeRootCollections([
      { root: "C:/a", collections: [c("users"), c("orders")] },
      { root: "C:/b", collections: [c("orders"), c("invoices")] },
    ]);
    expect(out.map((x) => x.id)).toEqual(["users", "orders", "b/orders", "invoices"]);
  });

  it("returns an empty list for no roots", () => {
    expect(mergeRootCollections([])).toEqual([]);
  });
});
