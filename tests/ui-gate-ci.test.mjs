import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = path.join(root, 'tools/ui-gate-run.mjs');
const ci = path.join(root, 'tools/ui-gate-ci.mjs');

test('ui-gate-ci skips when check says not triggered', () => {
  const probe = spawnSync(process.execPath, [runner, '--check', '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(probe.status, 0, probe.stderr);
  const check = JSON.parse(String(probe.stdout).trim());
  if (check.triggered) {
    assert.ok(check.reason, 'triggered in this worktree — ui-gate-ci integration deferred to CI');
    return;
  }
  const r = spawnSync(process.execPath, [ci], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /skip/i);
});