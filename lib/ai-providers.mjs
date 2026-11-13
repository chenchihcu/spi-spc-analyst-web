/** AI 推薦型錄正本：cloudflare/ai.mjs 與 spi-spc.html 的 AI_PROVIDERS_META 皆由此同步。 */

export const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
export const ANTIGRAVITY_CHAT_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
export const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

/** 上游請求形狀：輸出上限欄位名稱與數值、哪些模型送 reasoning_effort（'all' 或模型 id 陣列）。 */
const DEFAULT_REQUEST_PROFILE = { maxTokensField: 'max_completion_tokens', maxTokens: 16000, reasoningEffortModels: 'all' };

const CUSTOM_MODEL_OPTION = ['custom', '自訂模型名稱…'];

/** @typedef {{ inputPricePerM: number, outputPricePerM: number, pricingEffectiveUntil?: string, pricingNext?: { inputPricePerM: number, outputPricePerM: number } }} ModelPricing */

/** @param {ModelPricing} row @param {Date} [at] */
function effectiveRates(row, at = new Date()) {
  if (!row?.pricingEffectiveUntil || !row.pricingNext) {
    return { inputPricePerM: row.inputPricePerM, outputPricePerM: row.outputPricePerM };
  }
  const end = Date.parse(`${row.pricingEffectiveUntil}T23:59:59.999Z`);
  if (Number.isFinite(end) && at.getTime() > end) {
    return row.pricingNext;
  }
  return { inputPricePerM: row.inputPricePerM, outputPricePerM: row.outputPricePerM };
}

