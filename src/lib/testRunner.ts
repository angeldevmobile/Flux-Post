export interface TestContext {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  durationMs: number;
}

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

function getNestedValue(obj: unknown, parts: string[]): unknown {
  if (parts.length === 0) return obj;
  if (obj === null || obj === undefined || typeof obj !== "object") return undefined;
  const [first, ...rest] = parts;
  return getNestedValue((obj as Record<string, unknown>)[first], rest);
}

function resolveLeft(path: string, ctx: TestContext): unknown {
  if (path === "status") return ctx.status;
  if (path === "duration") return ctx.durationMs;
  if (path === "body") return ctx.body;
  if (path.startsWith("body.")) {
    return getNestedValue(ctx.body, path.slice(5).split("."));
  }
  if (path.startsWith("headers.")) {
    return ctx.headers[path.slice(8)];
  }
  return undefined;
}

function parseRhs(raw: string): unknown {
  const s = raw.trim();
  if (s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  const n = Number(s);
  if (!isNaN(n) && s !== "") return n;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

const OPS = ["!=", "==", ">=", "<=", ">", "<"] as const;

export function evaluateAssertion(assertion: string, ctx: TestContext): AssertionResult {
  for (const op of OPS) {
    const idx = assertion.indexOf(op);
    if (idx === -1) continue;

    const lhsPath = assertion.slice(0, idx).trim();
    const rhsRaw = assertion.slice(idx + op.length).trim();
    const leftVal = resolveLeft(lhsPath, ctx);
    const rightVal = parseRhs(rhsRaw);

    let passed = false;
    switch (op) {
      case "==": passed = leftVal == rightVal; break;
      case "!=": passed = leftVal != rightVal; break;
      case ">":  passed = (leftVal as number) > (rightVal as number); break;
      case "<":  passed = (leftVal as number) < (rightVal as number); break;
      case ">=": passed = (leftVal as number) >= (rightVal as number); break;
      case "<=": passed = (leftVal as number) <= (rightVal as number); break;
    }

    return {
      assertion,
      passed,
      detail: passed
        ? undefined
        : `Expected: ${lhsPath} ${op} ${JSON.stringify(rightVal)} — got: ${JSON.stringify(leftVal)}`,
    };
  }

  return { assertion, passed: false, detail: "Could not parse assertion" };
}

export function buildContext(
  status: number,
  bodyRaw: string,
  headers: Record<string, string>,
  durationMs: number,
): TestContext {
  let body: unknown = bodyRaw;
  try { body = JSON.parse(bodyRaw); } catch { /* keep raw string */ }
  return { status, body, headers, durationMs };
}
