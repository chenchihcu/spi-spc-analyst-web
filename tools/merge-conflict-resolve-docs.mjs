#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveUnmergedFiles } from './merge-conflict-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const jsonMode = process.argv.includes('--json');

function gitRun(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

const result = resolveUnmergedFiles(gitRun, root, { dryRun });

if (jsonMode) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else if (!result.ok) {
  console.error('resolve blocked:', result.reason);
  for (const f of result.files || []) console.error(`  ${f.file}: ${f.reason}`);
} else {
  for (const f of result.files) {
    console.log(f.changed ? `resolved ${f.file}` : `unchanged ${f.file}`);
  }
}

process.exit(result.ok ? 0 : 1);