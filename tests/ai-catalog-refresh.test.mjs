import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lookupModelPricing,
  REMOVED_CATALOG_MODELS,
  PROVIDERS,
  catalogModelsForProvider,
} from '../lib/ai-providers.mjs';
import {
  parseOpenAiShutdownStatus,
  proposeCatalogDiff,
  catalogSnapshot,
  isEvidenceFresh,
} from '../lib/ai-catalog-refresh.mjs';
import { runRefreshAiCatalog } from '../tools/refresh-ai-catalog.mjs';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ai-catalog');

test('OpenAI 型錄不含 o4-mini，Antigravity 不含 gemini-3.0-flash 與 gpt-6.1-terra', () => {
  assert.ok(!PROVIDERS.openai.models.includes('o4-mini'));
  assert.ok(!PROVIDERS.antigravity.models.includes('gemini-3.0-flash'));
  assert.ok(!PROVIDERS.antigravity.models.includes('gpt-6.1-terra'));
  assert.equal(PROVIDERS.openai.defaultModel, 'gpt-6.1-terra');
  assert.equal(PROVIDERS.antigravity.defaultModel, 'gemini-3.8-flash');
  assert.deepEqual(REMOVED_CATALOG_MODELS.openai, ['o4-mini', 'gpt-6.1-terra-mini']);
});

test('lookupModelPricing：gpt-6-astra 使用 $10/$50，自訂模型 fallback 預設費率', () => {
  const astra = lookupModelPricing('openai', 'gpt-6-astra');
  assert.equal(astra.inputPricePerM, 10);
  assert.equal(astra.outputPricePerM, 50);
  const custom = lookupModelPricing('openai', 'my-custom-model');
  assert.equal(custom.inputPricePerM, 1);
  assert.equal(custom.outputPricePerM, 5);
  assert.equal(custom.pricingSource, 'provider_default');
});

test('Gemini 3.8 Flash 介紹價在 2026-12-31 前後切換', () => {
  const before = lookupModelPricing('antigravity', 'gemini-3.8-flash', new Date('2026-12-15T00:00:00Z'));
  assert.equal(before.inputPricePerM, 0.75);
  const after = lookupModelPricing('antigravity', 'gemini-3.8-flash', new Date('2027-01-02T00:00:00Z'));
  assert.equal(after.inputPricePerM, 1.5);
  assert.equal(after.outputPricePerM, 7.5);
});

test('夾具 o4-mini Shut down → 提案移除', async () => {
  const md = await readFile(join(fixtureDir, 'openai-o4-mini-shutdown.md'), 'utf8');
  assert.equal(parseOpenAiShutdownStatus(md, 'o4-mini'), 'shut_down');
  const catalog = catalogSnapshot().map((p) =>
    (p.id === 'openai' ? { ...p, models: [...p.models, 'o4-mini'] } : p),
  );
  const proposals = proposeCatalogDiff(catalog, [{ modelId: 'o4-mini', status: 'shut_down' }]);
  assert.deepEqual(proposals, [{ provider: 'openai', action: 'remove_model', modelId: 'o4-mini', reason: 'shut_down' }]);
});

test('refresh dry-run（offline）不修改型錄', async () => {
  const before = catalogModelsForProvider('openai').join(',');
  const report = await runRefreshAiCatalog({ apply: false, useNetwork: false });
  assert.equal(report.sources[0].officialStatus, 'shut_down');
  assert.equal(report.applied, false);
  assert.equal(catalogModelsForProvider('openai').join(','), before);
});

test('isEvidenceFresh 拒絕超過 24 小時', () => {
  const old = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  assert.equal(isEvidenceFresh(old), false);
  assert.equal(isEvidenceFresh(new Date().toISOString()), true);
});

test('過期證據 --apply 失敗', async () => {
  const stale = {
    sources: [{
      url: 'fixture://stale',
      modelId: 'o4-mini',
      fetchedAtUtc: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
      success: true,
      officialStatus: 'shut_down',
    }],
  };
  const { writeFile, unlink } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = join(tmpdir(), `ai-catalog-evidence-${Date.now()}.json`);
  await writeFile(path, JSON.stringify(stale));
  try {
    const report = await runRefreshAiCatalog({ apply: true, evidencePath: path, useNetwork: false });
    assert.equal(report.error, 'evidence_stale_or_invalid');
    assert.equal(report.applied, false);
  } finally {
    await unlink(path).catch(() => {});
  }
});
