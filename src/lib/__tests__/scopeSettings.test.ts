import { describe, it, expect } from "vitest";
import { buildScopeAuth, buildScopeScripts, choiceFromAuth } from "../scopeSettings";

describe("choiceFromAuth", () => {
  it("defaults a folder to inherit and a collection to none", () => {
    expect(choiceFromAuth(undefined, true)).toBe("inherit");
    expect(choiceFromAuth(undefined, false)).toBe("none");
  });

  it("reads back a stored type", () => {
    expect(choiceFromAuth({ type: "bearer", token: "t" }, true)).toBe("bearer");
    expect(choiceFromAuth({ type: "apikey", key: "k", value: "v" }, false)).toBe("apikey");
  });

  it("maps an explicit `none` to none, not to inherit", () => {
    expect(choiceFromAuth({ type: "none" }, true)).toBe("none");
  });

  it("falls back to none for a type the editor cannot show", () => {
    expect(choiceFromAuth({ type: "awssigv4", accessKeyId: "AKIA" }, true)).toBe("none");
  });
});

describe("buildScopeAuth", () => {
  const draft = {
    type: "bearer",
    token: "t",
    username: "u",
    password: "p",
    key: "k",
    value: "v",
  };

  it("writes nothing for inherit", () => {
    expect(buildScopeAuth("inherit", draft, true)).toBeUndefined();
  });

  it("writes `type: none` on a folder so the inheritance is cut", () => {
    expect(buildScopeAuth("none", draft, true)).toEqual({ type: "none" });
  });

  it("writes nothing for none on a collection, where there is nothing to cut", () => {
    expect(buildScopeAuth("none", draft, false)).toBeUndefined();
  });

  it("keeps only the fields of the chosen type", () => {
    expect(buildScopeAuth("bearer", draft, true)).toEqual({ type: "bearer", token: "t" });
    expect(buildScopeAuth("basic", draft, true)).toEqual({
      type: "basic", username: "u", password: "p",
    });
    expect(buildScopeAuth("apikey", draft, true)).toEqual({
      type: "apikey", key: "k", value: "v", in: "header",
    });
  });

  it("does not carry over a previous type's credentials", () => {
    const out = buildScopeAuth("bearer", draft, true)!;
    expect(out.username).toBeUndefined();
    expect(out.key).toBeUndefined();
  });

  it("defaults an api key to the header and honours query", () => {
    expect(buildScopeAuth("apikey", { type: "apikey" }, true)).toEqual({
      type: "apikey", key: "", value: "", in: "header",
    });
    expect(buildScopeAuth("apikey", { ...draft, in: "query" }, true)?.in).toBe("query");
  });

  it("treats oauth2 as a static token", () => {
    expect(buildScopeAuth("oauth2", draft, true)).toEqual({ type: "oauth2", token: "t" });
  });
});

describe("buildScopeScripts", () => {
  it("returns undefined when both blocks are blank", () => {
    expect(buildScopeScripts("", "   \n  ")).toBeUndefined();
  });

  it("keeps only the block that has content", () => {
    expect(buildScopeScripts("pre();", "  ")).toEqual({ preRequest: "pre();" });
    expect(buildScopeScripts("", "post();")).toEqual({ postResponse: "post();" });
  });

  it("keeps both and preserves the original formatting", () => {
    expect(buildScopeScripts("  pre();\n", "post();")).toEqual({
      preRequest: "  pre();\n",
      postResponse: "post();",
    });
  });
});
