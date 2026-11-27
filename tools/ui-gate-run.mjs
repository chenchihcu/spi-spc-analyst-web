#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  process.env.UI_GATE_SCRIPT,
  '/cursor/stores/user/skills/validate-web-ui/scripts/ui-gate.mjs',
  join(homedir(), '.agents/skills/validate-web-ui/scripts/ui-gate.mjs'),
].filter(Boolean);

const gate = candidates.find((p) => existsSync(p));
if (!gate) {
  console.error('ui-gate runner not found. Set UI_GATE_SCRIPT or install validate-web-ui skill.');
  process.exit(1);
}

const args = ['--repo', root, ...process.argv.slice(2)];
const r = spawnSync(process.execPath, [gate, ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);