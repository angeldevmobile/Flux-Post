// Adapter over the shared engine in assertions.ts, kept for the collection
// runner's result shape. New code should use `evaluate` directly.
import { evaluate, buildAssertionContext, type AssertionContext } from "@/lib/assertions";

export interface AssertionResult {
  expr: string;
  pass: boolean;
  message: string;
}

export function evaluateAssertion(expr: string, ctx: AssertionContext): AssertionResult {
  const outcome = evaluate(expr, ctx);
  return {
    expr: outcome.assertion,
    pass: outcome.passed,
    message: outcome.detail ?? outcome.assertion,
  };
}

export function evaluateAssertions(
  asserts: string[],
  status: number,
  body: string,
  headers: Record<string, string>,
  durationMs = 0,
): AssertionResult[] {
  const ctx = buildAssertionContext(status, body, headers, durationMs);
  return asserts.map(a => evaluateAssertion(a, ctx));
}
