#!/usr/bin/env node
// ui-gate.mjs — Web UI Acceptance Gate runner (spec 2026-11-27-03).
// Gates: G0 FRESH-BUILD, G1 FRESH-SERVER, G2 RUNTIME-CLEAN, G3 LAYOUT-INVARIANTS,
//        G4 VISUAL-DIFF, G5 FLOWS, G6 EVIDENCE (.ui-gate/result.json bound to the tree hash).
// Usage (from the repo root or with --repo):
//   node ui-gate.mjs                 full run; exit 0 only when every gate passes
//   node ui-gate.mjs --check --json  validate .ui-gate/result.json against the current tree (hooks)
//   node ui-gate.mjs --lock-intent   lock .ui-gate/intent.json before changing code
//   node ui-gate.mjs --accept <page> update the baseline of an intended page (after reviewing images)
//   node ui-gate.mjs --init-baseline create missing baselines (only with the user's OK)
//   node ui-gate.mjs --init-project  write tests/ui-gate/gate-fixture.mjs for flow files
//   node ui-gate.mjs --only G3,G5    debug run; the result is never valid
//   node ui-gate.mjs --all-flows     also run flows of features with no changed file
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION = '1.0.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5'];
const DEFAULT_VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
];

// ---------- small utilities ----------
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tryGit = (repo, args) => { try { return git(repo, args); } catch { return null; } };
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJSON = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); };
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 2 : 1; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += /[.+^${}()|[\]\\]/.test(c) ? '\\' + c : c;
  }
  return new RegExp('^' + re + '$');
}
const matchAny = (file, globs) => globs.some((g) => globToRegExp(g).test(file));

