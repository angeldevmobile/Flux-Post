import { describe, it, expect } from "vitest";
import { stripFences, extractJsonObject, parseJsonLoose } from "@/lib/aiParsing";

describe("stripFences", () => {
  it("removes a fenced block and keeps the content", () => {
    expect(stripFences("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
    expect(stripFences("```\ntests:\n  - assert: status == 200\n```"))
      .toBe("tests:\n  - assert: status == 200");
  });

  it("leaves unfenced text alone", () => {
    expect(stripFences("  plain text  ")).toBe("plain text");
  });

  it("does not strip a lone backtick run inside the text", () => {
    expect(stripFences("use ```code``` here")).toBe("use ```code``` here");
  });
});

describe("parseJsonLoose", () => {
  it("parses plain json", () => {
    expect(parseJsonLoose<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses json wrapped in fences", () => {
    expect(parseJsonLoose<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("parses json surrounded by prose", () => {
    expect(parseJsonLoose<{ a: number }>('Here you go:\n{"a":1}\nHope it helps'))
      .toEqual({ a: 1 });
  });

  it("returns null when there is nothing parseable", () => {
    expect(parseJsonLoose("not json at all")).toBeNull();
    expect(parseJsonLoose("} broken {")).toBeNull();
  });
});

describe("extractJsonObject", () => {
  it("returns null when braces do not form an object", () => {
    expect(extractJsonObject("} nope {")).toBeNull();
    expect(extractJsonObject("no braces")).toBeNull();
  });
});
