// Adapter over the shared engine in assertions.ts, kept for the Tests screen's
// result shape. New code should use `evaluate` directly.
import { evaluate, buildAssertionContext, type AssertionContext } from "@/lib/assertions";

export type TestContext = AssertionContext;

export interface AssertionResult {
  assertion: string;
  passed: boolean;
  detail?: string;
}

export interface TestResult {
  requestId: string;
  requestName: string;
  assertions: AssertionResult[];
  durationMs: number;
  error?: string;
}

export function evaluateAssertion(assertion: string, ctx: TestContext): AssertionResult {
  return evaluate(assertion, ctx);
}

export function buildContext(
  status: number,
  bodyRaw: string,
  headers: Record<string, string>,
  durationMs: number,
): TestContext {
  return buildAssertionContext(status, bodyRaw, headers, durationMs);
}
