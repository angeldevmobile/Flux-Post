#!/usr/bin/env node
/*
 * Uso real de Flux, leído de la telemetría propia.
 *
 *   SUPABASE_SERVICE_KEY=eyJ... npm run stats:app
 *   SUPABASE_SERVICE_KEY=eyJ... npm run stats:app -- --days 60
 *
 * Complementa `npm run stats`, que cuenta descargas de GitHub. Descargas y uso
 * son dos números distintos: la diferencia entre ambos es la gente que instaló
 * Flux y no volvió, que es justo lo que ninguna métrica de la landing ve.
 *
 * La service key NO se guarda en el repo. Está en el panel de Supabase, en
 * Project Settings → API → service_role. Da acceso total a la base de datos:
 * no la pegues en un script, no la subas, no la pases por chat.
 */

const PROJECT_URL = 'https://zmzfupygrhseljaxzyeb.supabase.co';

const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) {
  console.error('Falta SUPABASE_SERVICE_KEY.\n');
  console.error('  Supabase → Project Settings → API → service_role\n');
  console.error('  PowerShell:  $env:SUPABASE_SERVICE_KEY="eyJ..."; npm run stats:app');
  console.error('  bash:        SUPABASE_SERVICE_KEY=eyJ... npm run stats:app');
  process.exit(1);
}

const daysArg = process.argv.indexOf('--days');
const DAYS = daysArg !== -1 ? parseInt(process.argv[daysArg + 1], 10) || 30 : 30;

const since = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 10);

