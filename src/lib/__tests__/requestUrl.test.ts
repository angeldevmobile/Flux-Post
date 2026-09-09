import { describe, it, expect } from "vitest";
import { resolveRequestUrl, appendQuery } from "@/lib/requestUrl";

describe("resolveRequestUrl", () => {
  it("joins with exactly one slash", () => {
    expect(resolveRequestUrl("https://api.test", "/users")).toBe("https://api.test/users");
    expect(resolveRequestUrl("https://api.test/", "users")).toBe("https://api.test/users");
    expect(resolveRequestUrl("https://api.test/", "/users")).toBe("https://api.test/users");
  });

  it("leaves an absolute path alone", () => {
    expect(resolveRequestUrl("https://api.test", "https://other.test/x"))
      .toBe("https://other.test/x");
  });

  it("returns the path when there is no base url", () => {
    expect(resolveRequestUrl(undefined, "/users")).toBe("/users");
    expect(resolveRequestUrl("   ", "/users")).toBe("/users");
  });

  it("keeps variable placeholders untouched", () => {
    expect(resolveRequestUrl("{{BASE}}", "/users/{{id}}")).toBe("{{BASE}}/users/{{id}}");
  });
});

describe("appendQuery", () => {
  it("leaves the url alone when there is nothing to add", () => {
    expect(appendQuery("https://api.example.com/x", {})).toBe("https://api.example.com/x");
  });

  it("adds the first parameter with a question mark", () => {
    expect(appendQuery("https://api.example.com/x", { a: "1" })).toBe("https://api.example.com/x?a=1");
  });

  it("appends to a url that already has a query", () => {
    expect(appendQuery("https://api.example.com/x?a=1", { b: "2" })).toBe(
      "https://api.example.com/x?a=1&b=2",
    );
  });

  it("encodes keys and values", () => {
    expect(appendQuery("https://api.example.com/x", { "a b": "c&d" })).toBe(
      "https://api.example.com/x?a%20b=c%26d",
    );
  });

  it("keeps the fragment at the end", () => {
    expect(appendQuery("https://api.example.com/x#top", { a: "1" })).toBe(
      "https://api.example.com/x?a=1#top",
    );
  });

  it("does not double up separators", () => {
    expect(appendQuery("https://api.example.com/x?", { a: "1" })).toBe("https://api.example.com/x?a=1");
    expect(appendQuery("https://api.example.com/x?a=1&", { b: "2" })).toBe(
      "https://api.example.com/x?a=1&b=2",
    );
  });

  it("skips empty keys", () => {
    expect(appendQuery("https://api.example.com/x", { "": "1", a: "2" })).toBe(
      "https://api.example.com/x?a=2",
    );
  });
});
