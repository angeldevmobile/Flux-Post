import { describe, it, expect } from "vitest";
import { evaluate, buildAssertionContext } from "../assertions";
import { evaluateAssertions } from "../assertionEvaluator";
import { evaluateAssertion as testsEval, buildContext } from "../testRunner";

const BODY = '{"token":"abc","count":5,"nested":{"id":7},"nothing":null,"list":[1,2]}';
const HEADERS = { "Content-Type": "application/json", "X-Rate-Limit": "60" };
const ctx = buildAssertionContext(200, BODY, HEADERS, 120);

const run = (a: string) => evaluate(a, ctx);
const passes = (a: string) => run(a).passed;

/**
 * The contract, in one place. Every case here is mirrored by a Rust test of the
 * same name in flux-cli so the two implementations cannot drift apart.
 */
const TABLE: [assertion: string, expected: boolean][] = [
  // status
  ["status == 200", true],
  ["status === 200", true],
  ["status != 404", true],
  ["status !== 200", false],
  ["status < 300", true],
  ["status <= 200", true],
  ["status > 199", true],
  ["status >= 201", false],

  // duration
  ["duration < 500", true],
  ["duration > 500", false],

  // both spellings of a body path resolve identically
  ['json.token == "abc"', true],
  ['body.token == "abc"', true],
  ["json.count == 5", true],
  ["body.count == 5", true],
  ["json.nested.id == 7", true],
  ["body.nested.id == 7", true],

  // absent vs null
  ["json.token != null", true],
  ["json.nothing == null", true],
  ["json.missing == null", true],
  ["json.missing != null", false],
  ["json.deeply.missing.path == null", true],

  // contains
  ['body contains "abc"', true],
  ['body contains "zzz"', false],
  ['json.token contains "ab"', true],
  ['body.token contains "zz"', false],

  // headers, either spelling, case-insensitive
  ['headers["Content-Type"] == "application/json"', true],
  ['headers["content-type"] == "application/json"', true],
  ['headers.content-type == "application/json"', true],
  ['headers.Content-Type == "application/json"', true],
  ["headers.x-rate-limit == 60", true],
  ['headers["X-Nope"] == "x"', false],
  ['headers["X-Nope"] == null', true],

  // an unknown path must fail, never pass vacuously
  ["nonsense.path == null", false],
  ["whatever == null", false],
  ["json2.token == null", false],
  ["totally bogus", false],
  ["", false],
];

describe("the assertion contract", () => {
  for (const [assertion, expected] of TABLE) {
    it(`${expected ? "passes" : "fails"}: ${assertion || "(empty)"}`, () => {
      expect(passes(assertion)).toBe(expected);
    });
  }
});

describe("failing loudly instead of vacuously passing", () => {
  it("rejects an unknown root rather than treating it as null", () => {
    const r = run("nonsense.path == null");
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/unknown path/i);
  });

  it("names the roots it does understand", () => {
    expect(run("foo == 1").detail).toMatch(/status, duration, body, json or headers/);
  });

  it("reports a non-JSON body instead of silently resolving to null", () => {
    const html = buildAssertionContext(200, "<html>nope</html>", {}, 10);
    const r = evaluate("json.token == null", html);
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/not JSON/i);
  });

  it("refuses to order-compare things that are not numbers", () => {
    const r = run('json.token < "5"');
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/numerically/);
  });

  it("says what it got when a comparison fails", () => {
    expect(run("status == 404").detail).toContain("got 200");
    expect(run("json.missing == 1").detail).toContain("got absent");
  });
});

describe("the two adapters agree with the engine", () => {
  // The bug this replaces: the collection runner and the Tests screen used
  // different languages, so the same assertion gave different answers.
  for (const [assertion, expected] of TABLE) {
    if (!assertion) continue;
    it(`agrees on: ${assertion}`, () => {
      const viaRunner = evaluateAssertions([assertion], 200, BODY, HEADERS, 120)[0].pass;
      const viaTests = testsEval(assertion, buildContext(200, BODY, HEADERS, 120)).passed;
      expect(viaRunner).toBe(expected);
      expect(viaTests).toBe(expected);
    });
  }
});

describe("value coercion", () => {
  it("matches a numeric string against a number", () => {
    const c = buildAssertionContext(200, '{"id":"5"}', {}, 0);
    expect(evaluate("json.id == 5", c).passed).toBe(true);
  });

  it("compares booleans", () => {
    const c = buildAssertionContext(200, '{"ok":true}', {}, 0);
    expect(evaluate("json.ok == true", c).passed).toBe(true);
    expect(evaluate("json.ok != false", c).passed).toBe(true);
  });

  it("accepts single or double quoted strings", () => {
    expect(passes("json.token == 'abc'")).toBe(true);
    expect(passes('json.token == "abc"')).toBe(true);
  });

  it("tolerates missing whitespace around the operator", () => {
    expect(passes("status==200")).toBe(true);
    expect(passes("  status  ==  200  ")).toBe(true);
  });
});
