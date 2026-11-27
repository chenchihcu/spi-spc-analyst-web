#!/usr/bin/env node
/**
 * PR merge sync: fetch main → merge → classify → docs resolve → verify (spec-pr-merge-auto-resolve-rfc)
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyFromGit, resolveUnmergedFiles } from './merge-conflict-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = new Set(process.argv.slice(2));

function git(args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`);
  }
  return r;
}

function gitOut(args) {
  const r = git(args, { allowFail: true });
  return r.status === 0 ? (r.stdout || '').trimEnd() : null;
}

function runNode(script, args, { json = false } = {}) {
  const r = spawnSync(process.execPath, [join(root, script), ...args], {
    cwd: root,
    encoding: json ? 'utf8' : undefined,
    stdio: json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  return r;
}

function unpushedDiffClean() {
  const st = gitOut(['status', '--porcelain']) || '';
  const lines = st.split(/\r?\n/).filter(Boolean);
  const allowed = new Set(['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD']);
  for (const line of lines) {
    const code = line.slice(0, 2);
    if (code === '??') continue;
    if (allowed.has(code)) continue;
    if (code.trim() === 'M' || code.includes('M')) {
      // merge state may include M in second column
    }
    const xy = line.slice(0, 2);
    if (!['UU', 'AA', 'DD'].includes(xy) && xy !== '  ' && !xy.startsWith('M') && xy !== 'M ') {
      const blocked = lines.filter((l) => {
        const c = l.slice(0, 2);
        return c !== '??' && !allowed.has(c) && c !== ' M' && c !== 'M ';
      });
      if (blocked.length) return { ok: false, reason: 'unexpected_worktree', lines: blocked.slice(0, 10) };
    }
  }
  return { ok: true };
}

function checkState() {
  const inMerge = Boolean(gitOut(['rev-parse', '-q', '--verify', 'MERGE_HEAD']));
  const head = gitOut(['rev-parse', 'HEAD']);
  const main = gitOut(['rev-parse', 'origin/main']);
  let behind = false;
  const counts = gitOut(['rev-list', '--left-right', '--count', 'HEAD...origin/main']);
  if (counts) {
    const [, behindStr] = counts.split(/\s+/);
    behind = Number(behindStr || 0) > 0;
  }
  const classification = classifyFromGit((args) => gitOut(args), root);
  return {
    branch: gitOut(['branch', '--show-current']),
    inMerge,
    behind,
    head,
    main,
    ...classification,
  };
}

function verifyAfterMerge() {
  const checks = [];
  const t = spawnSync(process.execPath, ['--test', 'tests/release-check.test.js'], {
    cwd: root,
    stdio: 'inherit',
  });
  checks.push({ name: 'release-check.test', status: t.status === 0 ? 'pass' : 'fail' });
  if (t.status !== 0) return { ok: false, checks };

  const probe = runNode('tools/ui-gate-run.mjs', ['--check', '--json'], { json: true });
  let ui = { triggered: false };
  if (probe.status === 0 && probe.stdout) {
    try {
      ui = JSON.parse(probe.stdout.trim());
    } catch {
      ui = { triggered: true, parseError: true };
    }
  }
  if (ui.gated && ui.triggered) {
    const full = runNode('tools/ui-gate-run.mjs', [], { json: false });
    checks.push({ name: 'verify:ui', status: full.status === 0 ? 'pass' : 'fail' });
    if (full.status !== 0) return { ok: false, checks };
  } else {
    checks.push({ name: 'verify:ui', status: 'skip', reason: ui.reason || 'not triggered' });
  }
  return { ok: true, checks };
}

function output(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

try {
  git(['fetch', 'origin', 'main'], { allowFail: false });

  if (argv.has('--check-json') || argv.has('--check')) {
    output({ status: 'CHECK', ...checkState() });
    const c = checkState();
    process.exit(c.unmerged.length && !c.canAutoSync ? 1 : 0);
  }

  const dryRun = argv.has('--dry-run');
  const doSync = argv.has('--sync') || (!dryRun && !argv.has('--check-json') && !argv.has('--check'));
  if (!doSync && !dryRun) usage();

  const pre = unpushedDiffClean();
  if (!pre.ok && !checkState().inMerge) {
    output({ status: 'BLOCKED', reason: pre.reason, lines: pre.lines });
    process.exit(2);
  }

  let startedMerge = false;
  const state0 = checkState();
  if (!state0.inMerge && state0.behind) {
    git(['merge', 'origin/main', ...(dryRun ? ['--no-commit', '--no-ff'] : [])], { allowFail: true });
    startedMerge = true;
  } else if (!state0.inMerge && !state0.behind) {
    if (dryRun) {
      output({ status: 'OK', reason: 'already_up_to_date', ...checkState() });
      process.exit(0);
    }
  }

  const class1 = classifyFromGit((args) => gitOut(args), root);
  if (!class1.unmerged.length) {
    if (dryRun && startedMerge) git(['merge', '--abort'], { allowFail: true });
    output({ status: 'OK', reason: 'no_unmerged', ...checkState() });
    process.exit(0);
  }

  if (!class1.canAutoSync) {
    if (dryRun && startedMerge) git(['merge', '--abort'], { allowFail: true });
    output({ status: 'BLOCKED', reason: 'not_all_auto_resolvable', files: class1.files });
    process.exit(2);
  }

  const resolved = resolveUnmergedFiles((args) => gitOut(args), root, { dryRun });
  if (!resolved.ok) {
    if (dryRun && startedMerge) git(['merge', '--abort'], { allowFail: true });
    output({ status: 'BLOCKED', ...resolved });
    process.exit(2);
  }

  if (dryRun) {
    if (startedMerge) git(['merge', '--abort'], { allowFail: true });
    output({ status: 'DRY_RUN', resolved: resolved.files, ...class1 });
    process.exit(0);
  }

  for (const f of resolved.files) {
    if (f.changed) git(['add', '--', f.file]);
  }
  const stillUU = (gitOut(['diff', '--name-only', '--diff-filter=U']) || '').split('\n').filter(Boolean);
  if (stillUU.length) {
    output({ status: 'BLOCKED', reason: 'remaining_uu', files: stillUU });
    process.exit(2);
  }

  if (gitOut(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])) {
    git(['commit', '--no-edit']);
  } else if (startedMerge) {
    git(['commit', '-m', 'merge(main): sync with origin/main']);
  }

  const verify = verifyAfterMerge();
  if (!verify.ok) {
    output({ status: 'BLOCKED', reason: 'verify_failed', checks: verify.checks });
    process.exit(2);
  }

  output({
    status: 'SYNCED',
    commit: gitOut(['rev-parse', 'HEAD']),
    resolved: resolved.files,
    checks: verify.checks,
  });
  process.exit(0);
} catch (e) {
  output({ status: 'BLOCKED', reason: 'error', message: String(e.message || e) });
  process.exit(2);
}

function usage() {
  console.error('用法: pr-merge-sync.mjs --check-json | --dry-run | --sync');
  process.exit(2);
}