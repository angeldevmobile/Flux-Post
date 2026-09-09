import { describe, it, expect } from "vitest";
import { authToRequest, needsAwsSigning } from "../authHeaders";

describe("authToRequest", () => {
  it("returns nothing for no auth", () => {
    expect(authToRequest(undefined)).toEqual({ headers: {}, query: {} });
    expect(authToRequest({ type: "none" })).toEqual({ headers: {}, query: {} });
  });

  it("builds a bearer header", () => {
    expect(authToRequest({ type: "bearer", token: "abc" }).headers).toEqual({
      Authorization: "Bearer abc",
    });
  });

  it("base64-encodes basic credentials", () => {
    expect(authToRequest({ type: "basic", username: "u", password: "p" }).headers).toEqual({
      Authorization: `Basic ${btoa("u:p")}`,
    });
  });

  it("allows an empty basic password", () => {
    expect(authToRequest({ type: "basic", username: "u" }).headers).toEqual({
      Authorization: `Basic ${btoa("u:")}`,
    });
  });

  it("puts an api key in the header by default and in the query when asked", () => {
    expect(authToRequest({ type: "apikey", key: "X-Key", value: "v" })).toEqual({
      headers: { "X-Key": "v" },
      query: {},
    });
    expect(authToRequest({ type: "apikey", key: "api_key", value: "v", in: "query" })).toEqual({
      headers: {},
      query: { api_key: "v" },
    });
  });

  it("uses the oauth2 token once it has been obtained", () => {
    expect(authToRequest({ type: "oauth2", token: "t" }).headers).toEqual({
      Authorization: "Bearer t",
    });
    expect(authToRequest({ type: "oauth2", clientId: "c" }).headers).toEqual({});
  });

  it("emits nothing when the credential is missing", () => {
    expect(authToRequest({ type: "bearer" }).headers).toEqual({});
    expect(authToRequest({ type: "apikey", key: "X-Key" }).headers).toEqual({});
  });

  it("flags sigv4 as needing the async signer", () => {
    expect(needsAwsSigning({ type: "awssigv4", accessKeyId: "AKIA" })).toBe(true);
    expect(needsAwsSigning({ type: "awssigv4" })).toBe(false);
    expect(needsAwsSigning({ type: "bearer", token: "t" })).toBe(false);
  });
});
