import { useConsoleStore } from "@/stores/console";
import type { LogSource } from "@/stores/console";
import type { TestResult } from "@/stores/testResults";

export interface PreRequestMutations {
  headers: Record<string, string>;
  envVars: Record<string, string>;
}

export interface PostResponseMutations {
  envVars: Record<string, string>;
  testResults: TestResult[];
}

function makeConsole(source: LogSource) {
  const { push } = useConsoleStore.getState();
  return {
    log: (...args: unknown[]) => push("log", args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" "), source),
    info: (...args: unknown[]) => push("info", args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" "), source),
    warn: (...args: unknown[]) => push("warn", args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" "), source),
    error: (...args: unknown[]) => push("error", args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" "), source),
  };
}

export function runPreRequestScript(
  script: string,
  envVars: Record<string, string>
): PreRequestMutations {
  const mutations: PreRequestMutations = { headers: {}, envVars: {} };

  const pm = {
    environment: {
      get: (key: string): string => envVars[key] ?? "",
      set: (key: string, value: unknown) => { mutations.envVars[key] = String(value); },
    },
    request: {
      headers: {
        upsert: (key: string, value: unknown) => { mutations.headers[key] = String(value); },
        add: (key: string, value: unknown) => { mutations.headers[key] = String(value); },
      },
    },
    variables: {
      get: (key: string): string => envVars[key] ?? "",
      set: (key: string, value: unknown) => { mutations.envVars[key] = String(value); },
    },
  };

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("pm", "console", script);
    fn(pm, makeConsole("pre-request"));
  } catch (e) {
    useConsoleStore.getState().push("error", String(e), "pre-request");
  }

  return mutations;
}

function makeExpect(value: unknown) {
  const chain = {
    to: null as unknown,
  };

  function assert(pass: boolean, msg: string) {
    if (!pass) throw new Error(msg);
  }

  const assertions = {
    equal: (expected: unknown) => { assert(value === expected, `Expected ${JSON.stringify(value)} to equal ${JSON.stringify(expected)}`); return assertions; },
    eql: (expected: unknown) => { assert(JSON.stringify(value) === JSON.stringify(expected), `Expected deep equal`); return assertions; },
    include: (needle: unknown) => {
      if (typeof value === "string") assert(value.includes(String(needle)), `Expected "${value}" to include "${needle}"`);
      else if (Array.isArray(value)) assert(value.includes(needle), `Expected array to include ${needle}`);
      return assertions;
    },
    be: {
      a: (type: string) => { assert(typeof value === type, `Expected ${typeof value} to be ${type}`); return assertions; },
      an: (type: string) => { assert(typeof value === type, `Expected ${typeof value} to be ${type}`); return assertions; },
      ok: () => { assert(!!value, `Expected ${value} to be truthy`); return assertions; },
      null: () => { assert(value === null, `Expected ${value} to be null`); return assertions; },
      undefined: () => { assert(value === undefined, `Expected ${value} to be undefined`); return assertions; },
      above: (n: number) => { assert(Number(value) > n, `Expected ${value} > ${n}`); return assertions; },
      below: (n: number) => { assert(Number(value) < n, `Expected ${value} < ${n}`); return assertions; },
      least: (n: number) => { assert(Number(value) >= n, `Expected ${value} >= ${n}`); return assertions; },
      most: (n: number) => { assert(Number(value) <= n, `Expected ${value} <= ${n}`); return assertions; },
    },
    have: {
      status: (code: number) => { assert(value === code, `Expected status ${value} to equal ${code}`); return assertions; },
      property: (key: string) => { assert(key in (value as object), `Expected object to have property "${key}"`); return assertions; },
      lengthOf: (n: number) => { assert((value as unknown[]).length === n, `Expected length ${(value as unknown[]).length} to equal ${n}`); return assertions; },
    },
    not: {
      equal: (expected: unknown) => { assert(value !== expected, `Expected ${value} to not equal ${expected}`); return assertions; },
      include: (needle: unknown) => {
        if (typeof value === "string") assert(!value.includes(String(needle)), `Expected string to not include "${needle}"`);
        return assertions;
      },
      be: {
        null: () => { assert(value !== null, `Expected value to not be null`); return assertions; },
        undefined: () => { assert(value !== undefined, `Expected value to not be undefined`); return assertions; },
      },
    },
  };

  chain.to = assertions;
  return chain;
}

export function runPostResponseScript(
  script: string,
  response: { status: number; body: string; headers: Record<string, string>; durationMs: number },
  envVars: Record<string, string>
): PostResponseMutations {
  const testResults: TestResult[] = [];
  const mutations: PostResponseMutations = { envVars: {}, testResults };

  let json: unknown = null;
  try { json = JSON.parse(response.body); } catch { /* non-JSON */ }

  const pm = {
    test: (name: string, fn: () => void) => {
      try {
        fn();
        testResults.push({ name, pass: true });
      } catch (e) {
        testResults.push({ name, pass: false, error: String(e instanceof Error ? e.message : e) });
      }
    },
    expect: (value: unknown) => makeExpect(value),
    response: {
      status: response.status,
      text: () => response.body,
      json: () => json,
      to: makeExpect(response.status).to,
      headers: {
        get: (key: string) => response.headers[key.toLowerCase()] ?? null,
        toObject: () => response.headers,
      },
      responseTime: response.durationMs,
    },
    environment: {
      get: (key: string): string => envVars[key] ?? "",
      set: (key: string, value: unknown) => { mutations.envVars[key] = String(value); },
    },
    variables: {
      get: (key: string): string => envVars[key] ?? "",
      set: (key: string, value: unknown) => { mutations.envVars[key] = String(value); },
    },
  };

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("pm", "console", script);
    fn(pm, makeConsole("post-response"));
  } catch (e) {
    useConsoleStore.getState().push("error", String(e), "post-response");
  }

  return mutations;
}
