import { validatePayload, buildMessages, SYSTEM_PROMPT, InputError } from '../lib/analyze-core.mjs';
import {
  OPENAI_CHAT_URL,
  ANTIGRAVITY_CHAT_URL,
  PROVIDERS,
  lookupModelPricing,
} from '../lib/ai-providers.mjs';

// 預設模型為 OpenAI gpt-6.1-terra（可用環境變數 AI_MODEL 或請求標頭 X-AI-Model 覆寫），推理強度預設為 high。
// max_completion_tokens 需容納高強度推理 tokens 與約 600–900 字繁中工程診斷回覆。
export const DEFAULT_MODEL = 'gpt-6.1-terra';
export const DEFAULT_REASONING_EFFORT = 'high';
export const ALLOWED_EFFORTS = ['high', 'medium', 'low'];
export const MAX_TOKENS = 16000;

export { OPENAI_CHAT_URL, ANTIGRAVITY_CHAT_URL, PROVIDERS };
// Cursor 已移除：api.cursor.com 沒有 /v1/chat/completions 路由（無金鑰 POST 即回 404 Route not found）。
export const REMOVED_PROVIDERS = {
  cursor: 'Cursor 未提供 AI 對話 API，已從服務商清單移除；請改用 OpenAI 或 Antigravity',
};

const defaultOpenAiRates = lookupModelPricing('openai', DEFAULT_MODEL);
export const INPUT_PRICE_PER_M = defaultOpenAiRates.inputPricePerM;
export const OUTPUT_PRICE_PER_M = defaultOpenAiRates.outputPricePerM;

export const DEFAULT_LIMITS = {
  dailyReqLimit: 20,
  monthlyTokenLimit: 500000,
  monthlyUsdLimit: 5.0,
};

const json = (obj, status = 200) => Response.json(obj, { status, headers: { 'Cache-Control': 'no-store' } });

function utc8Periods(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const month = `${parts.year}-${parts.month}`;
  return { day, month };
}

function normUser(req, userArg) {
  const raw = String(userArg || req.headers.get('x-spi-user') || 'default').trim().toLowerCase();
  return raw.replace(/[^a-z0-9_.@-]/g, '_').slice(0, 64) || 'default';
}

function removedProviderError(raw) {
  return REMOVED_PROVIDERS[String(raw || '').trim().toLowerCase()] || '';
}

function normProvider(raw) {
  const k = String(raw || '').trim().toLowerCase();
  return PROVIDERS[k] ? k : 'openai';
}

function getServerEnvKey(env, providerId) {
  if (!env) return '';
  if (providerId === 'antigravity') return String(env.ANTIGRAVITY_API_KEY || env.GEMINI_API_KEY || '').trim();
  return String(env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || '').trim();
}

function sanitizeLimits(raw = {}) {
  const d = Number(raw.dailyReqLimit);
  const t = Number(raw.monthlyTokenLimit);
  const u = Number(raw.monthlyUsdLimit);
  return {
    dailyReqLimit: Number.isFinite(d) ? Math.min(Math.max(Math.round(d), 1), 500) : DEFAULT_LIMITS.dailyReqLimit,
    monthlyTokenLimit: Number.isFinite(t) ? Math.min(Math.max(Math.round(t), 1000), 10000000) : DEFAULT_LIMITS.monthlyTokenLimit,
    monthlyUsdLimit: Number.isFinite(u) ? Math.min(Math.max(Math.round(u * 100) / 100, 0.1), 500) : DEFAULT_LIMITS.monthlyUsdLimit,
  };
}

function parseHeaderLimits(req) {
  const hdr = req.headers.get('x-ai-limits');
  if (!hdr) return null;
  try {
    return sanitizeLimits(JSON.parse(hdr));
  } catch {
    return null;
  }
}

