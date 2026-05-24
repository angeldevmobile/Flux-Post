export interface PreRequestMutations {
  headers: Record<string, string>;
  envVars: Record<string, string>;
}

export function runPreRequestScript(
  script: string,
  envVars: Record<string, string>
): PreRequestMutations {
  const mutations: PreRequestMutations = { headers: {}, envVars: {} };

  const pm = {
    environment: {
      get: (key: string): string => envVars[key] ?? "",
      set: (key: string, value: unknown) => {
        mutations.envVars[key] = String(value);
      },
    },
    request: {
      headers: {
        upsert: (key: string, value: unknown) => {
          mutations.headers[key] = String(value);
        },
        add: (key: string, value: unknown) => {
          mutations.headers[key] = String(value);
        },
      },
    },
  };

  // eslint-disable-next-line no-new-func
  const fn = new Function("pm", script);
  fn(pm);

  return mutations;
}