/** @type {ReadonlyArray<{ id: string, label: string, chatUrl: string, defaultModel: string, models: string[], headerKey: string, modelPricing: Record<string, ModelPricing>, removedModels: string[], ui: Record<string, string>, free?: boolean, liveModels?: boolean, defaultEffort?: 'high' | 'medium' | 'low', request?: { maxTokensField: string, maxTokens: number, reasoningEffortModels: 'all' | string[] } }>} */
export const AI_PROVIDER_CATALOG = [
  {
    id: 'openai',
    label: 'OpenAI',
    chatUrl: OPENAI_CHAT_URL,
    defaultModel: 'gpt-6.1-terra',
    models: ['gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.4'],
    headerKey: 'x-openai-key',
    removedModels: ['o4-mini', 'gpt-6.1-terra-mini'],
    modelPricing: {
      'gpt-6.1-terra': { inputPricePerM: 1.0, outputPricePerM: 5.0 },
      'gpt-6.1-sol': { inputPricePerM: 2.0, outputPricePerM: 10.0 },
      'gpt-6-astra': { inputPricePerM: 10.0, outputPricePerM: 50.0 },
      'gpt-5.4': { inputPricePerM: 2.5, outputPricePerM: 15.0 },
    },
    ui: {
      'gpt-6.1-terra': 'gpt-6.1-terra（推薦 · 均衡推理與成本）',
      'gpt-6.1-sol': 'gpt-6.1-sol（較高能力 · 複雜工程推理）',
      'gpt-6-astra': 'gpt-6-astra（旗艦 · 最高推理深度）',
      'gpt-5.4': 'gpt-5.4（較早世代 · 仍可用）',
      priceText: '依所選模型計價（預設 terra：輸入 $1.00 / 1M · 輸出 $5.00 / 1M tokens）',
      headerName: 'X-OpenAI-Key',
      inputId: 'inAiKey',
      toggleId: 'btnAiKeyToggle',
      badgeId: 'aiBadgeOpenai',
    },
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    chatUrl: ANTIGRAVITY_CHAT_URL,
    defaultModel: 'gemini-3.8-flash',
    models: ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-3.1-pro-preview'],
    headerKey: 'x-antigravity-key',
    removedModels: ['gemini-3.0-flash', 'gpt-6.1-terra'],
    modelPricing: {
      'gemini-3.8-flash': {
        inputPricePerM: 0.75,
        outputPricePerM: 3.75,
        pricingEffectiveUntil: '2026-12-31',
        pricingNext: { inputPricePerM: 1.5, outputPricePerM: 7.5 },
      },
      'gemini-4-argon': {
        inputPricePerM: 2.0,
        outputPricePerM: 10.0,
        pricingEffectiveUntil: '2026-11-30',
        pricingNext: { inputPricePerM: 4.0, outputPricePerM: 20.0 },
      },
      'gemini-3.1-pro-preview': { inputPricePerM: 2.0, outputPricePerM: 12.0 },
    },
    ui: {
      'gemini-3.8-flash': 'gemini-3.8-flash（推薦 · 高速工程診斷）',
      'gemini-4-argon': 'gemini-4-argon（旗艦 · 深度推理）',
      'gemini-3.1-pro-preview': 'gemini-3.1-pro-preview（Pro 預覽 · 長上下文）',
      priceText: '依所選模型計價（預設 3.8 Flash：輸入 $0.75 / 1M · 輸出 $3.75 / 1M tokens）',
      headerName: 'X-Antigravity-Key',
      inputId: 'inAiKeyAntigravity',
      toggleId: 'btnAiKeyToggleAntigravity',
      badgeId: 'aiBadgeAntigravity',
    },
  },
  {
    // 免費帳號（build.nvidia.com）：不計費；可用模型常變動，前端以「更新模型清單」取得帳號當下的清單。
    id: 'nvidia',
    label: 'NVIDIA',
    chatUrl: NVIDIA_CHAT_URL,
    defaultModel: 'openai/gpt-oss-20b',
    models: ['openai/gpt-oss-20b'],
    headerKey: 'x-nvidia-key',
    // gpt-oss-120b：NVIDIA 於 2026-09-03 下架（410 Gone）
    removedModels: ['openai/gpt-oss-120b'],
    // 實測推理型模型未送推理強度時可能把輸出額度全用在推理、正文為空；預設 low
    defaultEffort: 'low',
    free: true,
    liveModels: true,
    request: {
      maxTokensField: 'max_tokens',
      // 推理型模型（例 nemotron-3.5-lightning 不理會 reasoning_effort）在 8192 下推理用掉大半、正文被截斷；
      // 2026-11-13 實測 lightning、gemma-4 接受 32768。拒收時後端降為 8192 重試一次。
      maxTokens: 16384,
      // 即時清單模型會變動；實測送出 reasoning_effort 的模型都接受（不支援者回 400 時後端去掉欄位重試一次）
      reasoningEffortModels: 'all',
    },
    modelPricing: {
      'openai/gpt-oss-20b': { inputPricePerM: 0, outputPricePerM: 0 },
    },
    ui: {
      'openai/gpt-oss-20b': 'openai/gpt-oss-20b',
      priceText: '免費帳號不計費，受 NVIDIA 帳號速率與額度限制',
      headerName: 'X-Nvidia-Key',
      inputId: 'inAiKeyNvidia',
      toggleId: 'btnAiKeyToggleNvidia',
      badgeId: 'aiBadgeNvidia',
    },
  },
];

/** @param {string} providerId */
export function requestProfileFor(providerId) {
  const p = AI_PROVIDER_CATALOG.find((x) => x.id === providerId);
  return { ...DEFAULT_REQUEST_PROFILE, ...(p?.request || {}) };
}

/** 該服務商的該模型是否送 reasoning_effort；清單外（含自訂、即時清單新增）的模型不送。 */
export function sendsReasoningEffort(providerId, modelId) {
  const list = requestProfileFor(providerId).reasoningEffortModels;
  return list === 'all' || (Array.isArray(list) && list.includes(String(modelId || '')));
}

/** @param {string} providerId @param {string} modelId @param {Date} [at] */
export function lookupModelPricing(providerId, modelId, at = new Date()) {
  const p = AI_PROVIDER_CATALOG.find((x) => x.id === providerId);
  if (!p) return { inputPricePerM: 1.0, outputPricePerM: 5.0, pricingSource: 'fallback' };
  const id = String(modelId || '').trim() || p.defaultModel;
  const row = p.modelPricing[id];
  if (!row) {
    const fb = p.modelPricing[p.defaultModel];
    const rates = effectiveRates(fb, at);
    return { ...rates, pricingSource: 'provider_default', modelId: p.defaultModel };
  }
  const rates = effectiveRates(row, at);
  return { ...rates, pricingSource: 'catalog', modelId: id };
}