function providerStorageKeys(user, day, month, provider = 'openai') {
  const p = normProvider(provider);
  const pfx = p === 'openai' ? 'ai' : `ai:${p}`;
  const kDayReq = `${pfx}:d:${user}:${day}:req`;
  const kMonReq = `${pfx}:m:${user}:${month}:req`;
  const kMonIn = `${pfx}:m:${user}:${month}:in_tok`;
  const kMonOut = `${pfx}:m:${user}:${month}:out_tok`;
  const kMonCost = `${pfx}:m:${user}:${month}:ucost`;
  const kLimits = p === 'openai' ? `ai_limits:${user}` : `ai_limits:${p}:${user}`;
  return { kDayReq, kMonReq, kMonIn, kMonOut, kMonCost, kLimits };
}

async function readQuotaAndUsage(db, user, now = new Date(), provider = 'openai') {
  const p = normProvider(provider);
  const provCfg = PROVIDERS[p];
  const { day, month } = utc8Periods(now);
  const keys = providerStorageKeys(user, day, month, p);

  let limits = { ...DEFAULT_LIMITS };
  const usage = {
    provider: p,
    day,
    month,
    dailyRequests: 0,
    monthlyRequests: 0,
    monthlyInputTokens: 0,
    monthlyOutputTokens: 0,
    monthlyTotalTokens: 0,
    monthlyUsd: 0,
  };

  if (!db || typeof db.prepare !== 'function') {
    return { limits, usage, keys };
  }

  try {
    const { results = [] } = await db.prepare(
      `SELECT key, value FROM stats WHERE key IN (?, ?, ?, ?, ?)`
    ).bind(keys.kDayReq, keys.kMonReq, keys.kMonIn, keys.kMonOut, keys.kMonCost).all();
    const map = new Map(results.map(r => [r.key, Number(r.value) || 0]));
    usage.dailyRequests = map.get(keys.kDayReq) || 0;
    usage.monthlyRequests = map.get(keys.kMonReq) || 0;
    usage.monthlyInputTokens = map.get(keys.kMonIn) || 0;
    usage.monthlyOutputTokens = map.get(keys.kMonOut) || 0;
    usage.monthlyTotalTokens = usage.monthlyInputTokens + usage.monthlyOutputTokens;
    const ucost = map.get(keys.kMonCost) || Math.round(
      usage.monthlyInputTokens * provCfg.inputPricePerM + usage.monthlyOutputTokens * provCfg.outputPricePerM
    );
    usage.monthlyUsd = Math.round((ucost / 1e6) * 10000) / 10000;
  } catch {}

  try {
    const row = await db.prepare(`SELECT value FROM system_settings WHERE key = ? LIMIT 1`).bind(keys.kLimits).first();
    if (row && row.value) {
      limits = sanitizeLimits(JSON.parse(row.value));
    }
  } catch {}

  return { limits, usage, keys };
}

async function readAllProvidersQuota(db, env, user, now = new Date()) {
  const out = {};
  for (const p of Object.keys(PROVIDERS)) {
    const provCfg = PROVIDERS[p];
    const { limits, usage } = await readQuotaAndUsage(db, user, now, p);
    out[p] = {
      id: p,
      label: provCfg.label,
      defaultModel: provCfg.defaultModel,
      models: provCfg.models,
      defaultEndpoint: provCfg.chatUrl,
      hasServerKey: Boolean(getServerEnvKey(env, p)),
      pricing: { inputPerM: provCfg.inputPricePerM, outputPerM: provCfg.outputPricePerM },
      limits,
      usage,
    };
  }
  return out;
}

