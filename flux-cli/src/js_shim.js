// Shim de `pm` para el runner del CLI. Replica la superficie de
// src/lib/preRequest.ts en la app: si diverge, el mismo script pasaria en un
// sitio y fallaria en el otro, que es justo lo que este runner viene a evitar.
(function () {
  var ctx = globalThis.__flux;
  var out = ctx.out;

  function assert(pass, msg) { if (!pass) throw new Error(msg); }

  function makeExpect(value) {
    var a = {};
    a.equal = function (e) {
      assert(value === e, "Expected " + JSON.stringify(value) + " to equal " + JSON.stringify(e));
      return a;
    };
    a.eql = function (e) {
      assert(JSON.stringify(value) === JSON.stringify(e), "Expected deep equal");
      return a;
    };
    a.include = function (n) {
      if (typeof value === "string") assert(value.indexOf(String(n)) !== -1, 'Expected "' + value + '" to include "' + n + '"');
      else if (Array.isArray(value)) assert(value.indexOf(n) !== -1, "Expected array to include " + n);
      return a;
    };
    a.be = {
      a: function (t) { assert(typeof value === t, "Expected " + typeof value + " to be " + t); return a; },
      an: function (t) { assert(typeof value === t, "Expected " + typeof value + " to be " + t); return a; },
      ok: function () { assert(!!value, "Expected " + value + " to be truthy"); return a; },
      null: function () { assert(value === null, "Expected " + value + " to be null"); return a; },
      undefined: function () { assert(value === undefined, "Expected " + value + " to be undefined"); return a; },
      above: function (n) { assert(Number(value) > n, "Expected " + value + " > " + n); return a; },
      below: function (n) { assert(Number(value) < n, "Expected " + value + " < " + n); return a; },
      least: function (n) { assert(Number(value) >= n, "Expected " + value + " >= " + n); return a; },
      most: function (n) { assert(Number(value) <= n, "Expected " + value + " <= " + n); return a; },
    };
    a.have = {
      status: function (c) { assert(value === c, "Expected status " + value + " to equal " + c); return a; },
      property: function (k) { assert(value != null && k in Object(value), 'Expected object to have property "' + k + '"'); return a; },
      lengthOf: function (n) { assert(value.length === n, "Expected length " + value.length + " to equal " + n); return a; },
    };
    a.not = {
      equal: function (e) { assert(value !== e, "Expected " + value + " to not equal " + e); return a; },
      include: function (n) {
        if (typeof value === "string") assert(value.indexOf(String(n)) === -1, 'Expected string to not include "' + n + '"');
        return a;
      },
      be: {
        null: function () { assert(value !== null, "Expected value to not be null"); return a; },
        undefined: function () { assert(value !== undefined, "Expected value to not be undefined"); return a; },
      },
    };
    return { to: a };
  }

  var envStore = {
    get: function (k) { return ctx.env[k] !== undefined ? ctx.env[k] : ""; },
    set: function (k, v) { out.env[k] = String(v); ctx.env[k] = String(v); },
  };

  var pm = {
    environment: envStore,
    variables: envStore,
    request: {
      headers: {
        upsert: function (k, v) { out.headers[k] = String(v); },
        add: function (k, v) { out.headers[k] = String(v); },
      },
    },
  };

  if (ctx.response) {
    var parsed = null;
    var parseFailed = false;
    pm.response = {
      status: ctx.response.status,
      code: ctx.response.status,
      responseTime: ctx.response.durationMs,
      text: function () { return ctx.response.body; },
      json: function () {
        if (parsed === null && !parseFailed) {
          try { parsed = JSON.parse(ctx.response.body); } catch (e) { parseFailed = true; }
        }
        return parsed;
      },
      to: makeExpect(ctx.response.status).to,
      headers: {
        get: function (k) {
          var v = ctx.response.headers[String(k).toLowerCase()];
          return v === undefined ? null : v;
        },
        toObject: function () { return ctx.response.headers; },
      },
    };
    pm.test = function (name, fn) {
      try { fn(); out.tests.push({ name: name, passed: true, error: null }); }
      catch (e) { out.tests.push({ name: name, passed: false, error: String((e && e.message) || e) }); }
    };
  }

  pm.expect = makeExpect;

  globalThis.pm = pm;
  globalThis.console = {
    log: function () { out.logs.push(Array.prototype.join.call(arguments, " ")); },
    info: function () { out.logs.push(Array.prototype.join.call(arguments, " ")); },
    warn: function () { out.logs.push(Array.prototype.join.call(arguments, " ")); },
    error: function () { out.logs.push(Array.prototype.join.call(arguments, " ")); },
  };
})();