function parseArgs(argv) {
  const a = { repo: process.cwd(), only: null, accept: null, base: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--repo') a.repo = argv[++i];
    else if (k === '--only') a.only = argv[++i].split(',').map((s) => s.trim().toUpperCase());
    else if (k === '--accept') a.accept = argv[++i];
    else if (k === '--base') a.base = argv[++i];
    else if (k.startsWith('--')) a[k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
  }
  a.repo = path.resolve(a.repo);
  return a;
}

// ---------- config ----------
export function loadConfig(repo) {
  const file = path.join(repo, '.ui-gate.json');
  if (!fs.existsSync(file)) return { config: null, errors: [] };
  const c = readJSON(file);
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  need(Array.isArray(c.watch) && c.watch.length, 'watch: non-empty glob list required');
  need(c.build?.command && c.build?.outDir, 'build.command and build.outDir required');
  need(c.serve?.command && c.serve?.readyPath, 'serve.command and serve.readyPath required');
  need(Array.isArray(c.pages) && c.pages.length, 'pages: at least one page required');
  for (const p of c.pages || []) need(p.name && p.path && p.ready, `page needs name, path, ready: ${JSON.stringify(p)}`);
  need(Array.isArray(c.features), 'features: list required (may be empty only if nothing is watched)');
  for (const f of c.features || []) need(f.name && f.paths?.length && f.flows?.length, `feature needs name, paths, flows: ${f.name}`);
  for (const key of ['allowConsole', 'allowRequests', 'layoutIgnore']) {
    for (const x of c[key] || []) need(typeof x.reason === 'string' && x.reason.trim(), `${key} entry without reason: ${JSON.stringify(x)}`);
  }
  c.baselineDir = c.baselineDir || 'tests/ui-baseline';
  c.viewports = [...DEFAULT_VIEWPORTS, ...(c.viewports || [])];
  c.visual = { maxDiffPixelRatio: 0.001, threshold: 0.2, ...(c.visual || {}) };
  c.mask = c.mask || [];
  return { config: c, errors };
}

// ---------- tree identity and change detection ----------
function defaultBranch(repo) {
  const ref = tryGit(repo, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  return ref ? ref.trim().replace('refs/remotes/origin/', '') : 'main';
}
export function baseRef(repo, override) {
  if (override) return override;
  const def = defaultBranch(repo);
  const mb = tryGit(repo, ['merge-base', 'HEAD', `origin/${def}`]);
  return mb ? mb.trim() : 'HEAD';
}
export function changedWatched(repo, cfg, base) {
  const diff = (tryGit(repo, ['diff', '--name-only', base]) || '').split('\n');
  const untracked = (tryGit(repo, ['ls-files', '-o', '--exclude-standard']) || '').split('\n');
  return [...new Set([...diff, ...untracked].filter(Boolean))].filter((f) => matchAny(f, cfg.watch)).sort();
}
export function uncommittedWatched(repo, cfg) {
  const lines = (tryGit(repo, ['status', '--porcelain', '--untracked-files=all']) || '').split('\n').filter(Boolean);
  return lines.map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()).filter((f) => matchAny(f, cfg.watch));
}
export function treeHash(repo, cfg) {
  const listed = (tryGit(repo, ['ls-files', '-co', '--exclude-standard']) || '').split('\n').filter(Boolean);
  const flows = new Set((cfg.features || []).flatMap((f) => f.flows));
  const keep = listed.filter((f) => matchAny(f, cfg.watch) || f === '.ui-gate.json' || f.startsWith(cfg.baselineDir + '/')
    || f.startsWith('tests/ui-gate/') || flows.has(f));
  if (fs.existsSync(path.join(repo, '.ui-gate/intent.json'))) keep.push('.ui-gate/intent.json');
  const lines = [...new Set(keep)].sort().map((f) => {
    const p = path.join(repo, f);
    return `${f}\0${fs.existsSync(p) ? sha256(fs.readFileSync(p)) : 'deleted'}`;
  });
  return sha256(lines.join('\n'));
}

// ---------- check mode (used by hooks) ----------
export function check(repo, opts = {}) {
  const { config, errors } = loadConfig(repo);
  if (!config) return { gated: false, triggered: false, valid: true, reason: 'no .ui-gate.json' };
  if (errors.length) return { gated: true, triggered: true, valid: false, reason: 'config errors', failing: ['CONFIG'], violations: errors };
  const changed = changedWatched(repo, config, baseRef(repo, opts.base));
  if (!changed.length) return { gated: true, triggered: false, valid: true, reason: 'no watched change vs base' };
  const rerun = `node ${path.join(HERE, 'ui-gate.mjs')} --repo ${repo}`;
  if (opts.requireCommitted) {
    const dirty = uncommittedWatched(repo, config);
    if (dirty.length) return { gated: true, triggered: true, valid: false, reason: 'watched files not committed', failing: ['G6'], violations: dirty.slice(0, 10), rerun };
  }
  const resPath = path.join(repo, '.ui-gate/result.json');
  if (!fs.existsSync(resPath)) return { gated: true, triggered: true, valid: false, reason: 'no gate result yet', failing: ['G6'], changed: changed.slice(0, 10), rerun };
  const res = readJSON(resPath);
  const now = treeHash(repo, config);
  const failing = GATES.filter((g) => res.gates?.[g]?.status !== 'pass');
  const violations = failing.flatMap((g) => (res.gates?.[g]?.violations || []).map((v) => ({ gate: g, ...v }))).slice(0, 10);
  if (res.partial) return { gated: true, triggered: true, valid: false, reason: 'last run was partial (--only); run the full gate', failing: failing.length ? failing : ['G6'], violations, rerun, reportDir: res.reportDir };
  if (res.treeHash !== now) return { gated: true, triggered: true, valid: false, reason: 'result is stale: files changed after the last gate run', failing: ['G6'], violations, rerun, reportDir: res.reportDir };
  if (failing.length) return { gated: true, triggered: true, valid: false, reason: 'gates failing', failing, violations, rerun, reportDir: res.reportDir };
  return { gated: true, triggered: true, valid: true, reason: 'valid result for current tree', reportDir: res.reportDir };
}

// ---------- process helpers ----------
function sh(cmd, { cwd, env, timeoutMs, logFile }) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', cmd], { cwd, env: { ...process.env, ...env }, detached: true });
    const log = logFile ? fs.createWriteStream(logFile, { flags: 'a' }) : null;
    let tail = '';
    const onData = (d) => { log?.write(d); tail = (tail + d.toString()).slice(-4000); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} resolve({ code: 'timeout', tail }); }, timeoutMs);
    child.on('exit', (code) => { clearTimeout(timer); log?.end(); resolve({ code, tail }); });
  });
}
function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}
async function answers(url) { try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); return r.status; } catch { return 0; } }

