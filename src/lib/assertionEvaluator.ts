export interface AssertionResult {
  expr: string;
  pass: boolean;
  message: string;
}

interface Ctx {
  status: number;
  body: string;
  headers: Record<string, string>;
  json: unknown;
}

function jsonPath(obj: unknown, path: string): unknown {
  for (const key of path.split(".")) {
    if (obj == null || typeof obj !== "object") return undefined;
    obj = (obj as Record<string, unknown>)[key];
  }
  return obj;
}

function coerce(v: string): unknown {
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  const n = Number(v);
  if (!isNaN(n)) return n;
  return v.replace(/^['"]|['"]$/g, "");
}

export function evaluateAssertion(expr: string, ctx: Ctx): AssertionResult {
  const e = expr.trim();

  try {
    // status == 200 | status === 200 | status < 300 | status >= 200
    const statusOp = e.match(/^status\s*(===?|!==?|<=?|>=?)\s*(\d+)$/i);
    if (statusOp) {
      const op = statusOp[1];
      const val = parseInt(statusOp[2]);
      const pass =
        op === "==" || op === "===" ? ctx.status === val :
        op === "!=" || op === "!==" ? ctx.status !== val :
        op === "<"  ? ctx.status < val :
        op === "<=" ? ctx.status <= val :
        op === ">"  ? ctx.status > val :
        op === ">=" ? ctx.status >= val : false;
      return { expr: e, pass, message: pass ? `status ${ctx.status} ${op} ${val}` : `status ${ctx.status} expected ${op} ${val}` };
    }

    // body contains "text"
    const bodyContains = e.match(/^body\s+contains\s+['"](.+)['"]/i);
    if (bodyContains) {
      const needle = bodyContains[1];
      const pass = ctx.body.includes(needle);
      return { expr: e, pass, message: pass ? `body contains "${needle}"` : `body does not contain "${needle}"` };
    }

    // json.path == value | json.path contains "text"
    const jsonEq = e.match(/^json\.([a-zA-Z0-9_.]+)\s*(===?|!==?|<=?|>=?)\s*(.+)$/);
    if (jsonEq) {
      const actual = jsonPath(ctx.json, jsonEq[1]);
      const op = jsonEq[2];
      const expected = coerce(jsonEq[3].trim());
      const pass =
        op === "==" || op === "===" ? actual === expected :
        op === "!=" || op === "!==" ? actual !== expected :
        op === "<"  ? Number(actual) < Number(expected) :
        op === "<=" ? Number(actual) <= Number(expected) :
        op === ">"  ? Number(actual) > Number(expected) :
        op === ">=" ? Number(actual) >= Number(expected) : false;
      return { expr: e, pass, message: pass ? `json.${jsonEq[1]} ${op} ${expected}` : `json.${jsonEq[1]} is ${JSON.stringify(actual)}, expected ${op} ${expected}` };
    }

    const jsonContains = e.match(/^json\.([a-zA-Z0-9_.]+)\s+contains\s+['"](.+)['"]/i);
    if (jsonContains) {
      const actual = String(jsonPath(ctx.json, jsonContains[1]) ?? "");
      const needle = jsonContains[2];
      const pass = actual.includes(needle);
      return { expr: e, pass, message: pass ? `json.${jsonContains[1]} contains "${needle}"` : `json.${jsonContains[1]} ("${actual}") does not contain "${needle}"` };
    }

    // json.path != null | json.path == null
    const jsonNull = e.match(/^json\.([a-zA-Z0-9_.]+)\s*(===?|!==?)\s*null$/i);
    if (jsonNull) {
      const actual = jsonPath(ctx.json, jsonNull[1]);
      const pass = jsonNull[2].startsWith("!") ? actual !== null && actual !== undefined : actual === null || actual === undefined;
      return { expr: e, pass, message: pass ? e : `json.${jsonNull[1]} is ${JSON.stringify(actual)}` };
    }

    // headers["key"] == "value"
    const headerEq = e.match(/^headers\[['"](.+)['"]\]\s*(===?|!==?)\s*['"](.+)['"]/i);
    if (headerEq) {
      const actual = ctx.headers[headerEq[1].toLowerCase()] ?? "";
      const op = headerEq[2];
      const expected = headerEq[3];
      const pass = op.startsWith("!") ? actual !== expected : actual === expected;
      return { expr: e, pass, message: pass ? e : `header "${headerEq[1]}" is "${actual}", expected "${expected}"` };
    }

    return { expr: e, pass: false, message: `Unknown assertion format: ${e}` };
  } catch (err) {
    return { expr: e, pass: false, message: `Error: ${String(err)}` };
  }
}

export function evaluateAssertions(asserts: string[], status: number, body: string, headers: Record<string, string>): AssertionResult[] {
  let json: unknown = null;
  try { json = JSON.parse(body); } catch { /* non-JSON body */ }
  const ctx = { status, body, headers, json };
  return asserts.map(a => evaluateAssertion(a, ctx));
}
