import {
  AI_PROVIDER_CATALOG,
  REMOVED_CATALOG_MODELS,
  lookupModelPricing,
  catalogModelsForProvider,
} from './ai-providers.mjs';

export function catalogSnapshot() {
  return AI_PROVIDER_CATALOG.map((p) => ({
    id: p.id,
    defaultModel: p.defaultModel,
    models: [...p.models],
    removedModels: [...p.removedModels],
  }));
}

/** @param {string} markdown @param {string} modelId */
export function parseOpenAiShutdownStatus(markdown, modelId) {
  const id = String(modelId || '').trim();
  if (!id || !markdown.includes(`\`${id}\``)) return null;
  if (/Shut down/i.test(markdown) && markdown.includes(id)) return 'shut_down';
  return null;
}

/** @param {typeof catalogSnapshot extends () => infer R ? R : never} catalog @param {{ modelId: string, status: string }[]} observations */
export function proposeCatalogDiff(catalog, observations) {
  const proposals = [];
  for (const obs of observations) {
    if (obs.status !== 'shut_down') continue;
    for (const p of catalog) {
      if (p.models.includes(obs.modelId)) {
        proposals.push({ provider: p.id, action: 'remove_model', modelId: obs.modelId, reason: 'shut_down' });
      }
    }
  }
  return proposals;
}

export function isEvidenceFresh(fetchedAtUtc, now = new Date(), maxAgeHours = 24) {
  const stamp = Date.parse(String(fetchedAtUtc || '').replace('Z', '+00:00'));
  if (!Number.isFinite(stamp)) return false;
  const ageMs = now.getTime() - stamp;
  return ageMs >= 0 && ageMs <= maxAgeHours * 3600 * 1000;
}

export { REMOVED_CATALOG_MODELS, lookupModelPricing, catalogModelsForProvider };
