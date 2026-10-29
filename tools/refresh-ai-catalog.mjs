#!/usr/bin/env node
/**
 * 自官方允許清單擷取模型生命週期證據，與 lib/ai-providers.mjs 比對；預設 dry-run。
 * 用法：node tools/refresh-ai-catalog.mjs [--apply] [--evidence path.json] [--offline]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  catalogSnapshot,
  proposeCatalogDiff,
  parseOpenAiShutdownStatus,
  isEvidenceFresh,
} from '../lib/ai-catalog-refresh.mjs';
import { syncAiProvidersMeta } from './sync-ai-providers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWLIST_HOSTS = new Set([
  'developers.openai.com',
  'platform.openai.com',
  'ai.google.dev',
]);

const DEFAULT_SOURCES = [
  { url: 'https://developers.openai.com/api/docs/models/o4-mini.md', modelId: 'o4-mini', vendor: 'openai' },
];

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function hostAllowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWLIST_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

async function fetchSource(entry, nowIso) {
  if (!hostAllowed(entry.url)) {
    return { ...entry, success: false, error: 'host_not_allowlisted', fetchedAtUtc: nowIso };
  }
  let res;
  try {
    res = await fetch(entry.url, { headers: { Accept: 'text/markdown, text/plain, */*' } });
  } catch (e) {
    return { ...entry, success: false, error: String(e?.message || e), fetchedAtUtc: nowIso };
  }
  const body = await res.text();
  const fetchedAtUtc = nowIso;
  const status = parseOpenAiShutdownStatus(body, entry.modelId);
  return {
    url: entry.url,
    modelId: entry.modelId,
    vendor: entry.vendor,
    fetchedAtUtc,
    contentSha256: sha256(body),
    httpStatus: res.status,
    success: res.ok,
    officialStatus: status,
    evidenceText: body.slice(0, 2000),
  };
}

async function loadFixtureEvidence() {
  const path = join(root, 'tests/fixtures/ai-catalog/openai-o4-mini-shutdown.md');
  const body = await readFile(path, 'utf8');
  const nowIso = new Date().toISOString();
  return [{
    url: 'fixture://openai-o4-mini-shutdown.md',
    modelId: 'o4-mini',
    vendor: 'openai',
    fetchedAtUtc: nowIso,
    contentSha256: sha256(body),
    success: true,
    officialStatus: parseOpenAiShutdownStatus(body, 'o4-mini'),
    evidenceText: body,
  }];
}

export async function runRefreshAiCatalog({ apply = false, useNetwork = true, evidencePath = '' } = {}) {
  const nowIso = new Date().toISOString();
  let sources;
  if (evidencePath) {
    const raw = JSON.parse(await readFile(evidencePath, 'utf8'));
    sources = raw.sources || raw;
  } else if (useNetwork) {
    sources = await Promise.all(DEFAULT_SOURCES.map((s) => fetchSource(s, nowIso)));
  } else {
    sources = await loadFixtureEvidence();
  }

  const catalog = catalogSnapshot();
  const observations = sources
    .filter((s) => s.success && s.officialStatus)
    .map((s) => ({ modelId: s.modelId, status: s.officialStatus }));

  const proposals = proposeCatalogDiff(catalog, observations);
  const fresh = sources.every((s) => !s.fetchedAtUtc || isEvidenceFresh(s.fetchedAtUtc));

  const report = {
    schemaVersion: 1,
    generatedAtUtc: nowIso,
    fresh,
    catalog,
    sources,
    proposals,
    applyRequested: apply,
    applied: false,
  };

  if (apply) {
    if (!fresh) {
      report.error = 'evidence_stale_or_invalid';
      return report;
    }
    const needsManual = proposals.some(
      (p) => p.action === 'remove_model' && catalog.some((c) => c.id === p.provider && c.models.includes(p.modelId)),
    );
    if (needsManual) {
      report.error = 'manual_apply_required';
      report.hint = '自動 --apply 尚未寫入 ai-providers.mjs；請依 proposals 手動更新正本後執行 node tools/sync-ai-providers.mjs';
    } else {
      await syncAiProvidersMeta();
      report.applied = true;
      report.hint = '型錄已與正本一致，已重新同步 HTML meta';
    }
  }

  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  const evidenceIdx = process.argv.indexOf('--evidence');
  const evidencePath = evidenceIdx >= 0 ? process.argv[evidenceIdx + 1] : '';
  const offline = process.argv.includes('--offline');
  const report = await runRefreshAiCatalog({ apply, useNetwork: !offline && !evidencePath, evidencePath });
  const outDir = join(root, 'tools/.ai-catalog-evidence');
  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, `${report.generatedAtUtc.replace(/[:.]/g, '-')}Z.json`);
  await writeFile(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, evidenceFile: outFile }, null, 2));
  if (report.error) process.exitCode = 1;
}