// ---------- full run ----------
async function run(args) {
  const repo = args.repo;
  const { config: cfg, errors } = loadConfig(repo);
  if (!cfg) { console.log('No .ui-gate.json in', repo, '— nothing to gate.'); return 0; }
  if (errors.length) { console.log('[UI GATE] config errors:\n  ' + errors.join('\n  ')); return 1; }
  if (tryGit(repo, ['check-ignore', '-q', '.ui-gate/result.json']) === null) {
    console.log('[UI GATE] add ".ui-gate/" to .gitignore first.'); return 1;
  }
  const started = new Date();
  const env = { load1: Number(os.loadavg()[0].toFixed(1)), cpus: os.cpus().length };
  if (env.load1 > env.cpus * 3) console.log(`[UI GATE] warning: machine load ${env.load1} on ${env.cpus} CPUs; timeouts may follow. Prefer rerunning when idle.`);
  const reportDir = path.join(repo, '.ui-gate/report', stamp());
  const runDir = path.join(repo, '.ui-gate/run');
  fs.rmSync(runDir, { recursive: true, force: true }); // runner-owned scratch only
  fs.mkdirSync(reportDir, { recursive: true });
  fs.mkdirSync(path.join(runDir, 'out/pages'), { recursive: true });
  fs.mkdirSync(path.join(runDir, 'out/flows'), { recursive: true });
  const gates = Object.fromEntries(GATES.map((g) => [g, { status: 'pending', violations: [] }]));
  const only = args.only ? new Set(args.only) : null;
  const want = (g) => !only || only.has(g);
  const fail = (g, v) => { gates[g].status = 'fail'; gates[g].violations.push(...[].concat(v)); };
  const base = baseRef(repo, args.base);
  const changed = changedWatched(repo, cfg, base);
  let server = null;
  let stateDir = null;
  try {
    // G0 FRESH-BUILD: move the old output aside so everything in outDir comes from this build.
    const outDir = path.join(repo, cfg.build.outDir);
    if (fs.existsSync(outDir)) fs.renameSync(outDir, path.join(runDir, 'previous-out'));
    const b = await sh(cfg.build.command, { cwd: repo, timeoutMs: 300_000, logFile: path.join(reportDir, 'build.log') });
    const outFiles = fs.existsSync(outDir) ? fs.readdirSync(outDir, { recursive: true }) : [];
    if (b.code !== 0) fail('G0', { rule: 'build', detail: `exit ${b.code}: ${b.tail.slice(-600)}` });
    else if (!outFiles.length) fail('G0', { rule: 'build', detail: `${cfg.build.outDir} is empty after the build` });
    else gates.G0.status = 'pass';
    if (gates.G0.status !== 'pass') throw new Error('stop');

    // G1 FRESH-SERVER: own process on a free port, never a reused server.
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    if (await answers(origin + cfg.serve.readyPath)) { fail('G1', { rule: 'port', detail: `port ${port} already answers` }); throw new Error('stop'); }
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-gate-state-'));
    const serveEnv = { PORT: String(port), STATE_DIR: stateDir };
    for (const cmd of cfg.serve.prepare || []) {
      const p = await sh(cmd, { cwd: repo, env: serveEnv, timeoutMs: 180_000, logFile: path.join(reportDir, 'prepare.log') });
      if (p.code !== 0) { fail('G1', { rule: 'prepare', detail: `${cmd}: exit ${p.code}: ${p.tail.slice(-400)}` }); throw new Error('stop'); }
    }
    server = spawn('/bin/sh', ['-c', cfg.serve.command], { cwd: repo, env: { ...process.env, ...serveEnv }, detached: true, stdio: ['ignore', fs.openSync(path.join(reportDir, 'server.log'), 'a'), fs.openSync(path.join(reportDir, 'server.log'), 'a')] });
    const deadline = Date.now() + 60_000;
    let status = 0;
    while (Date.now() < deadline && server.exitCode === null) { status = await answers(origin + cfg.serve.readyPath); if (status === 200) break; await new Promise((r) => setTimeout(r, 500)); }
    if (status !== 200) { fail('G1', { rule: 'ready', detail: `GET ${cfg.serve.readyPath} → ${status || 'no answer'} within 60 s (see server.log)` }); throw new Error('stop'); }
    gates.G1.status = 'pass';

    // Runtime config shared with the browser-side specs.
    const routesDir = path.join(runDir, 'routes');
    fs.mkdirSync(routesDir, { recursive: true });
    const resolveRoutes = async (list, prefix) => Promise.all((list || []).map(async (r, i) => {
      let body;
      if (r.file) body = fs.readFileSync(path.join(repo, r.file), 'utf8');
      else {
        const mod = await import(pathToFileURL(path.join(repo, r.module)).href);
        const v = mod[r.export || 'default'];
        body = JSON.stringify(typeof v === 'function' ? await v(cfg.clock) : v);
      }
      const bodyPath = path.join(routesDir, `${prefix}-${i}.json`);
      fs.writeFileSync(bodyPath, body);
      return { url: r.url, status: r.status || 200, bodyPath };
    }));
    const globalRoutes = await resolveRoutes(cfg.routes, 'global');
    const pages = [];
    for (const p of cfg.pages) pages.push({ ...p, routes: [...globalRoutes, ...(await resolveRoutes(p.routes, 'page-' + p.name))] });
    const intent = readIntent(repo);
    const rt = {
      origin, clock: cfg.clock || null, pages, mask: cfg.mask, allowConsole: cfg.allowConsole || [], allowRequests: cfg.allowRequests || [],
      layoutIgnore: cfg.layoutIgnore || [], minTarget: cfg.minTarget || 44, helperPath: path.join(HERE, 'gate-browser.mjs'),
      outDir: path.join(runDir, 'out'), skipVisual: !want('G4'),
    };
    const rtPath = path.join(runDir, 'runtime.json');
    writeJSON(rtPath, rt);

    // G5 static coverage and flow-file checks (before running anything in the browser).
    const matched = new Set();
    for (const f of changed) {
      const feats = cfg.features.filter((ft) => matchAny(f, ft.paths));
      if (!feats.length) fail('G5', { rule: 'coverage', target: f, detail: 'unmapped change: add this file to a feature (with a flow) in .ui-gate.json' });
      feats.forEach((ft) => matched.add(ft.name));
    }
    if (args.allFlows) cfg.features.forEach((ft) => matched.add(ft.name)); // setup/regression: every flow
    const flowFiles = [...new Set(cfg.features.filter((ft) => matched.has(ft.name)).flatMap((ft) => ft.flows))];
    for (const ft of cfg.features.filter((x) => matched.has(x.name))) {
      for (const fl of ft.flows) {
        const p = path.join(repo, fl);
        if (!fs.existsSync(p)) { fail('G5', { rule: 'flow-missing', target: fl, detail: `feature ${ft.name}` }); continue; }
        const src = fs.readFileSync(p, 'utf8');
        if (!/tests\/ui-gate\/gate-fixture|\.\/gate-fixture|ui-gate\/gate-fixture/.test(src)) fail('G5', { rule: 'flow-fixture', target: fl, detail: "import { test, expect } from the repo's tests/ui-gate/gate-fixture.mjs" });
        if (!/\.(click|fill|press|check|selectOption|setInputFiles|tap|dragTo)\(/.test(src)) fail('G5', { rule: 'flow-no-action', target: fl, detail: 'flow must operate the UI (click/fill/press/check/selectOption/…)' });
        if (!/expect\(/.test(src)) fail('G5', { rule: 'flow-no-assert', target: fl, detail: 'flow must assert with expect(' });
        if (ft.persists && !/page\.reload\(/.test(src)) fail('G5', { rule: 'flow-no-reload', target: fl, detail: `feature ${ft.name} persists: reload and assert the saved state` });
      }
    }

    // Playwright run: generated page spec (G2–G4) + mapped flows (G5).
    const specPath = path.join(runDir, 'pages.gate.spec.mjs');
    fs.writeFileSync(specPath, pageSpecSource(path.join(HERE, 'gate-browser.mjs')));
    const runFlows = want('G5') && flowFiles.length && !args.initBaseline && !args.accept;
    const testFiles = [specPath, ...(runFlows ? flowFiles.map((f) => path.join(repo, f)).filter((f) => fs.existsSync(f)) : [])];
    const configPath = path.join(runDir, 'playwright.gate.config.mjs');
    fs.writeFileSync(configPath, playwrightConfigSource({ repo, runDir, origin, cfg, testFiles }));
    const pwArgs = ['test', '--config', configPath];
    if (args.initBaseline) pwArgs.push('--update-snapshots=missing');
    if (args.accept) pwArgs.push('--update-snapshots=all', '--grep', `@page:${args.accept} `, specPath);
    const pwBin = path.join(repo, 'node_modules/.bin/playwright');
    const pw = await sh(`"${pwBin}" ${pwArgs.map((x) => JSON.stringify(x)).join(' ')}`, {
      cwd: repo, env: { UI_GATE_RUNTIME: rtPath, UI_GATE_BASE_URL: origin }, timeoutMs: 900_000, logFile: path.join(reportDir, 'playwright.log'),
    });
    const report = fs.existsSync(path.join(runDir, 'report.json')) ? readJSON(path.join(runDir, 'report.json')) : null;
    if (!report) {
      for (const g of ['G2', 'G3', 'G4', 'G5']) if (want(g)) fail(g, { rule: 'runner', detail: `Playwright produced no report (exit ${pw.code}): ${pw.tail.slice(-500)}` });
    } else {
      const { passedTitles } = collect(report, { fail, runDir, reportDir, intent, repo, want, env });
      // G5 acceptance coverage: every condition written at plan time needs a passing flow titled [AC-id].
      if (want('G5') && !args.initBaseline && !args.accept) {
        for (const ac of intent.acceptance) {
          if (!ac.id || !ac.do || !ac.expect || !ac.broken) fail('G5', { rule: 'acceptance-incomplete', target: ac.id || '?', detail: 'needs id, do (做), expect (應該出現), broken (就是壞了)' });
          else if (![...passedTitles].some((title) => title.includes(`[${ac.id}]`))) fail('G5', { rule: 'acceptance-missing', target: ac.id, detail: `no passing flow titled [${ac.id}]: ${ac.do} → ${ac.expect}` });
        }
      }
    }
    for (const g of ['G2', 'G3', 'G4', 'G5']) if (gates[g].status === 'pending') gates[g].status = want(g) ? 'pass' : 'skipped';
  } catch (err) {
    if (err.message !== 'stop') fail('G1', { rule: 'runner', detail: String(err.stack || err).slice(0, 600) });
  } finally {
    if (server && server.exitCode === null) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true }); // runner-owned temp state only
  }
  for (const g of GATES) if (gates[g].status === 'pending') gates[g].status = 'not-run';
  const result = {
    schema: 1, runnerVersion: VERSION, configSha: sha256(fs.readFileSync(path.join(repo, '.ui-gate.json'))),
    treeHash: treeHash(repo, cfg), base, changed, env, startedAt: started.toISOString(), finishedAt: new Date().toISOString(),
    partial: !!(only || args.initBaseline || args.accept), gates, reportDir: path.relative(repo, reportDir),
  };
  writeJSON(path.join(repo, '.ui-gate/result.json'), result);
  writeJSON(path.join(reportDir, 'result.json'), result);
  const ok = GATES.every((g) => gates[g].status === 'pass') && !result.partial;
  const selectedOk = GATES.filter((g) => want(g) || g === 'G0' || g === 'G1').every((g) => gates[g].status === 'pass');
  printSummary(result, ok, result.partial && selectedOk);
  return ok || (result.partial && selectedOk) ? 0 : 1;
}

function readIntent(repo) {
  const p = path.join(repo, '.ui-gate/intent.json');
  const lockP = path.join(repo, '.ui-gate/intent.lock.json');
  if (!fs.existsSync(p)) return { pages: new Set(), acceptance: [], locked: false, problem: null };
  const intent = readJSON(p);
  const pages = new Set((intent.pages || []).map((x) => x.name));
  const acceptance = intent.acceptance || [];
  if (!fs.existsSync(lockP)) return { pages, acceptance, locked: false, problem: 'intent.json is not locked (run --lock-intent before changing code)' };
  const lock = readJSON(lockP);
  if (lock.sha !== sha256(fs.readFileSync(p))) return { pages, acceptance, locked: false, problem: 'intent.json changed after it was locked' };
  return { pages, acceptance, locked: true, problem: null };
}

function collect(report, { fail, runDir, reportDir, intent, repo, want, env }) {
  const tests = [];
  const passedTitles = new Set();
  const loadNote = env ? ` (machine load ${env.load1} on ${env.cpus} CPUs: rerun when idle; a product defect only if it repeats then)` : '';
  const walk = (suite) => { for (const s of suite.suites || []) walk(s); for (const sp of suite.specs || []) for (const t of sp.tests || []) tests.push({ spec: sp, t }); };
  for (const s of report.suites || []) walk(s);
  for (const { spec, t } of tests) {
    const project = t.projectName;
    const last = t.results?.[t.results.length - 1] || {};
    const errors = (last.errors || []).map((e) => (e.message || '').replace(/\u001b\[[0-9;]*m/g, ''));
    const pageMatch = /^page (\S+) @page:/.exec(spec.title);
    if (pageMatch) {
      const name = pageMatch[1];
      const outP = path.join(runDir, 'out/pages', `${project}__${name}.json`);
      const out = fs.existsSync(outP) ? readJSON(outP) : { g2: [{ rule: 'no-result', detail: errors.join(' | ').slice(0, 400) }], g3: [] };
      if (want('G2')) for (const v of out.g2) fail('G2', { page: name, viewport: project, ...v });
      if (want('G3')) for (const v of out.g3) fail('G3', { page: name, viewport: project, ...v });
      if (want('G4')) {
        const shotErr = errors.find((e) => /toHaveScreenshot|snapshot doesn't exist|Screenshot comparison/i.test(e));
        if (shotErr) {
          const missing = /doesn't exist/i.test(shotErr);
          const att = (last.attachments || []).filter((a) => a.path && /(actual|expected|diff)\.png$/.test(a.path));
          const dest = path.join(reportDir, 'visual', `${name}.${project}`);
          fs.mkdirSync(dest, { recursive: true });
          for (const a of att) fs.copyFileSync(a.path, path.join(dest, path.basename(a.path).replace(/^.*-(actual|expected|diff)\.png$/, '$1.png')));
          const where = path.relative(repo, dest);
          if (missing) fail('G4', { page: name, viewport: project, rule: 'baseline-missing', detail: 'no baseline: ask the user, then --init-baseline' });
          else if (intent.pages.has(name) && intent.locked) fail('G4', { page: name, viewport: project, rule: 'intended-change', detail: `review expected.png vs actual.png in ${where}; if correct run --accept ${name}` });
          else fail('G4', { page: name, viewport: project, rule: 'unintended-change', detail: `${shotErr.split('\n')[0].slice(0, 160)} — see ${where}${intent.problem && intent.pages.has(name) ? ' (' + intent.problem + ')' : ''}` });
        }
      }
      const other = errors.filter((e) => !/toHaveScreenshot|snapshot doesn't exist|Screenshot comparison|G2 RUNTIME|G3 LAYOUT/.test(e));
      if (other.length && want('G2')) {
        const timedOut = /Test timeout of \d+ms exceeded/.test(other[0]);
        fail('G2', { page: name, viewport: project, rule: timedOut ? 'timeout' : 'page-test-error', detail: other[0].split('\n')[0].slice(0, 200) + (timedOut ? loadNote : '') });
      }
      continue;
    }
    // Flow test (G5)
    if (!want('G5')) continue;
    if (t.status === 'expected') passedTitles.add(spec.title);
    if (t.status !== 'expected' && t.status !== 'skipped') { // test.skip(condition, reason) is intentional
      const outP = path.join(runDir, 'out/flows', `${project}__${spec.id}.json`);
      const found = fs.existsSync(outP) ? readJSON(outP) : { g2: [], g3: [] };
      const specific = [...found.g2.map((v) => ({ ...v, rule: 'G2 ' + v.rule })), ...found.g3.map((v) => ({ ...v, rule: 'G3 ' + v.rule }))];
      if (specific.length) {
        for (const v of specific.slice(0, 5)) fail('G5', { flow: spec.file || '', test: spec.title, viewport: project, ...v });
      } else {
        const timedOut = /Test timeout of \d+ms exceeded/.test(errors[0] || '');
        fail('G5', { flow: spec.file || '', test: spec.title, viewport: project, rule: timedOut ? 'timeout' : (last.status || t.status), detail: (errors[0] || 'failed').split('\n').slice(0, 3).join(' ').slice(0, 300) + (timedOut ? loadNote : '') });
      }
    }
  }
  return { passedTitles };
}

function pageSpecSource(helperPath) {
  return `import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { watchRuntime, runLayout } from ${JSON.stringify(pathToFileURL(helperPath).href)};
const rt = JSON.parse(fs.readFileSync(process.env.UI_GATE_RUNTIME, 'utf8'));
for (const pg of rt.pages) {
  test(\`page \${pg.name} @page:\${pg.name} \`, async ({ page }, testInfo) => {
    const g2 = watchRuntime(page, rt);
    if (rt.clock) await page.clock.setFixedTime(new Date(rt.clock));
    for (const r of pg.routes) {
      const body = fs.readFileSync(r.bodyPath, 'utf8');
      await page.route(r.url, (route) => route.fulfill({ status: r.status, contentType: 'application/json', body }));
    }
    await page.goto(pg.path);
    try { await page.locator(pg.ready).first().waitFor({ state: 'visible', timeout: 15000 }); }
    catch { g2.push({ rule: 'ready', detail: 'ready selector not visible within 15 s: ' + pg.ready }); }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    const g3 = await runLayout(page, rt, testInfo.project.use.isMobile);
    fs.writeFileSync(path.join(rt.outDir, 'pages', testInfo.project.name + '__' + pg.name + '.json'), JSON.stringify({ g2, g3 }));
    if (!rt.skipVisual) {
      await expect.soft(page).toHaveScreenshot(pg.name + '.png', { fullPage: true, mask: rt.mask.map((s) => page.locator(s)) });
    }
  });
}
`;
}

function playwrightConfigSource({ repo, runDir, origin, cfg, testFiles }) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const projects = cfg.viewports.map((v) => ({
    name: v.name,
    use: { browserName: 'chromium', viewport: { width: v.width, height: v.height }, isMobile: !!v.isMobile, hasTouch: !!v.hasTouch, deviceScaleFactor: 1, ...(v.userAgent ? { userAgent: v.userAgent } : {}) },
  }));
  return `import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: ${JSON.stringify(repo)},
  testMatch: [${testFiles.map((f) => `/${esc(f).replace(/\//g, '\\/')}$/`).join(', ')}],
  outputDir: ${JSON.stringify(path.join(runDir, 'test-results'))},
  snapshotPathTemplate: ${JSON.stringify(path.join(repo, cfg.baselineDir) + '/{arg}.{projectName}{ext}')},
  retries: 0,
  workers: ${cfg.workers || 2},
  fullyParallel: true,
  timeout: ${cfg.timeouts?.testMs || 120000},
  reporter: [['json', { outputFile: ${JSON.stringify(path.join(runDir, 'report.json'))} }], ['line']],
  expect: { timeout: 7000, toHaveScreenshot: { maxDiffPixelRatio: ${cfg.visual.maxDiffPixelRatio}, threshold: ${cfg.visual.threshold}, animations: 'disabled', caret: 'hide', scale: 'css' } },
  use: { baseURL: ${JSON.stringify(origin)}, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: ${JSON.stringify(projects)},
});
`;
}

function printSummary(result, ok, partialOk = false) {
  console.log(`\n[UI GATE] ${ok ? 'PASS' : partialOk ? 'PARTIAL PASS (not valid evidence)' : 'FAIL'}  tree ${result.treeHash.slice(0, 12)}  report ${result.reportDir}`);
  for (const g of GATES) {
    const s = result.gates[g];
    console.log(`  ${g} ${s.status.toUpperCase()}${s.violations.length ? ` (${s.violations.length})` : ''}`);
    for (const v of s.violations.slice(0, 8)) console.log('     - ' + [v.rule, v.page && `${v.page}@${v.viewport}`, v.flow, v.test, v.target, v.detail].filter(Boolean).join(' | '));
  }
  if (result.partial) console.log('  (partial run: --only / --init-baseline / --accept never produce a valid result)');
}

// ---------- intent, baseline and project setup ----------
function lockIntent(repo) {
  const { config: cfg } = loadConfig(repo);
  const p = path.join(repo, '.ui-gate/intent.json');
  if (!fs.existsSync(p)) { console.log('Write .ui-gate/intent.json first: {"pages":[{"name":"home","reason":"…"}]}'); return 1; }
  const changed = changedWatched(repo, cfg, baseRef(repo));
  if (changed.length) { console.log('Refusing to lock: watched files already changed vs base:\n  ' + changed.join('\n  ')); return 1; }
  writeJSON(path.join(repo, '.ui-gate/intent.lock.json'), { sha: sha256(fs.readFileSync(p)), lockedAt: new Date().toISOString() });
  console.log('intent locked'); return 0;
}
function acceptGuard(repo, page) {
  const intent = readIntent(repo);
  if (!intent.pages.has(page)) { console.log(`--accept ${page}: page is not in .ui-gate/intent.json; an unintended change must be fixed, not accepted.`); return false; }
  if (!intent.locked) { console.log(`--accept ${page}: ${intent.problem}`); return false; }
  return true;
}
function initProject(repo) {
  const dest = path.join(repo, 'tests/ui-gate/gate-fixture.mjs');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(HERE, 'gate-fixture.template.mjs'), dest);
  console.log('wrote', path.relative(repo, dest)); return 0;
}

// ---------- entry ----------
const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  let code;
  if (args.check) {
    const r = check(args.repo, { requireCommitted: !!args.requireCommitted, base: args.base });
    console.log(args.json ? JSON.stringify(r) : `${r.valid ? 'VALID' : 'INVALID'}: ${r.reason}`);
    code = r.valid ? 0 : 1;
  } else if (args.lockIntent) code = lockIntent(args.repo);
  else if (args.initProject) code = initProject(args.repo);
  else if (args.accept && !acceptGuard(args.repo, args.accept)) code = 1;
  else code = await run(args);
  process.exit(code);
}
