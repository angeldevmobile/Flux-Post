import { describe, it, expect } from "vitest";
import { evaluateAssertion, evaluateAssertions } from "./assertionEvaluator";

const ctx = (over: Partial<Parameters<typeof evaluateAssertion>[1]> = {}) => ({
  status: 200,
  body: '{"token":"abc","count":5,"user":{"name":"ana"},"missing":null}',
  headers: { "content-type": "application/json" },
  json: JSON.parse('{"token":"abc","count":5,"user":{"name":"ana"},"missing":null}'),
  ...over,
});

describe("status assertions", () => {
  it("compares with == and ===", () => {
    expect(evaluateAssertion("status == 200", ctx()).pass).toBe(true);
    expect(evaluateAssertion("status === 200", ctx()).pass).toBe(true);
    expect(evaluateAssertion("status == 404", ctx()).pass).toBe(false);
  });

  it("compares with != and !==", () => {
    expect(evaluateAssertion("status != 404", ctx()).pass).toBe(true);
    expect(evaluateAssertion("status !== 200", ctx()).pass).toBe(false);
  });

  it("compares with the ordering operators", () => {
    expect(evaluateAssertion("status < 300", ctx()).pass).toBe(true);
    expect(evaluateAssertion("status <= 200", ctx()).pass).toBe(true);
    expect(evaluateAssertion("status > 199", ctx()).pass).toBe(true);
    expect(evaluateAssertion("status >= 201", ctx()).pass).toBe(false);
  });

  it("tolerates surrounding and inner whitespace", () => {
    expect(evaluateAssertion("  status==200  ", ctx()).pass).toBe(true);
  });
});

describe("body assertions", () => {
  it("matches a substring", () => {
    expect(evaluateAssertion('body contains "abc"', ctx()).pass).toBe(true);
    expect(evaluateAssertion('body contains "nope"', ctx()).pass).toBe(false);
  });

  it("accepts single quotes", () => {
    expect(evaluateAssertion("body contains 'abc'", ctx()).pass).toBe(true);
  });
});

describe("json assertions", () => {
  it("compares a string field", () => {
    expect(evaluateAssertion('json.token == "abc"', ctx()).pass).toBe(true);
    expect(evaluateAssertion('json.token == "xyz"', ctx()).pass).toBe(false);
  });

  it("compares a numeric field", () => {
    expect(evaluateAssertion("json.count == 5", ctx()).pass).toBe(true);
    expect(evaluateAssertion("json.count > 3", ctx()).pass).toBe(true);
    expect(evaluateAssertion("json.count < 3", ctx()).pass).toBe(false);
  });

  it("walks a dotted path", () => {
    expect(evaluateAssertion('json.user.name == "ana"', ctx()).pass).toBe(true);
  });

  it("checks presence against null", () => {
    expect(evaluateAssertion("json.token != null", ctx()).pass).toBe(true);
    expect(evaluateAssertion("json.missing == null", ctx()).pass).toBe(true);
    expect(evaluateAssertion("json.missing != null", ctx()).pass).toBe(false);
  });

  it("treats an absent field as null", () => {
    expect(evaluateAssertion("json.nothere == null", ctx()).pass).toBe(true);
    expect(evaluateAssertion("json.nothere != null", ctx()).pass).toBe(false);
  });

  it("matches a substring inside a field", () => {
    expect(evaluateAssertion('json.token contains "ab"', ctx()).pass).toBe(true);
    expect(evaluateAssertion('json.token contains "zz"', ctx()).pass).toBe(false);
  });
});

describe("header assertions", () => {
  it("looks headers up case-insensitively", () => {
    expect(evaluateAssertion('headers["Content-Type"] == "application/json"', ctx()).pass).toBe(true);
    expect(evaluateAssertion('headers["content-type"] == "application/json"', ctx()).pass).toBe(true);
  });

  it("fails on a mismatch and on a missing header", () => {
    expect(evaluateAssertion('headers["Content-Type"] == "text/html"', ctx()).pass).toBe(false);
    expect(evaluateAssertion('headers["X-Nope"] == "x"', ctx()).pass).toBe(false);
  });

  it("supports negation", () => {
    expect(evaluateAssertion('headers["Content-Type"] != "text/html"', ctx()).pass).toBe(true);
  });
});

describe("malformed input", () => {
  it("fails closed on an unrecognised expression", () => {
    const r = evaluateAssertion("totally bogus", ctx());
    expect(r.pass).toBe(false);
    expect(r.message).toMatch(/Unknown assertion format/);
  });

  it("fails rather than throwing when json is null", () => {
    const r = evaluateAssertion('json.token == "abc"', ctx({ json: null }));
    expect(r.pass).toBe(false);
  });
});

describe("evaluateAssertions", () => {
  const body = '{"token":"abc","count":5}';

  it("evaluates every expression in order", () => {
    const results = evaluateAssertions(
      ["status == 200", 'json.token == "abc"', "json.count == 99"],
      200,
      body,
      {}
    );
    expect(results.map(r => r.pass)).toEqual([true, true, false]);
    expect(results[2].expr).toBe("json.count == 99");
  });

  it("still evaluates status when the body is not JSON", () => {
    const results = evaluateAssertions(["status == 500", 'json.a == "b"'], 500, "<html>oops</html>", {});
    expect(results[0].pass).toBe(true);
    expect(results[1].pass).toBe(false);
  });

  it("returns an empty list for no assertions", () => {
    expect(evaluateAssertions([], 200, body, {})).toEqual([]);
  });
});
