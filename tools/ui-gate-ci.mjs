#!/usr/bin/env node
/**
 * CI entry: skip when watch paths unchanged vs merge-base; otherwise run full verify:ui.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runner = join(root, 'tools/ui-gate-run.mjs');

const probe = spawnSync(process.execPath, [runner, '--check', '--json'], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const out = String(probe.stdout || '').trim();
if (!out) {
  console.error(String(probe.stderr || 'ui-gate check produced no stdout'));
  process.exit(probe.status ?? 1);
}
let check;
try {
  check = JSON.parse(out);
} catch {
  console.error(out.slice(0, 500));
  process.exit(1);
}

console.log(`ui-gate-ci: ${check.reason || 'ok'} (gated=${check.gated}, triggered=${check.triggered})`);

if (!check.gated || !check.triggered) {
  console.log('ui-gate-ci: skip — no watched changes vs base');
  process.exit(0);
}
if (check.valid) {
  console.log('ui-gate-ci: skip — valid gate result for current tree');
  process.exit(0);
}

console.log('ui-gate-ci: watched paths changed — running full UI gate');
const run = spawnSync(process.execPath, [runner], { cwd: root, stdio: 'inherit' });
process.exit(run.status ?? 1);