/**
 * PR merge conflict classify + docs checklist resolver (spec: docs/spec-pr-merge-auto-resolve-rfc.md)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const VERSION_FILES = new Set([
  'package.json',
  'package-lock.json',
  'lib/version.mjs',
  'spi-spc.html',
  'CHANGELOG.md',
]);

export const LOGIC_BLACKLIST = [
  /^cloudflare\/migrations\//,
  /^lib\/auth-handler\.mjs$/,
  /^lib\/auth-core\.mjs$/,
  /^\.github\/workflows\//,
];

const CHECKLIST_LINE = /^\s*-\s+\[[xX\s]\]\s+/;

export function pathCategory(file) {
  const n = file.replace(/\\/g, '/');
  if (VERSION_FILES.has(n)) return 'version_files';
  if (LOGIC_BLACKLIST.some((re) => re.test(n))) return 'logic_blacklist';
  if (n.startsWith('docs/') && n.endsWith('.md')) return 'simple_docs';
  return 'unknown';
}

export function parseConflictHunks(content) {
  const hunks = [];
  const re = /<<<<<<<[^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>>[^\n]*/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    hunks.push({
      start: m.index,
      end: re.lastIndex,
      ours: m[1],
      theirs: m[2],
      full: m[0],
    });
  }
  return hunks;
}

function nonEmptyLines(block) {
  return block.split(/\r?\n/).filter((l) => l.trim().length > 0);
}

/** True when every non-empty line in both sides is a markdown checklist item. */
export function isChecklistOnlyHunk(ours, theirs) {
  const lines = [...nonEmptyLines(ours), ...nonEmptyLines(theirs)];
  if (!lines.length) return false;
  return lines.every((l) => CHECKLIST_LINE.test(l));
}

export function checklistLines(block) {
  return nonEmptyLines(block).filter((l) => CHECKLIST_LINE.test(l));
}

/** Union checklist lines: theirs order first, then ours-only (stable #218+#219 pattern). */
export function unionChecklistLines(ours, theirs) {
  const theirsLines = checklistLines(theirs);
  const oursLines = checklistLines(ours);
  const seen = new Set();
  const out = [];
  for (const line of theirsLines) {
    const key = line.trim();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(line.trimEnd());
    }
  }
  for (const line of oursLines) {
    const key = line.trim();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(line.trimEnd());
    }
  }
  return out.join('\n');
}

export function analyzeFileContent(file, content) {
  const category = pathCategory(file);
  const hunks = parseConflictHunks(content);
  const hasMarkers = hunks.length > 0;
  if (category === 'version_files' || category === 'logic_blacklist') {
    return {
      file,
      category,
      blocked: true,
      autoResolvable: false,
      hunks: hunks.length,
      reason: category,
    };
  }
  if (category !== 'simple_docs') {
    return {
      file,
      category,
      blocked: category === 'unknown' && (hasMarkers || hunks.length === 0),
      autoResolvable: false,
      hunks: hunks.length,
      reason: 'not_docs_whitelist',
    };
  }
  if (!hunks.length) {
    return {
      file,
      category,
      blocked: true,
      autoResolvable: false,
      hunks: 0,
      reason: 'no_conflict_markers',
    };
  }
  const allChecklist = hunks.every((h) => isChecklistOnlyHunk(h.ours, h.theirs));
  return {
    file,
    category,
    blocked: !allChecklist,
    autoResolvable: allChecklist,
    hunks: hunks.length,
    reason: allChecklist ? 'checklist_union' : 'prose_in_hunk',
  };
}

export function resolveDocChecklistConflicts(content) {
  const hunks = parseConflictHunks(content);
  if (!hunks.length) return { content, changed: false };
  for (const h of hunks) {
    if (!isChecklistOnlyHunk(h.ours, h.theirs)) {
      throw new Error('resolve refused: non-checklist hunk');
    }
  }
  let rebuilt = '';
  let last = 0;
  for (const h of hunks) {
    rebuilt += content.slice(last, h.start);
    rebuilt += unionChecklistLines(h.ours, h.theirs);
    last = h.end;
  }
  rebuilt += content.slice(last);
  return { content: rebuilt, changed: rebuilt !== content };
}

export function classifyFromGit(gitRun, repoRoot) {
  const unmerged = (gitRun(['diff', '--name-only', '--diff-filter=U']) || '')
    .split(/\r?\n/)
    .map((s) => s.trim().replace(/\\/g, '/'))
    .filter(Boolean);
  const files = unmerged.map((file) => {
    let content;
    try {
      content = readFileSync(path.join(repoRoot, file), 'utf8');
    } catch {
      return {
        file,
        category: 'unknown',
        blocked: true,
        autoResolvable: false,
        hunks: 0,
        reason: 'unreadable',
      };
    }
    return analyzeFileContent(file, content);
  });
  const autoResolvable = files.length > 0 && files.every((f) => f.autoResolvable);
  const blocked = files.some((f) => f.blocked && !f.autoResolvable);
  return { unmerged, files, autoResolvable, blocked, canAutoSync: autoResolvable && files.length > 0 };
}

export function resolveUnmergedFiles(gitRun, repoRoot, { dryRun = false } = {}) {
  const { files, canAutoSync } = classifyFromGit(gitRun, repoRoot);
  if (!canAutoSync) {
    return { ok: false, reason: 'not_all_auto_resolvable', files };
  }
  const resolved = [];
  for (const f of files) {
    const full = path.join(repoRoot, f.file);
    const before = readFileSync(full, 'utf8');
    const { content, changed } = resolveDocChecklistConflicts(before);
    resolved.push({ file: f.file, changed, preview: changed ? content : undefined });
    if (!dryRun && changed) writeFileSync(full, content, 'utf8');
  }
  return { ok: true, files: resolved };
}