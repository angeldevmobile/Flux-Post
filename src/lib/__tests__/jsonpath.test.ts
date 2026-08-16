import { describe, it, expect } from "vitest";
import { evaluatePath } from "../jsonpath";

// evaluatePath backs the variable extractor: users write `$.data.token -> {{token}}`
// rules and the captured string is written straight into the environment, so
// "returns null" and "returns the string 'null'" are very different outcomes.
describe("evaluatePath", () => {
  const data = {
    data: {
      token: "abc123",
      count: 42,
      active: true,
      nested: { deep: { value: "found" } },
      items: [{ id: 1, name: "first" }, { id: 2, name: "second" }],
      empty: null,
    },
  };

  it("reads a top-level property", () => {
    expect(evaluatePath("$.data", { data: "x" })).toBe("x");
  });

  it("reads a nested property", () => {
    expect(evaluatePath("$.data.token", data)).toBe("abc123");
  });

  it("walks arbitrarily deep", () => {
    expect(evaluatePath("$.data.nested.deep.value", data)).toBe("found");
  });

  it("stringifies non-string scalars", () => {
    expect(evaluatePath("$.data.count", data)).toBe("42");
    expect(evaluatePath("$.data.active", data)).toBe("true");
  });

  it("indexes into arrays", () => {
    expect(evaluatePath("$.data.items[0].name", data)).toBe("first");
    expect(evaluatePath("$.data.items[1].id", data)).toBe("2");
  });

  it("joins a bare wildcard over an array", () => {
    expect(evaluatePath("$.data.items[*]", data)).toBe(
      '{"id":1,"name":"first"}, {"id":2,"name":"second"}'
    );
  });

  it("projects the rest of the path over a wildcard", () => {
    expect(evaluatePath("$.data.items[*].id", data)).toBe("1, 2");
    expect(evaluatePath("$.data.items[*].name", data)).toBe("first, second");
  });

  it("leaves an empty entry where a wildcard projection misses", () => {
    const mixed = { items: [{ id: 1 }, { other: 2 }, { id: 3 }] };
    expect(evaluatePath("$.items[*].id", mixed)).toBe("1, , 3");
  });

  it("returns null when a wildcard lands on a non-array", () => {
    expect(evaluatePath("$.data.token[*]", data)).toBe(null);
  });

  it("serializes an object leaf as JSON", () => {
    expect(evaluatePath("$.data.nested.deep", data)).toBe('{"value":"found"}');
  });

  it("returns null for a missing path rather than the string 'undefined'", () => {
    expect(evaluatePath("$.data.nope", data)).toBe(null);
    expect(evaluatePath("$.data.nested.missing.deeper", data)).toBe(null);
  });

  it("returns null for a null leaf", () => {
    expect(evaluatePath("$.data.empty", data)).toBe(null);
  });

  it("returns null for an out-of-range index", () => {
    expect(evaluatePath("$.data.items[9].name", data)).toBe(null);
  });

  it("rejects paths that do not start with $", () => {
    expect(evaluatePath("data.token", data)).toBe(null);
    expect(evaluatePath("", data)).toBe(null);
  });

  it("returns null when descending into a scalar", () => {
    expect(evaluatePath("$.data.token.further", data)).toBe(null);
  });

  it("handles a null or undefined root", () => {
    expect(evaluatePath("$.a", null)).toBe(null);
    expect(evaluatePath("$.a", undefined)).toBe(null);
  });
});
