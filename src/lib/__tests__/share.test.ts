import { describe, it, expect, vi } from "vitest";

// `share.ts` importa el cliente de Supabase, que no hace falta para estas
// funciones puras.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import {
  sanitizeForShare, hasUnscannedContent, parseShareId, shareUrl, toImportable,
} from "../share";
import type { Collection, CollectionRequest } from "@/lib/tauri";

const req = (over: Partial<CollectionRequest> = {}): CollectionRequest => ({
  id: "c-r1", name: "Login", method: "GET", path: "/login", headers: {}, tests: [], ...over,
});

const col = (over: Partial<Collection> = {}): Collection => ({
  id: "api", name: "API", requests: [], folders: [], expanded: false, ...over,
});

describe("sanitizeForShare", () => {
  it("replaces literal auth credentials with variables at every level", () => {
    const { collection, redactions } = sanitizeForShare(col({
      auth: { type: "bearer", token: "abc123" },
      folders: [{
        id: "f1", name: "Admin", expanded: false, requests: [
          req({ name: "Get users", auth: { type: "basic", username: "root", password: "hunter2" } }),
        ],
        auth: { type: "apikey", key: "X-API-Key", value: "k-999", in: "header" },
      }],
    }));

    expect(collection.auth).toEqual({ type: "bearer", token: "{{API_TOKEN}}" });
    expect(collection.folders[0].auth).toEqual({ type: "apikey", key: "X-API-Key", value: "{{ADMIN_API_KEY}}", in: "header" });
    const r = collection.folders[0].requests[0];
    expect(r.auth).toEqual({ type: "basic", username: "root", password: "{{GET_USERS_PASSWORD}}" });
    expect(redactions.map(x => x.variable)).toEqual(["API_TOKEN", "ADMIN_API_KEY", "GET_USERS_PASSWORD"]);
    // Nunca devuelve el valor quitado.
    expect(JSON.stringify(redactions)).not.toMatch(/abc123|hunter2|k-999/);
  });

  it("leaves references alone", () => {
    const { collection, redactions } = sanitizeForShare(col({
      auth: { type: "bearer", token: "{{TOKEN}}" },
      headers: { Authorization: "Bearer {{TOKEN}}" },
    }));
    expect(collection.auth?.token).toBe("{{TOKEN}}");
    expect(collection.headers?.Authorization).toBe("Bearer {{TOKEN}}");
    expect(redactions).toEqual([]);
  });

  it("keeps the auth scheme of a sensitive header", () => {
    const { collection } = sanitizeForShare(col({
      requests: [req({ headers: { Authorization: "Bearer eyJhbGc", Accept: "application/json", Cookie: "sid=1" } })],
    }));
    expect(collection.requests[0].headers).toEqual({
      Authorization: "Bearer {{LOGIN_AUTHORIZATION}}",
      Accept: "application/json",
      Cookie: "{{LOGIN_COOKIE}}",
    });
  });

  it("redacts sensitive params and the query written in the path", () => {
    const { collection } = sanitizeForShare(col({
      requests: [req({
        path: "/search?q=shoes&api_key=s3cr3t#top",
        params: { access_token: "tok", page: "2" },
      })],
    }));
    const r = collection.requests[0];
    expect(r.path).toBe("/search?q=shoes&api_key={{LOGIN_API_KEY}}#top");
    expect(r.params).toEqual({ access_token: "{{LOGIN_ACCESS_TOKEN}}", page: "2" });
  });

  it("redacts gRPC metadata", () => {
    const { collection } = sanitizeForShare(col({
      requests: [req({ kind: "grpc", grpc: { metadata: { authorization: "Bearer x1", "x-trace": "on" } } })],
    }));
    expect(collection.requests[0].grpc?.metadata).toEqual({
      authorization: "Bearer {{LOGIN_AUTHORIZATION}}", "x-trace": "on",
    });
  });

  it("drops machine-local fields and does not mutate the input", () => {
    const input = col({ rootDir: "C:/repo", group: "team", auth: { type: "bearer", token: "abc" } });
    const { collection } = sanitizeForShare(input);
    expect(collection.rootDir).toBeUndefined();
    expect(collection.group).toBeUndefined();
    expect(input.auth?.token).toBe("abc");
  });
});

describe("hasUnscannedContent", () => {
  it("flags bodies and scripts, which are shared as they are", () => {
    expect(hasUnscannedContent(col({ requests: [req()] }))).toBe(false);
    expect(hasUnscannedContent(col({ requests: [req({ body: "{}" })] }))).toBe(true);
    expect(hasUnscannedContent(col({
      folders: [{ id: "f", name: "F", expanded: true, requests: [], scripts: { preRequest: "pm.x()" } }],
    }))).toBe(true);
  });
});

describe("parseShareId", () => {
  const id = "0123456789abcdef0123456789abcdef";
  it("accepts the web link, the deep link and the bare id", () => {
    expect(parseShareId(shareUrl(id))).toBe(id);
    expect(parseShareId(`flux://share/${id}`)).toBe(id);
    expect(parseShareId(`  ${id}\n`)).toBe(id);
  });
  it("rejects anything else", () => {
    expect(parseShareId("https://fluxapi.dev/share.html#nope")).toBeNull();
    expect(parseShareId(`${id}ff`)).toBeNull();
    expect(parseShareId("")).toBeNull();
  });
});

describe("toImportable", () => {
  it("derives a free id from the name and rebuilds child ids", () => {
    const shared = col({
      id: "whatever", name: "Pagos API", rootDir: "x",
      requests: [req({ id: "a" })],
      folders: [{ id: "b", name: "F", expanded: false, requests: [req({ id: "c" })], folders: [] }],
    });
    const out = toImportable(shared, ["pagos-api"]);
    expect(out.id).toBe("pagos-api-2");
    expect(out.rootDir).toBeUndefined();
    expect(out.requests[0].id).toBe("pagos-api-2-r1");
    expect(out.folders[0].id).toBe("pagos-api-2-f1");
    expect(out.folders[0].requests[0].id).toBe("pagos-api-2-r2");
  });
});
