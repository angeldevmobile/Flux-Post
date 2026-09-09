import { describe, it, expect } from "vitest";
import { findFolder, updateFolder, compactHeaders, allRequests, requestsWithTests } from "../collectionTree";
import type { Collection, CollectionFolder } from "@/lib/tauri";

function folder(id: string, extra: Partial<CollectionFolder> = {}): CollectionFolder {
  return { id, name: id, expanded: true, requests: [], ...extra };
}

function tree(): Collection {
  return {
    id: "col",
    name: "API",
    requests: [],
    expanded: true,
    folders: [
      folder("a", { folders: [folder("a1"), folder("a2", { folders: [folder("a2x")] })] }),
      folder("b"),
    ],
  };
}

describe("findFolder", () => {
  it("finds a top-level folder", () => {
    expect(findFolder(tree(), "b")?.id).toBe("b");
  });

  it("finds a folder nested three levels down", () => {
    expect(findFolder(tree(), "a2x")?.id).toBe("a2x");
  });

  it("returns null for an unknown id", () => {
    expect(findFolder(tree(), "nope")).toBeNull();
  });
});

describe("updateFolder", () => {
  it("applies the patch to the right folder", () => {
    const out = updateFolder(tree(), "a2x", { auth: { type: "bearer", token: "t" } });
    expect(findFolder(out, "a2x")?.auth?.token).toBe("t");
  });

  it("leaves the other folders untouched", () => {
    const out = updateFolder(tree(), "a1", { headers: { "X-A": "1" } });
    expect(findFolder(out, "a2")?.headers).toBeUndefined();
    expect(findFolder(out, "b")?.headers).toBeUndefined();
  });

  it("does not mutate the original collection", () => {
    const original = tree();
    const snapshot = JSON.stringify(original);
    updateFolder(original, "a2x", { headers: { "X-A": "1" } });
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("keeps every branch of the tree", () => {
    const out = updateFolder(tree(), "a2x", { name: "renamed" });
    expect(findFolder(out, "a1")).not.toBeNull();
    expect(findFolder(out, "a2")).not.toBeNull();
    expect(findFolder(out, "b")).not.toBeNull();
    expect(findFolder(out, "a2x")?.name).toBe("renamed");
  });

  it("returns the collection unchanged when the id is unknown", () => {
    const original = tree();
    const out = updateFolder(original, "nope", { name: "x" });
    expect(JSON.stringify(out)).toBe(JSON.stringify(original));
  });

  it("can clear a field by patching it to undefined", () => {
    const withAuth = updateFolder(tree(), "b", { auth: { type: "bearer", token: "t" } });
    const cleared = updateFolder(withAuth, "b", { auth: undefined });
    expect(findFolder(cleared, "b")?.auth).toBeUndefined();
  });
});

describe("compactHeaders", () => {
  it("drops rows with an empty or whitespace key", () => {
    expect(compactHeaders([
      { key: "X-A", value: "1" },
      { key: "", value: "2" },
      { key: "   ", value: "3" },
    ])).toEqual({ "X-A": "1" });
  });

  it("trims the key but keeps the value verbatim", () => {
    expect(compactHeaders([{ key: "  X-A  ", value: "  spaced  " }])).toEqual({
      "X-A": "  spaced  ",
    });
  });

  it("keeps an empty value, which is a valid header", () => {
    expect(compactHeaders([{ key: "X-A", value: "" }])).toEqual({ "X-A": "" });
  });

  it("lets a later row win on a duplicate key", () => {
    expect(compactHeaders([
      { key: "X-A", value: "1" },
      { key: "X-A", value: "2" },
    ])).toEqual({ "X-A": "2" });
  });
});

describe("allRequests", () => {
  const req = (id: string, tests: { assert: string }[] = []) => ({
    id, name: id, method: "GET" as const, path: `/${id}`, headers: {}, tests,
  });

  it("includes root requests and every nesting level", () => {
    const col: Collection = {
      id: "c", name: "c", expanded: true,
      requests: [req("root")],
      folders: [
        folder("a", { requests: [req("a1")], folders: [folder("b", { requests: [req("b1")] })] }),
        folder("c", { requests: [req("c1")] }),
      ],
    };
    expect(allRequests(col).map(r => r.id)).toEqual(["root", "a1", "b1", "c1"]);
  });

  it("returns an empty list for an empty collection", () => {
    expect(allRequests({ id: "c", name: "c", requests: [], folders: [], expanded: true })).toEqual([]);
  });

  it("handles a folder with no subfolders key", () => {
    const col: Collection = {
      id: "c", name: "c", expanded: true, requests: [],
      folders: [{ id: "f", name: "f", expanded: true, requests: [req("x")] }],
    };
    expect(allRequests(col).map(r => r.id)).toEqual(["x"]);
  });
});

describe("requestsWithTests", () => {
  const req = (id: string, tests: { assert: string }[] = []) => ({
    id, name: id, method: "GET" as const, path: `/${id}`, headers: {}, tests,
  });

  it("keeps only requests carrying assertions, at any depth", () => {
    const col: Collection = {
      id: "c", name: "c", expanded: true,
      requests: [req("root"), req("rootTested", [{ assert: "status == 200" }])],
      folders: [folder("f", { requests: [req("nested", [{ assert: "status == 201" }]), req("plain")] })],
    };
    expect(requestsWithTests(col).map(r => r.id)).toEqual(["rootTested", "nested"]);
  });
});