async function q(path) {
  const res = await fetch(`${PROJECT_URL}/rest/v1/${path}`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json();
}

function pad(s, n) { return String(s ?? '').padEnd(n); }
function padS(s, n) { return String(s ?? '').padStart(n); }

function bar(n, max, width = 24) {
  if (!max) return '';
  return '█'.repeat(Math.max(1, Math.round((n / max) * width)));
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
  console.log('─'.repeat(64));
}

(async function main() {
  let dau, updater, features, routes, firstSeen, crashes;
  try {
    [dau, updater, features, routes, firstSeen, crashes] = await Promise.all([
      q(`telemetry_dau?day=gte.${since}&order=day.desc`),
      q(`telemetry_updater_dau?day=gte.${since}&order=day.desc`),
      q(`telemetry_feature_use?day=gte.${since}`),
      q('telemetry_route_use'),
      q('telemetry_install_first_seen'),
      q(`telemetry_crashes?day=gte.${since}&order=occurrences.desc&limit=10`),
    ]);
  } catch (err) {
    console.error(err.message);
    console.error('\n¿Está aplicada la migración 20260905000000_telemetry_anon.sql?');
    process.exit(1);
  }

  console.log(`\n\x1b[1mFlux · uso real — últimos ${DAYS} días\x1b[0m`);

  // ── Usuarios activos ──
  section('Instalaciones activas por día');
  if (dau.length === 0 && updater.length === 0) {
    console.log('Sin datos todavía. Es lo esperable hasta que salga una release');
    console.log('con la telemetría nueva: los clientes v0.2.0 no la mandan.');
  } else {
    const rows = new Map();
    for (const r of dau) rows.set(r.day, { app: r.installs_app ?? 0, upd: 0 });
    for (const r of updater) {
      const e = rows.get(r.day) ?? { app: 0, upd: 0 };
      e.upd = r.visitors ?? 0;
      rows.set(r.day, e);
    }
    const sorted = [...rows.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 21);
    const max = Math.max(...sorted.map(([, v]) => Math.max(v.app, v.upd)), 1);

    console.log(`${pad('Día', 12)}${padS('app', 6)}${padS('updater', 9)}  gráfico (updater)`);
    for (const [day, v] of sorted) {
      console.log(`${pad(day, 12)}${padS(v.app, 6)}${padS(v.upd, 9)}  ${bar(v.upd, max)}`);
    }
    console.log('\napp     = instalaciones con telemetría aceptada (opt-in, infraestima).');
    console.log('updater = comprobaciones de actualización. Cobertura casi total,');
    console.log('          pero sin identificador: es un aproximado, no un censo.');
  }

  // ── Retención ──
  section('Retención');
  if (firstSeen.length === 0) {
    console.log('Sin instalaciones registradas todavía.');
  } else {
    const total = firstSeen.length;
    const returned = firstSeen.filter(i => i.active_days > 1).length;
    const stuck = firstSeen.filter(i => i.active_days >= 5).length;
    const oneAndDone = total - returned;

    console.log(`Instalaciones únicas vistas:        ${total}`);
    console.log(`Volvieron algún otro día:           ${returned}  (${((returned / total) * 100).toFixed(1)} %)`);
    console.log(`Activas 5 días o más:               ${stuck}  (${((stuck / total) * 100).toFixed(1)} %)`);
    console.log(`Abrieron una vez y no volvieron:    ${oneAndDone}  (${((oneAndDone / total) * 100).toFixed(1)} %)`);
    console.log('\nEl último número es la métrica que importa. Si es alto, el problema');
    console.log('no está en atraer gente a la landing: está en el primer uso.');

    const byPlatform = {};
    for (const i of firstSeen) {
      const p = i.platform ?? 'unknown';
      byPlatform[p] = (byPlatform[p] ?? 0) + 1;
    }
    console.log('\nPor plataforma:');
    for (const [p, n] of Object.entries(byPlatform).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${pad(p, 10)}${padS(n, 5)}`);
    }
  }

  // ── Features ──
  section('Qué se usa dentro de Flux');
  if (features.length === 0) {
    console.log('Sin eventos todavía.');
  } else {
    // Agregado sobre el periodo: la vista viene partida por día. `installs` se
    // toma como máximo diario, no como suma: sumar instalaciones distintas de
    // días distintos contaría varias veces a la misma persona.
    const agg = new Map();
    for (const r of features) {
      const e = agg.get(r.type) ?? { events: 0, installs: 0 };
      e.events += Number(r.events ?? 0);
      e.installs = Math.max(e.installs, Number(r.installs ?? 0));
      agg.set(r.type, e);
    }
    const sorted = [...agg.entries()].sort((a, b) => b[1].events - a[1].events);
    const max = Math.max(...sorted.map(([, v]) => v.events), 1);

    console.log(`${pad('Evento', 20)}${padS('eventos', 9)}${padS('instal.', 9)}  gráfico`);
    for (const [type, v] of sorted) {
      console.log(`${pad(type, 20)}${padS(v.events, 9)}${padS(v.installs, 9)}  ${bar(v.events, max, 18)}`);
    }
    console.log('\n"instal." es el número que vale: 400 eventos de una sola persona');
    console.log('no dicen que una feature funcione.');
  }

  // ── Secciones ──
  section('Qué secciones abre la gente');
  if (routes.length === 0) {
    console.log('Sin datos de navegación todavía.');
  } else {
    const max = Math.max(...routes.map(r => Number(r.installs ?? 0)), 1);
    console.log(`${pad('Sección', 16)}${padS('instal.', 9)}${padS('vistas', 9)}  gráfico`);
    for (const r of routes) {
      console.log(`${pad(r.route, 16)}${padS(r.installs, 9)}${padS(r.views, 9)}  ${bar(Number(r.installs), max, 18)}`);
    }
    console.log('\nLas secciones que nadie abre son candidatas a quitar, no a pulir.');
  }

  // ── Crashes ──
  section('Crashes más frecuentes');
  if (crashes.length === 0) {
    console.log('Ninguno registrado.');
  } else {
    for (const c of crashes) {
      console.log(`${padS(c.occurrences, 5)} ×  ${pad(c.app_version, 8)} ${String(c.message).replace(/\s+/g, ' ').slice(0, 70)}`);
    }
  }

  console.log('\nDescargas por release:  npm run stats');
  console.log('Visitas a la landing:   Google Analytics (G-ZCQF29NN2W)\n');
})();
