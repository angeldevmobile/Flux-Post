// El entorno de tests es node, pero varios módulos de la app importan el store
// de settings, que lee `localStorage` al construirse. Sin este stub, cualquier
// test que roce el store falla con "localStorage is not defined".
const store = new Map<string, string>();

const localStorageStub: Storage = {
  get length() { return store.size; },
  clear: () => store.clear(),
  getItem: (k) => store.get(k) ?? null,
  key: (i) => [...store.keys()][i] ?? null,
  removeItem: (k) => { store.delete(k); },
  setItem: (k, v) => { store.set(k, String(v)); },
};

globalThis.localStorage = localStorageStub;