async function saveUserLimits(db, user, limits, provider = 'openai') {
  const p = normProvider(provider);
  const cleanLim = sanitizeLimits(limits);
  if (db && typeof db.prepare === 'function') {
    const kLimits = p === 'openai' ? `ai_limits:${user}` : `ai_limits:${p}:${user}`;
    await db.prepare(
      `INSERT INTO system_settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).bind(kLimits, JSON.stringify(cleanLim)).run();
  }
  return cleanLim;
}

async function recordUsage(db, keys, inTokens, outTokens, nowMs = Date.now(), provCfg = PROVIDERS.openai, modelId = provCfg.defaultModel) {
  if (!db || typeof db.prepare !== 'function') return;
  const inT = Math.max(0, Math.round(Number(inTokens) || 0));
  const outT = Math.max(0, Math.round(Number(outTokens) || 0));
  const rates = lookupModelPricing(provCfg.id, modelId, new Date(nowMs));
  const ucost = Math.round(inT * rates.inputPricePerM + outT * rates.outputPricePerM);
  const upsert = `INSERT INTO stats(key, value, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = stats.value + excluded.value, updated = excluded.updated`;
  try {
    const stmts = [
      db.prepare(upsert).bind(keys.kDayReq, 1, nowMs),
      db.prepare(upsert).bind(keys.kMonReq, 1, nowMs),
      db.prepare(upsert).bind(keys.kMonIn, inT, nowMs),
      db.prepare(upsert).bind(keys.kMonOut, outT, nowMs),
      db.prepare(upsert).bind(keys.kMonCost, ucost, nowMs),
    ];
    if (typeof db.batch === 'function') await db.batch(stmts);
    else for (const s of stmts) await s.run();
  } catch {}
}

function detectProviderFromHeaders(req) {
  const explicit = (req.headers.get('x-ai-provider') || '').trim().toLowerCase();
  if (PROVIDERS[explicit]) return explicit;
  if ((req.headers.get('x-antigravity-key') || '').trim()) return 'antigravity';
  return 'openai';
}

function resolveApiKey(req, env, providerId = 'openai') {
  const provCfg = PROVIDERS[providerId] || PROVIDERS.openai;
  const headerKey = (
    req.headers.get(provCfg.headerKey) ||
    req.headers.get('x-ai-key') ||
    (providerId === 'openai' ? req.headers.get('x-openai-key') : '') ||
    ''
  ).trim();
  if (headerKey) {
    if (headerKey.length < 6 || headerKey.length > 256 || /[\u0000-\u0020]/.test(headerKey)) {
      return { error: `${provCfg.label} API Key 格式不正確（不可包含空白或控制字元）` };
    }
    return { apiKey: headerKey, source: 'user' };
  }
  const envKey = getServerEnvKey(env, providerId);
  if (envKey) return { apiKey: envKey, source: 'server' };
  return { apiKey: '', source: 'none' };
}

function validateEndpointUrl(rawUrl, fallbackUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return { url: fallbackUrl };
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: '自訂 API 端點格式不正確，請填寫完整的 https:// 網址' };
  }
  if (parsed.protocol !== 'https:') {
    return { error: '自訂 API 端點必須使用 https:// 安全連線' };
  }
  if (parsed.username || parsed.password) {
    return { error: '自訂 API 端點不可包含帳號密碼資訊' };
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '[::1]' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^0\./.test(host) ||
    /^\[f[cd]/i.test(host) ||
    /^\[fe80/i.test(host)
  ) {
    return { error: '自訂 API 端點不可指向本機或內部網路位址' };
  }
  return { url: parsed.toString() };
}

function resolveModelAndEffort(req, env, provCfg) {
  const hdrModel = (req.headers.get('x-ai-model') || '').trim();
  let model = provCfg.id === 'openai' ? (env?.AI_MODEL || provCfg.defaultModel) : provCfg.defaultModel;
  if (hdrModel) {
    if (!/^[A-Za-z0-9._:/-]{2,120}$/.test(hdrModel)) {
      return { error: '指定的模型名稱格式不正確' };
    }
    model = hdrModel;
  }

  const hdrEffort = (req.headers.get('x-ai-reasoning-effort') || '').trim().toLowerCase();
  let reasoningEffort = String(env?.AI_REASONING_EFFORT || DEFAULT_REASONING_EFFORT).trim().toLowerCase();
  if (!ALLOWED_EFFORTS.includes(reasoningEffort)) reasoningEffort = DEFAULT_REASONING_EFFORT;
  if (hdrEffort) {
    if (!ALLOWED_EFFORTS.includes(hdrEffort)) {
      return { error: `推理強度必須為 ${ALLOWED_EFFORTS.join(' / ')} 之一` };
    }
    reasoningEffort = hdrEffort;
  }
  return { model, reasoningEffort };
}

// 上游暫時過載（Gemini 503 high demand、429 rate limit）常持續十幾秒；最多 4 次、間隔 2→4→8 秒（總等待約 14 秒）。
export const UPSTREAM_RETRY_MAX_ATTEMPTS = 4;
export const UPSTREAM_RETRY_MAX_DELAY_MS = 8000;
const UPSTREAM_RETRY_BACKOFF_MS = [2000, 4000, 8000];

// 上游前面是 Cloudflare（api.openai.com、AI Gateway）時，100 秒內沒送出回應標頭就回 524。
// 高推理強度＋大份摘要可能在推理階段就超過 100 秒；同強度重試只會再等 100 秒後同樣失敗，
// 因此只重試一次，並把推理強度降為 low（在結果開頭揭露），模型與服務商不變。
export const UPSTREAM_TIMEOUT_STATUSES = [524];
export const TIMEOUT_FALLBACK_EFFORT = 'low';

function errorPayloadFromJson(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const inner = errorPayloadFromJson(item);
      if (inner) return inner;
    }
    return null;
  }
  if (value.error && typeof value.error === 'object') return value.error;
  if (typeof value.message === 'string' && value.message.trim()) return value;
  return null;
}

/** @returns {{ message: string, bodyText: string, hasLimitZero: boolean, status?: string, code?: number }} */
export function extractUpstreamError(bodyText) {
  const raw = String(bodyText || '').trim();
  if (!raw) return { message: '', bodyText: raw, hasLimitZero: false };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const snippet = raw.slice(0, 500);
    return { message: snippet, bodyText: raw, hasLimitZero: /limit:\s*0/i.test(snippet) };
  }
  const err = errorPayloadFromJson(parsed);
  const message = err?.message ? String(err.message).trim() : '';
  const combined = message || raw.slice(0, 500);
  const hasLimitZero = /limit:\s*0/i.test(combined);
  return {
    message: combined,
    bodyText: raw,
    hasLimitZero,
    status: err?.status,
    code: err?.code,
  };
}

function parseRetryAfterMs(headers) {
  const ra = headers?.get?.('retry-after');
  if (ra == null || ra === '') return null;
  const asNum = Number(ra);
  if (Number.isFinite(asNum) && asNum >= 0) return asNum * 1000;
  const asDate = Date.parse(ra);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

function parseRetryInBodyMs(message) {
  const m = String(message || '').match(/Please retry in ([\d.]+)s/i);
  if (!m) return null;
  const sec = Number(m[1]);
  return Number.isFinite(sec) ? Math.ceil(sec * 1000) : null;
}

/** @returns {{ retry: boolean, waitMs: number, extracted: ReturnType<typeof extractUpstreamError>, reason?: string }} */
export function planUpstreamRetry({
  status,
  headers,
  bodyText,
  attemptIndex,
  maxAttempts = UPSTREAM_RETRY_MAX_ATTEMPTS,
}) {
  const extracted = extractUpstreamError(bodyText);
  if (status !== 429 && status !== 503) {
    return { retry: false, waitMs: 0, extracted, reason: 'not_retryable_status' };
  }
  if (extracted.hasLimitZero || /limit:\s*0/i.test(bodyText)) {
    return { retry: false, waitMs: 0, extracted, reason: 'limit_zero' };
  }
  const msg = extracted.message;
  if (/402|depleted prepay|permission_denied|invalid_argument/i.test(msg)) {
    return { retry: false, waitMs: 0, extracted, reason: 'client_error' };
  }
  if (attemptIndex >= maxAttempts - 1) {
    return { retry: false, waitMs: 0, extracted, reason: 'exhausted' };
  }
  let waitMs = parseRetryAfterMs(headers);
  if (waitMs == null) waitMs = parseRetryInBodyMs(msg);
  if (waitMs == null) waitMs = UPSTREAM_RETRY_BACKOFF_MS[attemptIndex] ?? UPSTREAM_RETRY_MAX_DELAY_MS;
  if (waitMs > UPSTREAM_RETRY_MAX_DELAY_MS) {
    return { retry: false, waitMs: 0, extracted, reason: 'wait_too_long' };
  }
  return { retry: true, waitMs, extracted };
}

export function formatUpstreamFailureMessage(provLabel, status, extracted, didRetry) {
  const base = extracted.message
    ? `${status} ${extracted.message}`
    : `${provLabel} 回應 HTTP ${status}`;
  if (extracted.hasLimitZero || /limit:\s*0/i.test(extracted.message)) {
    return `${base}。此 API 金鑰對該模型額度為 0，請至 Google AI Studio 確認計費／配額，或改選其他模型／服務商。`;
  }
  if (status === 404 && (extracted.code === 'model_not_found' || /does not exist|is not found/i.test(extracted.message))) {
    return `${base}。此金鑰無法使用該模型，請在 AI 設定按「檢查可用模型」後改選。`;
  }
  if (status === 404 && /^Route \S+ not found/i.test(extracted.message)) {
    return `${base}。此端點沒有 Chat Completions 路由，請確認自訂 API 端點網址。`;
  }
  if (UPSTREAM_TIMEOUT_STATUSES.includes(status)) {
    const tail = didRetry ? `已自動改用推理強度 ${TIMEOUT_FALLBACK_EFFORT} 重試仍逾時` : '上游超過 100 秒未開始回應';
    return `${base}。${tail}；請在 AI 設定改選較快的模型，或稍後再試。`;
  }
  if (didRetry && (status === 429 || status === 503)) {
    return `${base}。已自動重試仍失敗，請稍後再試或改選其他服務商。`;
  }
  return base;
}

function abortableDelay(ms, signal) {
  const wait = Math.max(0, Number(ms) || 0);
  if (wait === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(resolve, wait);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

async function fetchUpstreamWithRetry(targetUrl, headers, bodyPayload, signal, provLabel, onEffortFallback) {
  let didRetry = false;
  let timeoutFallbackUsed = false;
  for (let attempt = 0; attempt < UPSTREAM_RETRY_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
      signal,
    });
    if (res.ok) return { res, didRetry };
    const bodyText = await res.text();
    if (UPSTREAM_TIMEOUT_STATUSES.includes(res.status)) {
      const canFallback = !timeoutFallbackUsed
        && bodyPayload.reasoning_effort
        && bodyPayload.reasoning_effort !== TIMEOUT_FALLBACK_EFFORT;
      if (canFallback) {
        timeoutFallbackUsed = true;
        didRetry = true;
        const fromEffort = bodyPayload.reasoning_effort;
        bodyPayload = { ...bodyPayload, reasoning_effort: TIMEOUT_FALLBACK_EFFORT };
        onEffortFallback?.(fromEffort, TIMEOUT_FALLBACK_EFFORT);
        continue;
      }
      return {
        res: null,
        error: formatUpstreamFailureMessage(provLabel, res.status, extractUpstreamError(bodyText), didRetry && timeoutFallbackUsed),
        didRetry,
      };
    }
    const plan = planUpstreamRetry({
      status: res.status,
      headers: res.headers,
      bodyText,
      attemptIndex: attempt,
      maxAttempts: UPSTREAM_RETRY_MAX_ATTEMPTS,
    });
    if (plan.retry) {
      didRetry = true;
      await abortableDelay(plan.waitMs, signal);
      continue;
    }
    return {
      res: null,
      error: formatUpstreamFailureMessage(provLabel, res.status, plan.extracted, didRetry),
      didRetry,
    };
  }
  return { res: null, error: `${provLabel} 回應 HTTP 429`, didRetry: true };
}

/** OpenAI 相容端點的模型清單網址：…/chat/completions → …/models；不是這個形狀的自訂端點回 null。 */
export function modelsUrlFromChatUrl(chatUrl) {
  let u;
  try { u = new URL(chatUrl); } catch { return null; }
  if (!/\/chat\/completions\/?$/.test(u.pathname)) return null;
  u.pathname = u.pathname.replace(/\/chat\/completions\/?$/, '/models');
  u.search = '';
  return u.toString();
}

// 用使用者（或伺服器）金鑰查詢上游實際可用的模型，前端據此停用寫死型錄中不存在的模型。
async function handleListModels(req, env, providerId) {
  const provCfg = PROVIDERS[providerId];
  const keyInfo = resolveApiKey(req, env, providerId);
  if (keyInfo.error) return json({ ok: false, provider: providerId, error: keyInfo.error }, 400);
  if (!keyInfo.apiKey) {
    return json({ ok: false, provider: providerId, error: `請先填入 ${provCfg.label} API Key，再檢查可用模型` }, 400);
  }
  const epCheck = validateEndpointUrl(req.headers.get('x-ai-endpoint'), provCfg.chatUrl);
  if (epCheck.error) return json({ ok: false, provider: providerId, error: epCheck.error }, 400);
  const modelsUrl = modelsUrlFromChatUrl(epCheck.url);
  if (!modelsUrl) return json({ ok: true, provider: providerId, models: null, reason: 'custom_endpoint' });

  let res;
  try {
    res = await fetch(modelsUrl, { headers: { Authorization: `Bearer ${keyInfo.apiKey}` } });
  } catch (e) {
    return json({ ok: false, provider: providerId, error: `${provCfg.label} 模型清單查詢失敗：${e?.message || e}` }, 502);
  }
  const bodyText = await res.text();
  if (!res.ok) {
    const error = formatUpstreamFailureMessage(provCfg.label, res.status, extractUpstreamError(bodyText), false);
    return json({ ok: false, provider: providerId, error }, 502);
  }
  let parsed = null;
  try { parsed = JSON.parse(bodyText); } catch {}
  const list = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed?.models) ? parsed.models : null;
  if (!list) return json({ ok: false, provider: providerId, error: `${provCfg.label} 模型清單格式無法辨識` }, 502);
  const models = [...new Set(
    list.map((m) => String(m?.id || m?.name || '').replace(/^models\//, '').trim()).filter(Boolean),
  )].sort();
  return json({ ok: true, provider: providerId, models });
}

export async function handleAnalyze(req, env = {}, userArg = '') {
  if (env && env.AI_ENABLED === 'false') {
    return json({ error: '管理員已停用 AI 分析功能' }, 403);
  }
  const logPayload = env?.AI_LOG_PAYLOAD === 'true';
  const user = normUser(req, userArg);

  if (req.method === 'GET') {
    const reqUrl = new URL(req.url);
    const rawProv = reqUrl.searchParams.get('provider') || req.headers.get('x-ai-provider') || 'openai';
    if (reqUrl.searchParams.get('models') === '1') {
      const removedMsg = removedProviderError(rawProv);
      if (removedMsg) return json({ ok: false, error: removedMsg, code: 'provider_removed' }, 400);
      return handleListModels(req, env, normProvider(rawProv));
    }
    const activeProv = normProvider(rawProv);
    const provCfg = PROVIDERS[activeProv];
    const providers = await readAllProvidersQuota(env?.DB, env, user);
    const activeInfo = providers[activeProv];
    const model = activeProv === 'openai' ? (env?.AI_MODEL || provCfg.defaultModel) : provCfg.defaultModel;
    const reasoningEffort = env?.AI_REASONING_EFFORT || DEFAULT_REASONING_EFFORT;
    return json({
      ok: true,
      provider: activeProv,
      model,
      reasoningEffort,
      allowedEfforts: ALLOWED_EFFORTS,
      hasServerKey: activeInfo.hasServerKey,
      gateway: true,
      logPayload,
      limits: activeInfo.limits,
      usage: activeInfo.usage,
      pricing: activeInfo.pricing,
      providers,
    });
  }

  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return json({ error: '不接受其他網站的請求' }, 403);

  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return json({ error: '設定內容必須為有效的 JSON' }, 400); }
    const targetProv = normProvider(body?.provider || req.headers.get('x-ai-provider') || 'openai');
    if (body?.providers && typeof body.providers === 'object') {
      for (const [pKey, pVal] of Object.entries(body.providers)) {
        if (PROVIDERS[pKey] && pVal && typeof pVal === 'object') {
          await saveUserLimits(env?.DB, user, pVal.limits || pVal, pKey);
        }
      }
    }
    if (body?.limits || (!body?.providers && body)) {
      await saveUserLimits(env?.DB, user, body?.limits || body || {}, targetProv);
    }
    const providers = await readAllProvidersQuota(env?.DB, env, user);
    const activeInfo = providers[targetProv];
    return json({
      ok: true,
      provider: targetProv,
      limits: activeInfo.limits,
      usage: activeInfo.usage,
      providers,
    });
  }

  if (req.method !== 'POST') return json({ error: '只接受 GET、PUT 或 POST' }, 405);

  const removedMsg = removedProviderError(req.headers.get('x-ai-provider'));
  if (removedMsg) return json({ error: removedMsg, code: 'provider_removed' }, 400);

  const providerId = detectProviderFromHeaders(req);
  const provCfg = PROVIDERS[providerId];

  const keyInfo = resolveApiKey(req, env, providerId);
  if (keyInfo.error) return json({ error: keyInfo.error }, 400);
  if (!keyInfo.apiKey) {
    return json({ error: `請先在「API 金鑰與使用量設定」填入您的 ${provCfg.label} API Key（或切換至其他已設定金鑰的服務商）` }, 400);
  }

  const modelEffort = resolveModelAndEffort(req, env, provCfg);
  if (modelEffort.error) return json({ error: modelEffort.error }, 400);
  const { model, reasoningEffort } = modelEffort;

  const epCheck = validateEndpointUrl(req.headers.get('x-ai-endpoint'), provCfg.chatUrl);
  if (epCheck.error) return json({ error: epCheck.error }, 400);
  const targetUrl = epCheck.url;

  let payload;
  const rawBody = await req.text();
  try { payload = validatePayload(rawBody); }
  catch (e) { if (e instanceof InputError) return json({ error: e.message }, 400); throw e; }

  const { limits: dbLimits, usage, keys } = await readQuotaAndUsage(env?.DB, user, new Date(), providerId);
  const hdrLimits = parseHeaderLimits(req);
  const activeLimits = hdrLimits ? {
    dailyReqLimit: Math.min(dbLimits.dailyReqLimit, hdrLimits.dailyReqLimit),
    monthlyTokenLimit: Math.min(dbLimits.monthlyTokenLimit, hdrLimits.monthlyTokenLimit),
    monthlyUsdLimit: Math.min(dbLimits.monthlyUsdLimit, hdrLimits.monthlyUsdLimit),
  } : dbLimits;

  if (usage.dailyRequests >= activeLimits.dailyReqLimit) {
    return json({
      error: `［${provCfg.label}］已達今日 AI 分析次數上限（${usage.dailyRequests} / ${activeLimits.dailyReqLimit} 次）。請切換其他服務商金鑰，或在設定介面調高每日上限。`,
      code: 'daily_limit_exceeded',
      provider: providerId,
      usage,
      limits: activeLimits,
    }, 429);
  }
  if (usage.monthlyTotalTokens >= activeLimits.monthlyTokenLimit) {
    return json({
      error: `［${provCfg.label}］已達本月累計 Token 使用上限（${usage.monthlyTotalTokens.toLocaleString()} / ${activeLimits.monthlyTokenLimit.toLocaleString()} tokens）。請切換其他服務商或在設定介面調整上限。`,
      code: 'monthly_token_limit_exceeded',
      provider: providerId,
      usage,
      limits: activeLimits,
    }, 429);
  }
  if (usage.monthlyUsd >= activeLimits.monthlyUsdLimit) {
    return json({
      error: `［${provCfg.label}］已達本月預估費用上限（$${usage.monthlyUsd.toFixed(2)} / $${activeLimits.monthlyUsdLimit.toFixed(2)} USD）。請切換其他服務商或在設定介面調整上限。`,
      code: 'monthly_usd_limit_exceeded',
      provider: providerId,
      usage,
      limits: activeLimits,
    }, 429);
  }

  const userMessages = buildMessages(payload);
  const estInputTokens = Math.max(100, Math.ceil((SYSTEM_PROMPT.length + JSON.stringify(userMessages).length) / 3.5));

  const upstreamCtrl = new AbortController();
  const enc = new TextEncoder();

  const body = new ReadableStream({
    async start(controller) {
      let outChars = 0;
      let usageReported = null;
      let finishReason = null;
      let effortNote = '';
      try {
        const upstreamHeaders = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${keyInfo.apiKey}`,
          ...(logPayload ? {} : { 'cf-aig-collect-log-payload': 'false' }),
        };
        const upstreamBody = {
          model,
          reasoning_effort: reasoningEffort,
          max_completion_tokens: MAX_TOKENS,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...userMessages,
          ],
        };
        const upstream = await fetchUpstreamWithRetry(
          targetUrl,
          upstreamHeaders,
          upstreamBody,
          upstreamCtrl.signal,
          provCfg.label,
          (fromEffort, toEffort) => {
            effortNote = `（${provCfg.label} 以推理強度 ${fromEffort} 超過 100 秒未回應，已自動改用推理強度 ${toEffort} 重試）\n\n`;
          },
        );
        if (!upstream.res) {
          controller.enqueue(enc.encode(`\n\n［AI 分析失敗：${upstream.error}］`));
          return;
        }
        const res = upstream.res;
        if (effortNote) controller.enqueue(enc.encode(effortNote));

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split(/\r?\n/);
          buf = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (!dataStr || dataStr === '[DONE]') continue;
            let ev;
            try { ev = JSON.parse(dataStr); } catch { continue; }
            if (ev.usage && typeof ev.usage === 'object') {
              usageReported = ev.usage;
            }
            const choice = Array.isArray(ev.choices) ? ev.choices[0] : null;
            if (choice) {
              const deltaText = choice.delta?.content;
              if (typeof deltaText === 'string' && deltaText.length > 0) {
                outChars += deltaText.length;
                controller.enqueue(enc.encode(deltaText));
              }
              if (choice.finish_reason) finishReason = choice.finish_reason;
            } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
              outChars += ev.delta.text.length;
              controller.enqueue(enc.encode(ev.delta.text));
            } else if (ev.type === 'message_delta' && ev.delta?.stop_reason) {
              finishReason = ev.delta.stop_reason;
            }
          }
        }

        if (finishReason === 'length' || finishReason === 'max_tokens') {
          controller.enqueue(enc.encode('\n\n（回覆已達長度上限，內容可能不完整）'));
        }

        const inTok = usageReported?.prompt_tokens ?? usageReported?.input_tokens ?? estInputTokens;
        const outTok = usageReported?.completion_tokens ?? usageReported?.output_tokens ?? Math.max(50, Math.ceil(outChars / 2));
        await recordUsage(env?.DB, keys, inTok, outTok, Date.now(), provCfg, model);
      } catch (e) {
        if (e?.name !== 'AbortError') {
          controller.enqueue(enc.encode(`\n\n［AI 分析失敗：${e?.status ? e.status + ' ' : ''}${e?.message || e}］`));
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      upstreamCtrl.abort();
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-AI-Provider': providerId,
      'X-AI-Model': model,
      'X-AI-Reasoning-Effort': reasoningEffort,
      'X-AI-Usage': JSON.stringify({ provider: providerId, ...usage }),
    },
  });
}
