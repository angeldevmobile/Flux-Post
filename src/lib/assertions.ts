/**
 * The one assertion engine. The collection runner, the Tests screen and the CLI
 * all evaluate through this (the CLI via a port kept in step by a shared test
 * table), so an assertion means the same thing wherever it runs.
 */

export interface AssertionContext {
  status: number;
  /** Raw response body, used by `body contains`. */
  body: string;
  /** Parsed body, or undefined when the response was not JSON. */
  json: unknown;
  /** Header names lowercased. */
  headers: Record<string, string>;
  durationMs: number;
}

export interface AssertionOutcome {
  assertion: string;
  passed: boolean;
  /** Why it failed. Absent when it passed. */
  detail?: string;
}

/** `present: false` means the path was valid but the field was not in the response. */
type Resolution =
  | { ok: true; value: unknown; present: boolean }
  | { ok: false; reason: string };

const ROOTS = "status, duration, body, json or headers";

function walk(obj: unknown, parts: string[]): { value: unknown; present: boolean } {
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      return { value: undefined, present: false };
    }
    const rec = cur as Record<string, unknown>;
    if (!(part in rec)) return { value: undefined, present: false };
    cur = rec[part];
  }
  return { value: cur, present: true };
}

/**
 * An unknown root resolves to an error rather than null. Returning null made
 * `whatever.path == null` pass against any response, so a typo in an assertion
 * turned into a green test.
 */
export function resolvePath(path: string, ctx: AssertionContext): Resolution {
  const p = path.trim();

  if (p === "status") return { ok: true, value: ctx.status, present: true };
  if (p === "duration") return { ok: true, value: ctx.durationMs, present: true };
  if (p === "body" || p === "json") return { ok: true, value: ctx.json ?? ctx.body, present: true };

  // `headers["Content-Type"]` and `headers.content-type` are the same lookup.
  const bracket = p.match(/^headers\[\s*['"](.+?)['"]\s*\]$/i);
  const dotted = p.match(/^headers\.(.+)$/i);
  const headerName = bracket?.[1] ?? dotted?.[1];
  if (headerName !== undefined) {
    const key = headerName.trim().toLowerCase();
    const present = key in ctx.headers;
    return { ok: true, value: present ? ctx.headers[key] : undefined, present };
  }

  // `json.` is the collection runner's spelling, `body.` the Tests screen's.
  const nested = p.match(/^(?:body|json)\.(.+)$/);
  if (nested) {
    if (ctx.json === undefined || ctx.json === null) {
      return { ok: false, reason: "response body is not JSON" };
    }
    return { ok: true, ...walk(ctx.json, nested[1].split(".")) };
  }

  return { ok: false, reason: `unknown path '${p}', expected ${ROOTS}` };
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === typeof b) return a === b;
  // A JSON string "5" and the literal 5 are the same value for our purposes.
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  return String(a) === String(b);
}

function parseLiteral(raw: string): unknown {
  const s = raw.trim();
  if (s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s !== "" && !Number.isNaN(Number(s))) return Number(s);
  return s;
}

const OPERATORS = ["===", "!==", "==", "!=", ">=", "<=", ">", "<"];

/** Scans left to right, preferring the longest operator at each position. */
function splitOperator(expr: string) {
  for (let i = 0; i < expr.length; i++) {
    for (const op of OPERATORS) {
      if (expr.startsWith(op, i)) {
        return { lhs: expr.slice(0, i).trim(), op, rhs: expr.slice(i + op.length).trim() };
      }
    }
  }
  return null;
}

const show = (v: unknown) => (v === undefined ? "absent" : JSON.stringify(v));

export function evaluate(assertion: string, ctx: AssertionContext): AssertionOutcome {
  const expr = assertion.trim();
  const fail = (detail: string): AssertionOutcome => ({ assertion: expr, passed: false, detail });

  if (!expr) return fail("empty assertion");

  // `<path> contains "text"`: checked first, it has no operator to split on.
  const contains = expr.match(/^(.+?)\s+contains\s+(.+)$/i);
  if (contains) {
    const target = resolvePath(contains[1], ctx);
    if (!target.ok) return fail(target.reason);
    const needle = String(parseLiteral(contains[2]));
    if (!target.present) return fail(`${contains[1].trim()} is absent`);
    const haystack = typeof target.value === "string" ? target.value : JSON.stringify(target.value);
    return haystack.includes(needle)
      ? { assertion: expr, passed: true }
      : fail(`${show(haystack)} does not contain ${JSON.stringify(needle)}`);
  }

  const split = splitOperator(expr);
  if (!split) return fail("could not parse assertion: expected an operator or 'contains'");

  const { lhs, op, rhs } = split;
  const left = resolvePath(lhs, ctx);
  if (!left.ok) return fail(left.reason);

  const expected = parseLiteral(rhs);
  const actual = left.present ? left.value : undefined;

  if (op === "==" || op === "===" || op === "!=" || op === "!==") {
    const equal = looseEquals(actual, expected);
    const passed = op.startsWith("!") ? !equal : equal;
    return passed
      ? { assertion: expr, passed: true }
      : fail(`expected ${lhs} ${op} ${show(expected)}, got ${show(actual)}`);
  }

  const a = Number(actual);
  const b = Number(expected);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return fail(`cannot compare ${show(actual)} ${op} ${show(expected)} numerically`);
  }
  const passed =
    op === ">" ? a > b :
    op === "<" ? a < b :
    op === ">=" ? a >= b :
    a <= b;

  return passed
    ? { assertion: expr, passed: true }
    : fail(`expected ${lhs} ${op} ${show(expected)}, got ${show(actual)}`);
}

export function buildAssertionContext(
  status: number,
  bodyRaw: string,
  headers: Record<string, string>,
  durationMs: number,
): AssertionContext {
  let json: unknown;
  try { json = JSON.parse(bodyRaw); } catch { json = undefined; }
  const lowered: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  return { status, body: bodyRaw, json, headers: lowered, durationMs };
}
