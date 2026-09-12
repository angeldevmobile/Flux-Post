import { describe, it, expect } from "vitest";
import { findChain, resolveInherited, resolveInheritedAcross, resolveAncestorsAcross, resolveFolderAncestors } from "../inheritance";
import type { Collection, CollectionFolder, CollectionRequest } from "@/lib/tauri";

function req(id: string, extra: Partial<CollectionRequest> = {}): CollectionRequest {
  return {
    id,
    name: id,
    method: "GET",
    path: `/${id}`,
    headers: {},
    tests: [],
    ...extra,
  };
}

function folder(id: string, extra: Partial<CollectionFolder> = {}): CollectionFolder {
  return { id, name: id, expanded: true, requests: [], ...extra };
}

function collection(extra: Partial<Collection> = {}): Collection {
  return {
    id: "col",
    name: "API",
    requests: [],
    folders: [],
    expanded: true,
    ...extra,
  };
}

describe("findChain", () => {
  it("finds a request at the root, with no folders in the trail", () => {
    const col = collection({ requests: [req("a")] });
    expect(findChain(col, "a")?.folders).toEqual([]);
  });

  it("returns the full folder trail for a nested request", () => {
    const col = collection({
      folders: [folder("outer", { folders: [folder("inner", { requests: [req("a")] })] })],
    });
    expect(findChain(col, "a")?.folders.map((f) => f.id)).toEqual(["outer", "inner"]);
  });

  it("returns null when the request is not there", () => {
    expect(findChain(collection(), "nope")).toBeNull();
  });
});

describe("auth inheritance", () => {
  it("uses the collection auth when nothing closer defines one", () => {
    const col = collection({
      auth: { type: "bearer", token: "{{TOKEN}}" },
      requests: [req("a")],
    });
    const out = resolveInherited(col, "a")!;
    expect(out.auth).toEqual({ type: "bearer", token: "{{TOKEN}}" });
    expect(out.authSource).toEqual({ kind: "collection", name: "API" });
  });

  it("lets a folder override the collection", () => {
    const col = collection({
      auth: { type: "bearer", token: "{{TOKEN}}" },
      folders: [
        folder("Admin", {
          auth: { type: "apikey", key: "X-Admin", value: "{{ADMIN}}" },
          requests: [req("a")],
        }),
      ],
    });
    const out = resolveInherited(col, "a")!;
    expect(out.auth?.type).toBe("apikey");
    expect(out.authSource).toEqual({ kind: "folder", name: "Admin" });
  });

  it("prefers the nearest folder when both levels define auth", () => {
    const col = collection({
      folders: [
        folder("outer", {
          auth: { type: "bearer", token: "outer" },
          folders: [
            folder("inner", {
              auth: { type: "bearer", token: "inner" },
              requests: [req("a")],
            }),
          ],
        }),
      ],
    });
    expect(resolveInherited(col, "a")!.auth?.token).toBe("inner");
  });

  it("lets the request win over everything", () => {
    const col = collection({
      auth: { type: "bearer", token: "col" },
      folders: [folder("f", { auth: { type: "bearer", token: "folder" }, requests: [req("a", { auth: { type: "bearer", token: "own" } })] })],
    });
    const out = resolveInherited(col, "a")!;
    expect(out.auth?.token).toBe("own");
    expect(out.authSource?.kind).toBe("request");
  });

  it("does not mix fields from two levels. The nearest auth wins whole", () => {
    const col = collection({
      auth: { type: "basic", username: "u", password: "p" },
      folders: [folder("f", { auth: { type: "bearer", token: "t" }, requests: [req("a")] })],
    });
    const out = resolveInherited(col, "a")!;
    expect(out.auth).toEqual({ type: "bearer", token: "t" });
    expect(out.auth?.username).toBeUndefined();
  });

  it("treats `type: none` as cutting the inheritance on purpose", () => {
    const col = collection({
      auth: { type: "bearer", token: "{{TOKEN}}" },
      folders: [folder("public", { auth: { type: "none" }, requests: [req("a")] })],
    });
    const out = resolveInherited(col, "a")!;
    expect(out.auth).toBeUndefined();
    expect(out.authSource).toBeUndefined();
  });
});

