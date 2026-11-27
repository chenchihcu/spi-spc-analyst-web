import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeFileContent,
  pathCategory,
  resolveDocChecklistConflicts,
  parseConflictHunks,
} from '../tools/merge-conflict-lib.mjs';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/merge-conflicts');

test('pathCategory blocks version and auth paths', () => {
  assert.equal(pathCategory('package.json'), 'version_files');
  assert.equal(pathCategory('spi-spc.html'), 'version_files');
  assert.equal(pathCategory('lib/auth-handler.mjs'), 'logic_blacklist');
  assert.equal(pathCategory('docs/ui-gate-audit.md'), 'simple_docs');
  assert.equal(pathCategory('tools/foo.mjs'), 'unknown');
});

test('union resolves checklist-only doc conflict', () => {
  const raw = readFileSync(path.join(fixtureDir, 'ui-gate-audit-checklist.md'), 'utf8');
  const info = analyzeFileContent('docs/ui-gate-audit.md', raw);
  assert.equal(info.autoResolvable, true);
  const { content, changed } = resolveDocChecklistConflicts(raw);
  assert.equal(changed, true);
  assert.ok(!content.includes('<<<<<<<'));
  assert.match(content, /GitHub Actions/);
  assert.match(content, /release-check/);
  assert.equal(parseConflictHunks(content).length, 0);
});

test('prose doc conflict is not auto resolvable', () => {
  const raw = readFileSync(path.join(fixtureDir, 'docs-prose-conflict.md'), 'utf8');
  const info = analyzeFileContent('docs/foo.md', raw);
  assert.equal(info.autoResolvable, false);
  assert.equal(info.reason, 'prose_in_hunk');
  assert.throws(() => resolveDocChecklistConflicts(raw), /refused/);
});

test('package.json UU content is blocked even with markers', () => {
  const raw = '<<<<<<< HEAD\n{}\n=======\n{\"a\":1}\n>>>>>>> origin/main\n';
  const info = analyzeFileContent('package.json', raw);
  assert.equal(info.category, 'version_files');
  assert.equal(info.autoResolvable, false);
});