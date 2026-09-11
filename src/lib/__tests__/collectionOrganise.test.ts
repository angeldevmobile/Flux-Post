import { describe, it, expect } from "vitest";
import {
  findFolder,
  findRequest,
  allRequests,
  renameFolder,
  renameRequest,
  addFolder,
  addRequest,
  deleteFolder,
  deleteRequest,
  folderContaining,
  moveRequest,
  moveRequestBetween,
  duplicateRequest,
} from "@/lib/collectionTree";
import type { Collection, CollectionFolder, CollectionRequest } from "@/lib/tauri";

function folder(id: string, extra: Partial<CollectionFolder> = {}): CollectionFolder {
  return { id, name: id, expanded: true, requests: [], ...extra };
}

function r(id: string): CollectionRequest {
  return { id, name: id, method: "GET", path: `/${id}`, headers: {}, tests: [] };
}

/**
 *  raiz: r0
 *  a: r1      a/a1: r2      a/a2: (vacia)
 *  b: r3
 */
function tree(): Collection {
  return {
    id: "c",
    name: "API",
    expanded: true,
    requests: [r("r0")],
    folders: [
      folder("a", {
        requests: [r("r1")],
        folders: [folder("a1", { requests: [r("r2")] }), folder("a2")],
      }),
      folder("b", { requests: [r("r3")] }),
    ],
  };
}

describe("renameFolder", () => {
  it("renames a nested folder", () => {
    expect(findFolder(renameFolder(tree(), "a1", "Renamed"), "a1")?.name).toBe("Renamed");
  });

  it("leaves the other folders alone", () => {
    const out = renameFolder(tree(), "a1", "Renamed");
    expect(findFolder(out, "a")?.name).toBe("a");
    expect(findFolder(out, "b")?.name).toBe("b");
  });
});

describe("renameRequest", () => {
  it("renames one at the root", () => {
    expect(findRequest(renameRequest(tree(), "r0", "New"), "r0")?.name).toBe("New");
  });

  it("renames one two levels down", () => {
    expect(findRequest(renameRequest(tree(), "r2", "New"), "r2")?.name).toBe("New");
  });

  it("touches only the one asked for", () => {
    const out = renameRequest(tree(), "r2", "New");
    expect(allRequests(out).filter((x) => x.name === "New")).toHaveLength(1);
    expect(allRequests(out)).toHaveLength(4);
  });
});

describe("addFolder", () => {
  it("adds to the collection root", () => {
    expect(addFolder(tree(), null, folder("new")).folders.map((f) => f.id)).toEqual([
      "a",
      "b",
      "new",
    ]);
  });

  it("adds inside a nested folder", () => {
    const out = addFolder(tree(), "a1", folder("deep"));
    expect(findFolder(out, "a1")?.folders?.map((f) => f.id)).toEqual(["deep"]);
  });

  it("is a no-op for an unknown parent", () => {
    const before = tree();
    expect(JSON.stringify(addFolder(before, "nope", folder("x")))).toBe(JSON.stringify(before));
  });
});

describe("addRequest", () => {
  it("adds to the collection root", () => {
    expect(addRequest(tree(), null, r("new")).requests.map((x) => x.id)).toEqual(["r0", "new"]);
  });

  it("adds inside an empty nested folder", () => {
    const out = addRequest(tree(), "a2", r("new"));
    expect(findFolder(out, "a2")?.requests.map((x) => x.id)).toEqual(["new"]);
  });
});

describe("deleteFolder", () => {
  it("removes a root folder and everything under it", () => {
    const out = deleteFolder(tree(), "a");
    expect(out.folders.map((f) => f.id)).toEqual(["b"]);
    expect(allRequests(out).map((x) => x.id)).toEqual(["r0", "r3"]);
  });

  it("removes a nested folder without touching its siblings", () => {
    const out = deleteFolder(tree(), "a1");
    expect(findFolder(out, "a1")).toBeNull();
    expect(findFolder(out, "a2")).not.toBeNull();
    expect(findRequest(out, "r1")).not.toBeNull();
  });
});