/** @type {Record<string, { id: string, label: string, chatUrl: string, defaultModel: string, models: string[], headerKey: string, inputPricePerM: number, outputPricePerM: number, modelPricing: Record<string, ModelPricing> }>} */
export const PROVIDERS = Object.fromEntries(
  AI_PROVIDER_CATALOG.map((p) => {
    const def = lookupModelPricing(p.id, p.defaultModel);
    return [
      p.id,
      {
        id: p.id,
        label: p.label,
        chatUrl: p.chatUrl,
        defaultModel: p.defaultModel,
        models: [...p.models],
        headerKey: p.headerKey,
        inputPricePerM: def.inputPricePerM,
        outputPricePerM: def.outputPricePerM,
        modelPricing: p.modelPricing,
        free: Boolean(p.free),
        liveModels: Boolean(p.liveModels),
        defaultEffort: p.defaultEffort || null,
        request: requestProfileFor(p.id),
      },
    ];
  }),
);

export const REMOVED_CATALOG_MODELS = Object.fromEntries(
  AI_PROVIDER_CATALOG.map((p) => [p.id, [...p.removedModels]]),
);

function jsStr(s) {
  return JSON.stringify(s);
}

function formatModelPricingLiteral(pricing) {
  const entries = Object.entries(pricing).map(([id, row]) => {
    const base = `${jsStr(id)}:{inputPricePerM:${row.inputPricePerM},outputPricePerM:${row.outputPricePerM}`;
    if (row.pricingEffectiveUntil) {
      const next = row.pricingNext;
      return `${base},pricingEffectiveUntil:${jsStr(row.pricingEffectiveUntil)},pricingNext:{inputPricePerM:${next.inputPricePerM},outputPricePerM:${next.outputPricePerM}}}`;
    }
    return `${base}}`;
  });
  return `{${entries.join(',')}}`;
}

/** 產生 spi-spc.html 內 AI_PROVIDERS_META 物件本體（不含 const 與分號）。 */
export function formatAiProvidersMetaObjectLiteral() {
  const parts = AI_PROVIDER_CATALOG.map((p) => {
    const modelEntries = p.models.map((m) => `[${jsStr(m)},${jsStr(p.ui[m])}]`);
    modelEntries.push(`[${jsStr(CUSTOM_MODEL_OPTION[0])},${jsStr(CUSTOM_MODEL_OPTION[1])}]`);
    return `${p.id}:{
    id:${jsStr(p.id)},label:${jsStr(p.label)},defaultModel:${jsStr(p.defaultModel)},
    models:[${modelEntries.join(',')}],
    defaultEndpoint:${jsStr(p.chatUrl)},
    priceText:${jsStr(p.ui.priceText)},
    modelPricing:${formatModelPricingLiteral(p.modelPricing)},
    removedModels:${jsStr(p.removedModels)},
    free:${Boolean(p.free)},liveModels:${Boolean(p.liveModels)},defaultEffort:${jsStr(p.defaultEffort || 'high')},reasoningEffortModels:${jsStr(requestProfileFor(p.id).reasoningEffortModels)},
    headerName:${jsStr(p.ui.headerName)},inputId:${jsStr(p.ui.inputId)},toggleId:${jsStr(p.ui.toggleId)},badgeId:${jsStr(p.ui.badgeId)}
  }`;
  });
  return `{\n  ${parts.join(',\n  ')}\n}`;
}

export function catalogModelsForProvider(providerId) {
  const p = PROVIDERS[providerId];
  return p ? [...p.models] : [];
}

export function formatPriceLabelForModel(providerId, modelId) {
  const p = AI_PROVIDER_CATALOG.find((x) => x.id === providerId);
  if (!p) return '';
  if (p.free) return p.ui.priceText;
  const rates = lookupModelPricing(providerId, modelId);
  const known = p.modelPricing[modelId] || p.modelPricing[p.defaultModel];
  if (!known && modelId && modelId !== p.defaultModel) {
    return `自訂模型 · 估算依 ${p.defaultModel} 費率（輸入 $${rates.inputPricePerM} / 1M · 輸出 $${rates.outputPricePerM} / 1M tokens）`;
  }
  return `輸入 $${rates.inputPricePerM} / 1M · 輸出 $${rates.outputPricePerM} / 1M tokens`;
}