describe("header inheritance", () => {
  it("merges all three levels", () => {
    const col = collection({
      headers: { "X-Tenant": "acme" },
      folders: [
        folder("f", {
          headers: { "X-Scope": "admin" },
          requests: [req("a", { headers: { "X-Trace": "1" } })],
        }),
      ],
    });
    expect(resolveInherited(col, "a")!.headers).toEqual({
      "X-Tenant": "acme",
      "X-Scope": "admin",
      "X-Trace": "1",
    });
  });

  it("lets the closest level win on a repeated header", () => {
    const col = collection({
      headers: { "X-Env": "prod" },
      folders: [folder("f", { headers: { "X-Env": "staging" }, requests: [req("a")] })],
    });
    expect(resolveInherited(col, "a")!.headers).toEqual({ "X-Env": "staging" });
  });

  it("matches header names case-insensitively, keeping the closest spelling", () => {
    const col = collection({
      headers: { "content-type": "text/plain" },
      requests: [req("a", { headers: { "Content-Type": "application/json" } })],
    });
    const headers = resolveInherited(col, "a")!.headers;
    expect(Object.keys(headers)).toEqual(["Content-Type"]);
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("script inheritance", () => {
  it("concatenates outer to inner instead of overriding", () => {
    const col = collection({
      scripts: { preRequest: "col();" },
      folders: [
        folder("f", {
          scripts: { preRequest: "folder();" },
          requests: [req("a", { scripts: { preRequest: "own();" } })],
        }),
      ],
    });
    expect(resolveInherited(col, "a")!.scripts?.preRequest).toBe("col();\nfolder();\nown();");
  });

  it("leaves scripts undefined when no level defines one", () => {
    const col = collection({ requests: [req("a")] });
    expect(resolveInherited(col, "a")!.scripts).toBeUndefined();
  });

  it("keeps pre and post independent", () => {
    const col = collection({
      scripts: { postResponse: "after();" },
      requests: [req("a", { scripts: { preRequest: "before();" } })],
    });
    const s = resolveInherited(col, "a")!.scripts!;
    expect(s.preRequest).toBe("before();");
    expect(s.postResponse).toBe("after();");
  });
});

describe("resolveInheritedAcross", () => {
  it("finds the request in whichever collection holds it", () => {
    const a = collection({ id: "a", name: "A", requests: [req("r1")] });
    const b = collection({ id: "b", name: "B", auth: { type: "bearer", token: "b" }, requests: [req("r2")] });
    expect(resolveInheritedAcross([a, b], "r2")!.auth?.token).toBe("b");
    expect(resolveInheritedAcross([a, b], "missing")).toBeNull();
  });
});

describe("resolveAncestorsAcross", () => {
  it("ignores what the request itself defines", () => {
    const col = collection({
      headers: { "X-Tenant": "acme" },
      auth: { type: "bearer", token: "col" },
      requests: [
        req("a", { headers: { "X-Own": "1" }, auth: { type: "bearer", token: "own" } }),
      ],
    });
    const out = resolveAncestorsAcross([col], "a")!;
    expect(out.headers).toEqual({ "X-Tenant": "acme" });
    expect(out.auth?.token).toBe("col");
    expect(out.authSource?.kind).toBe("collection");
  });

  it("still walks folders", () => {
    const col = collection({
      folders: [folder("f", { headers: { "X-Scope": "admin" }, requests: [req("a")] })],
    });
    expect(resolveAncestorsAcross([col], "a")!.headers).toEqual({ "X-Scope": "admin" });
  });

  it("leaves the request scripts out of the concatenation", () => {
    const col = collection({
      scripts: { preRequest: "col();" },
      requests: [req("a", { scripts: { preRequest: "own();" } })],
    });
    expect(resolveAncestorsAcross([col], "a")!.scripts?.preRequest).toBe("col();");
  });
});

describe("resolveFolderAncestors", () => {
  it("gives a top-level folder only what the collection defines", () => {
    const col = collection({
      auth: { type: "bearer", token: "col" },
      headers: { "X-Tenant": "acme" },
      folders: [folder("f", { auth: { type: "bearer", token: "own" }, headers: { "X-F": "1" } })],
    });
    const out = resolveFolderAncestors(col, "f")!;
    expect(out.auth?.token).toBe("col");
    expect(out.headers).toEqual({ "X-Tenant": "acme" });
    expect(out.authSource).toEqual({ kind: "collection", name: "API" });
  });

  it("includes the folders above a nested one but not itself", () => {
    const col = collection({
      folders: [
        folder("outer", {
          auth: { type: "bearer", token: "outer" },
          headers: { "X-Outer": "1" },
          folders: [folder("inner", { auth: { type: "bearer", token: "inner" } })],
        }),
      ],
    });
    const out = resolveFolderAncestors(col, "inner")!;
    expect(out.auth?.token).toBe("outer");
    expect(out.headers).toEqual({ "X-Outer": "1" });
  });

  it("returns null for an unknown folder", () => {
    expect(resolveFolderAncestors(collection(), "nope")).toBeNull();
  });

  it("returns an empty result when nothing above defines anything", () => {
    const col = collection({ folders: [folder("f")] });
    const out = resolveFolderAncestors(col, "f")!;
    expect(out.auth).toBeUndefined();
    expect(out.headers).toEqual({});
  });
});
