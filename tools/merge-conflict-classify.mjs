#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyFromGit } from './merge-conflict-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsonMode = process.argv.includes('--json');

function gitRun(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

const mergeHead = gitRun(['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
const inMerge = Boolean(mergeHead);
const result = { inMerge, ...classifyFromGit(gitRun, root) };

if (jsonMode) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else {
  for (const f of result.files) {
    console.log(`${f.file}\t${f.category}\tauto=${f.autoResolvable}\t${f.reason}`);
  }
  console.log(`unmerged=${result.unmerged.length} canAutoSync=${result.canAutoSync}`);
}

process.exit(result.unmerged.length && !result.canAutoSync ? 1 : 0);