describe("deleteRequest", () => {
  it("removes one from the root", () => {
    expect(findRequest(deleteRequest(tree(), "r0"), "r0")).toBeNull();
  });

  /** Lo que la accion de la store nunca hizo: solo miraba el nivel raiz. */
  it("removes one from two levels down", () => {
    const out = deleteRequest(tree(), "r2");
    expect(findRequest(out, "r2")).toBeNull();
    expect(allRequests(out)).toHaveLength(3);
  });

  it("is a no-op for an unknown id", () => {
    expect(allRequests(deleteRequest(tree(), "nope"))).toHaveLength(4);
  });
});

describe("folderContaining", () => {
  it("returns null for a request at the root", () => {
    expect(folderContaining(tree(), "r0")).toBeNull();
  });

  it("returns the folder that holds it", () => {
    expect(folderContaining(tree(), "r2")).toBe("a1");
    expect(folderContaining(tree(), "r1")).toBe("a");
  });
});

describe("moveRequest", () => {
  it("moves from the root into a folder", () => {
    const out = moveRequest(tree(), "r0", "b");
    expect(folderContaining(out, "r0")).toBe("b");
    expect(out.requests).toHaveLength(0);
  });

  it("moves from a folder out to the root", () => {
    const out = moveRequest(tree(), "r2", null);
    expect(folderContaining(out, "r2")).toBeNull();
    expect(findFolder(out, "a1")?.requests).toHaveLength(0);
  });

  it("moves between nested folders", () => {
    expect(folderContaining(moveRequest(tree(), "r2", "a2"), "r2")).toBe("a2");
  });

  it("keeps the request itself intact", () => {
    const before = findRequest(tree(), "r2")!;
    expect(findRequest(moveRequest(tree(), "r2", "b"), "r2")).toEqual(before);
  });

  it("never loses the request, whatever the target", () => {
    for (const target of [null, "a", "a1", "a2", "b"]) {
      expect(allRequests(moveRequest(tree(), "r2", target))).toHaveLength(4);
    }
  });

  it("is a no-op for an unknown request or target", () => {
    expect(allRequests(moveRequest(tree(), "nope", "a"))).toHaveLength(4);
    const before = tree();
    expect(JSON.stringify(moveRequest(before, "r0", "nope"))).toBe(JSON.stringify(before));
  });
});

describe("moveRequestBetween", () => {
  const other = (extra: Partial<Collection> = {}): Collection => ({
    id: "d",
    name: "Other",
    requests: [],
    folders: [folder("z")],
    expanded: true,
    ...extra,
  });

  it("removes it from one collection and adds it to the other", () => {
    const out = moveRequestBetween(tree(), other(), "r2", "z", "d-new")!;
    expect(findRequest(out.from, "r2")).toBeNull();
    expect(findFolder(out.to, "z")?.requests.map((x) => x.id)).toEqual(["d-new"]);
  });

  it("gives it a new id so it cannot clash in the destination", () => {
    const to = other({ requests: [r("r2")], folders: [] });
    const out = moveRequestBetween(tree(), to, "r2", null, "d-new")!;
    expect(out.to.requests.map((x) => x.id)).toEqual(["r2", "d-new"]);
  });

  it("returns null when the request or the target folder is unknown", () => {
    expect(moveRequestBetween(tree(), other(), "nope", null, "x")).toBeNull();
    expect(moveRequestBetween(tree(), other(), "r0", "nope", "x")).toBeNull();
  });
});

describe("duplicateRequest", () => {
  it("puts the copy next to the original", () => {
    const out = duplicateRequest(tree(), "r2", "copy-1");
    expect(findFolder(out, "a1")?.requests.map((x) => x.id)).toEqual(["r2", "copy-1"]);
  });

  it("marks the copy in its name and leaves the original untouched", () => {
    const out = duplicateRequest(tree(), "r2", "copy-1");
    expect(findRequest(out, "copy-1")?.name).toBe("r2 copy");
    expect(findRequest(out, "r2")?.name).toBe("r2");
  });

  it("duplicates a root request into the root", () => {
    expect(duplicateRequest(tree(), "r0", "copy-1").requests.map((x) => x.id)).toEqual([
      "r0",
      "copy-1",
    ]);
  });
});
