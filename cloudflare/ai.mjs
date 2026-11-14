import { validatePayload, buildMessages, SYSTEM_PROMPT, InputError } from '../lib/analyze-core.mjs';
import {
  OPENAI_CHAT_URL,
  ANTIGRAVITY_CHAT_URL,
  NVIDIA_CHAT_URL,
  PROVIDERS,
  lookupModelPricing,
  sendsReasoningEffort,
  SMALL_MODEL_RE,
  AI_CHECK_MODELS_BTN,
} from '../lib/ai-providers.mjs';

// 預設模型為 OpenAI gpt-6.1-terra（可用環境變數 AI_MODEL 或請求標頭 X-AI-Model 覆寫），推理強度預設為 high。
// max_completion_tokens 需容納高強度推理 tokens 與約 600–900 字繁中工程診斷回覆。
export const DEFAULT_MODEL = 'gpt-6.1-terra';
export const DEFAULT_REASONING_EFFORT = 'high';
export const ALLOWED_EFFORTS = ['high', 'medium', 'low'];
export const MAX_TOKENS = 16000;

export { OPENAI_CHAT_URL, ANTIGRAVITY_CHAT_URL, NVIDIA_CHAT_URL, PROVIDERS };
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
  if (providerId === 'nvidia') return String(env.NVIDIA_API_KEY || '').trim();
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
  if ((req.headers.get('x-nvidia-key') || '').trim()) return 'nvidia';
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
  let reasoningEffort = String(env?.AI_REASONING_EFFORT || provCfg.defaultEffort || DEFAULT_REASONING_EFFORT).trim().toLowerCase();
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

// Worker 對上游的請求在 100 秒內沒收到回應標頭就得到 Cloudflare 的 524。
// 原因可能是高推理強度（OpenAI），也可能是上游排隊或模型負載（NVIDIA 免費帳號），未經實測不能只歸因於推理；
// 推理強度不是 low 時只重試一次並降為 low（在結果開頭揭露），失敗訊息附上服務商、模型、推理強度與實際等待秒數供判讀。
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

/** 524 診斷尾註：服務商、模型、推理強度與實際等待秒數（未送推理強度時寫「模型預設」）。 */
export function formatTimeoutDiagnostics(provLabel, diag) {
  if (!diag) return '';
  const parts = [provLabel];
  if (diag.model) parts.push(diag.model);
  parts.push(`推理強度 ${diag.effort || '模型預設'}`);
  if (Number.isFinite(diag.waitedMs)) parts.push(`共等待 ${Math.round(diag.waitedMs / 1000)} 秒`);
  return `（${parts.join(' · ')}）`;
}

export function formatUpstreamFailureMessage(provLabel, status, extracted, didRetry, diag) {
  // 依型錄能力欄位（consoleName、free）組訊息，不比對服務商名稱；三個服務商共用同一套文字
  const prov = Object.values(PROVIDERS).find((p) => p.label === provLabel);
  const base = extracted.message
    ? `${status} ${extracted.message}`
    : `${provLabel} 回應 HTTP ${status}`;
  if (extracted.hasLimitZero || /limit:\s*0/i.test(extracted.message)) {
    const where = prov?.consoleName || `${provLabel} 主控台`;
    return `${base}。此 API 金鑰對該模型額度為 0，請至 ${where} 確認計費／配額，或改選其他模型／服務商。`;
  }
  if (status === 404 && (extracted.code === 'model_not_found' || /does not exist|is not found/i.test(extracted.message))) {
    return `${base}。此金鑰無法使用該模型，請在 AI 設定按「${AI_CHECK_MODELS_BTN}」後改選。`;
  }
  if (status === 404 && /^Route \S+ not found/i.test(extracted.message)) {
    return `${base}。此端點沒有 Chat Completions 路由，請確認自訂 API 端點網址。`;
  }
  if (UPSTREAM_TIMEOUT_STATUSES.includes(status)) {
    const tail = didRetry ? `已自動改用推理強度 ${TIMEOUT_FALLBACK_EFFORT} 重試仍逾時` : '上游超過 100 秒未開始回應';
    return `${base}。${tail}${formatTimeoutDiagnostics(provLabel, diag)}；請在 AI 設定改選較快的模型，或稍後再試。`;
  }
  if (status === 429 && prov?.free) {
    return `${base}。免費帳號速率或額度已達上限，請稍後再試或改用其他服務商。`;
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

// 即時清單服務商（NVIDIA 免費帳號）的備援競速，依據 2026-11-13 實測（CHANGELOG v10.25.0）：
// - 部分模型排隊 113–143 秒才送回應標頭，Worker 在 100 秒就收到 524；選定模型的標頭看門狗設 95 秒。
// - 可用模型 2 秒內回應：選定模型 raceDelayMs 內沒產出第一個 token 就開始試備援，每個備援的標頭看門狗 20 秒。
// - 模型清單含許多此帳號不能用的模型（404 立即回應）：備援以工作池進行，同時最多 FALLBACK_CONCURRENCY 個，
//   失敗一個補下一個，整體 overallMs 內。第一個產出內容或推理 token 者勝出，其餘中止；選定模型仍可勝出。
export const UPSTREAM_TIMEOUTS = { primaryHeaderMs: 95000, fallbackHeaderMs: 20000, raceDelayMs: 10000, overallMs: 120000 };
export const MAX_FALLBACK_MODELS = 40;
export const FALLBACK_CONCURRENCY = 6;
// 這些結果代表「此模型現在不能用」，改試下一個候選模型
const MODEL_UNAVAILABLE_STATUSES = [404, 410, 524];
// 輸出上限被上游拒收時的保守值（NVIDIA 原本的設定，實測各模型皆接受）
const SAFE_MAX_TOKENS = 8192;

function linkedAbort(parentSignal) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (parentSignal?.aborted) ctrl.abort();
  else parentSignal?.addEventListener?.('abort', onAbort, { once: true });
  return ctrl;
}

/** 單一模型的請求：429／503 退避重試、524 降推理強度重試（可關閉）、拒收 reasoning_effort 時去掉欄位重試一次、可選回應標頭看門狗。 */
async function fetchUpstreamWithRetry(targetUrl, headers, bodyPayload, signal, provLabel, onEffortFallback, opts = {}) {
  const { headerTimeoutMs = 0, effortFallback = true } = opts;
  let didRetry = false;
  let timeoutFallbackUsed = false;
  let effortDropped = false;
  let tokensReduced = false;
  const startedAt = Date.now();
  for (let attempt = 0; attempt < UPSTREAM_RETRY_MAX_ATTEMPTS; attempt++) {
    const ctrl = linkedAbort(signal);
    let timedOut = false;
    const timer = headerTimeoutMs > 0 ? setTimeout(() => { timedOut = true; ctrl.abort(); }, headerTimeoutMs) : null;
    let res;
    try {
      res = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (timedOut && !signal?.aborted) {
        const waitedMs = Date.now() - startedAt;
        return {
          res: null,
          timedOut: true,
          modelUnavailable: true,
          outcome: `等待 ${Math.round(waitedMs / 1000)} 秒未開始回應`,
          error: `${provLabel} 超過 ${Math.round(headerTimeoutMs / 1000)} 秒未開始回應${formatTimeoutDiagnostics(provLabel, { model: bodyPayload.model, effort: bodyPayload.reasoning_effort, waitedMs })}；請在 AI 設定改選其他模型，或稍後再試。`,
          didRetry,
        };
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.ok) return { res, didRetry, bodyPayload };
    const bodyText = await res.text();
    if (res.status === 400 && !effortDropped && bodyPayload.reasoning_effort && /reasoning_effort/i.test(bodyText)) {
      effortDropped = true;
      didRetry = true;
      const { reasoning_effort: _drop, ...rest } = bodyPayload;
      bodyPayload = rest;
      continue;
    }
    const tokField = ['max_tokens', 'max_completion_tokens'].find((k) => Number(bodyPayload[k]) > SAFE_MAX_TOKENS);
    if (res.status === 400 && !tokensReduced && tokField && /max_tokens|max_completion_tokens|context|too large|maximum/i.test(bodyText)) {
      tokensReduced = true;
      didRetry = true;
      bodyPayload = { ...bodyPayload, [tokField]: SAFE_MAX_TOKENS };
      continue;
    }
    if (UPSTREAM_TIMEOUT_STATUSES.includes(res.status)) {
      const canFallback = effortFallback
        && !timeoutFallbackUsed
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
        modelUnavailable: true,
        outcome: `${res.status} 逾時`,
        error: formatUpstreamFailureMessage(provLabel, res.status, extractUpstreamError(bodyText), didRetry && timeoutFallbackUsed, {
          model: bodyPayload.model,
          effort: bodyPayload.reasoning_effort,
          waitedMs: Date.now() - startedAt,
        }),
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
    const unavailable = MODEL_UNAVAILABLE_STATUSES.includes(res.status);
    return {
      res: null,
      modelUnavailable: unavailable,
      outcome: res.status === 410 ? '410 已下架' : res.status === 404 ? '404 帳號無此模型' : `HTTP ${res.status}`,
      error: formatUpstreamFailureMessage(provLabel, res.status, plan.extracted, didRetry),
      didRetry,
    };
  }
  return { res: null, error: `${provLabel} 回應 HTTP 429`, didRetry: true };
}

/** 解析瀏覽器送來的備援模型（即時清單），去重、排除選定模型、格式檢查、最多 MAX_FALLBACK_MODELS 個。 */
export function parseFallbackModels(raw, selected) {
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const m = part.trim();
    if (!m || m === selected || out.includes(m)) continue;
    if (!/^[A-Za-z0-9._:/-]{2,120}$/.test(m)) continue;
    out.push(m);
    if (out.length >= MAX_FALLBACK_MODELS) break;
  }
  return out;
}

/** SSE 事件是否已帶出 token：contentOnly 時只算正文，否則推理 token 也算（只有角色、空 delta 的事件不算）。 */
function sseHasToken(text, contentOnly = false) {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const d = t.slice(5).trim();
    if (!d || d === '[DONE]') continue;
    let ev;
    try { ev = JSON.parse(d); } catch { continue; }
    const delta = Array.isArray(ev.choices) ? ev.choices[0]?.delta : null;
    const fields = contentOnly ? [delta?.content] : [delta?.content, delta?.reasoning_content, delta?.reasoning];
    if (delta && fields.some((x) => typeof x === 'string' && x.length > 0)) return true;
    if (ev.type === 'content_block_delta') return true;
  }
  return false;
}

/** 非 SSE 的回應內容（例如 200 但本文是錯誤 JSON），截短供失敗訊息顯示。 */
function nonSseSnippet(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('data:') && !l.startsWith(':')).join(' ').slice(0, 200);
}

/**
 * 開始回應後先讀到第一個正文 token 才算這個模型可用；讀到的片段（含之前的推理）原樣重播給呼叫端。
 * 只有推理沒有正文、空串流、錯誤本文或逾時都回報失敗，讓競速繼續等其他模型。
 * 實測 nemotron-3.5-lightning 不理會 reasoning_effort，推理 216 秒用盡 16384 tokens 仍無正文，所以推理 token 不算數。
 */
async function primeSseStream(res, timeoutMs) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const chunks = [];
  let text = '';
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    let timer;
    // read() 在請求被中止（競速落敗）時會 reject；轉成結果物件，避免未處理的 rejection
    const r = remaining > 0
      ? await Promise.race([
        reader.read().catch((error) => ({ error })),
        new Promise((ok) => { timer = setTimeout(() => ok({ timeout: true }), remaining); }),
      ])
      : { timeout: true };
    clearTimeout(timer);
    if (r.error) {
      reader.cancel().catch(() => {});
      return { ok: false, outcome: r.error?.name === 'AbortError' ? '已中止' : String(r.error?.message || r.error).slice(0, 120) };
    }
    if (r.timeout) {
      reader.cancel().catch(() => {});
      const secs = Math.round(timeoutMs / 1000);
      return { ok: false, outcome: sseHasToken(text) ? `${secs} 秒內只有推理、沒有正文` : `開始回應後 ${secs} 秒沒有內容` };
    }
    if (r.done) {
      const raw = nonSseSnippet(text);
      if (sseHasToken(text)) return { ok: false, outcome: '只有推理、沒有正文' };
      return { ok: false, outcome: `回應為空${raw ? `：${raw}` : ''}` };
    }
    chunks.push(r.value);
    // 只保留最後一段文字做判斷，避免長推理累積成巨大字串
    text = (text.length > 8192 ? text.slice(-4096) : text) + dec.decode(r.value, { stream: true });
    if (sseHasToken(text, true)) {
      const replay = new ReadableStream({
        start(c) { for (const x of chunks) c.enqueue(x); },
        async pull(c) {
          const { done, value } = await reader.read();
          if (done) c.close(); else c.enqueue(value);
        },
        cancel() { return reader.cancel(); },
      });
      return { ok: true, res: new Response(replay, { status: res.status, headers: res.headers }) };
    }
  }
}

/**
 * 候選模型請求。非即時清單服務商：只送選定模型（行為與原本相同，含 524 降推理強度）。
 * 即時清單服務商：選定模型先送；它不能用（逾時、524、404、410）或 raceDelayMs 內未開始回應時，並行送出備援模型，
 * 第一個開始回應者勝出、其餘中止。選定模型的其他錯誤（金鑰、配額等）直接停止。
 */
async function fetchWithModelFallback(targetUrl, headers, baseBody, candidates, signal, provLabel, providerId, reasoningEffort, onEffortFallback) {
  const live = Boolean(PROVIDERS[providerId]?.liveModels);
  if (!live) {
    const up = await fetchUpstreamWithRetry(targetUrl, headers, baseBody, signal, provLabel, onEffortFallback);
    return { ...up, model: candidates[0], tried: [] };
  }
  const bodyFor = (m, i) => {
    if (i === 0) return baseBody;
    const { model: _m, reasoning_effort: _e, ...rest } = baseBody;
    return { model: m, ...(sendsReasoningEffort(providerId, m) ? { reasoning_effort: reasoningEffort } : {}), ...rest };
  };
  const startedAt = Date.now();
  const outcomes = new Map();
  const ctrls = new Map();
  return new Promise((resolve) => {
    let settled = false;
    let pending = 0;
    let fallbacksStarted = false;
    let raceTimer = null;
    const primary = candidates[0];
    const primaryNote = () => outcomes.get(primary) || `等待 ${Math.round((Date.now() - startedAt) / 1000)} 秒未開始回應`;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (raceTimer) clearTimeout(raceTimer);
      for (const [m, c] of ctrls) if (m !== result.model) c.abort();
      resolve(result);
    };
    const allFailed = () => {
      const list = candidates.filter((m) => outcomes.has(m)).map((m) => `${m}（${outcomes.get(m)}）`).join('、');
      return {
        res: null,
        tried: candidates.filter((m) => outcomes.has(m)).map((m) => ({ model: m, outcome: outcomes.get(m) })),
        error: `${provLabel} 候選模型都沒有產出分析內容：${list}；請稍後再試，或在 AI 設定按「${AI_CHECK_MODELS_BTN}」後改選其他模型。`,
      };
    };
    const queue = candidates.slice(1).map((m, j) => [m, j + 1]);
    const overallDeadline = startedAt + UPSTREAM_TIMEOUTS.overallMs;
    const fillPool = () => {
      while (!settled && queue.length && pending < FALLBACK_CONCURRENCY + (outcomes.has(primary) ? 0 : 1) && Date.now() < overallDeadline) {
        const [m, i] = queue.shift();
        launch(m, i);
      }
    };
    const afterFailure = (i) => {
      if (i === 0) startFallbacks();
      else if (fallbacksStarted) fillPool();
      if (fallbacksStarted && pending === 0) finish(allFailed());
    };
    const launch = (m, i) => {
      const c = linkedAbort(signal);
      ctrls.set(m, c);
      pending += 1;
      fetchUpstreamWithRetry(targetUrl, headers, bodyFor(m, i), c.signal, provLabel, null, {
        headerTimeoutMs: i === 0 ? UPSTREAM_TIMEOUTS.primaryHeaderMs : UPSTREAM_TIMEOUTS.fallbackHeaderMs,
        effortFallback: false,
      }).then(async (up) => {
        if (up.res && !settled) {
          let primed;
          try {
            primed = await primeSseStream(up.res, Math.max(1000, overallDeadline - Date.now()));
          } catch (e) {
            primed = { ok: false, outcome: String(e?.message || e).slice(0, 120) };
          }
          if (primed.ok) up = { ...up, res: primed.res };
          else up = { res: null, modelUnavailable: true, outcome: primed.outcome };
        } else if (up.res) {
          up.res.body?.cancel?.().catch?.(() => {});
          up = { res: null, outcome: '已中止' };
        }
        pending -= 1;
        if (settled) { up.res?.body?.cancel?.().catch?.(() => {}); return; }
        if (up.res) {
          finish({ ...up, model: m, tried: i === 0 ? [] : [{ model: primary, outcome: primaryNote() }] });
          return;
        }
        outcomes.set(m, up.outcome || '失敗');
        if (i === 0 && !up.modelUnavailable) { finish({ ...up, model: m, tried: [] }); return; }
        afterFailure(i);
      }, (e) => {
        pending -= 1;
        if (settled) return;
        if (signal?.aborted) { settled = true; resolve({ res: null, aborted: true, tried: [] }); return; }
        outcomes.set(m, String(e?.message || e).slice(0, 120));
        afterFailure(i);
      });
    };
    const startFallbacks = () => {
      if (fallbacksStarted || settled) return;
      fallbacksStarted = true;
      fillPool();
    };
    if (candidates.length > 1) raceTimer = setTimeout(startFallbacks, UPSTREAM_TIMEOUTS.raceDelayMs);
    launch(primary, 0);
  });
}

// 可用性驗證：清單列出的模型不一定能用（404、排隊、過載），以極短請求實測「能開始產出 token」才算可用。
// 驗證要求在 perModelMs 內產出正文（推理不算）；maxTokens 留給短推理後的正文
export const PROBE_LIMITS = { maxModels: 40, concurrency: 6, perModelMs: 15000, overallMs: 45000, maxTokens: 512 };

/** 依序以工作池實測模型；回傳可用模型（依開始產出的快慢排序）與每個模型的結果。 */
export async function probeModels(targetUrl, apiKey, models, provCfg) {
  const startedAt = Date.now();
  const results = {};
  const available = [];
  const queue = [...models];
  const reqProfile = provCfg.request;
  const probeOne = async (m) => {
    const ctrl = new AbortController();
    const t0 = Date.now();
    const body = {
      model: m,
      ...(sendsReasoningEffort(provCfg.id, m) ? { reasoning_effort: 'low' } : {}),
      [reqProfile.maxTokensField]: PROBE_LIMITS.maxTokens,
      stream: true,
      messages: [{ role: 'user', content: 'Reply with: ok' }],
    };
    try {
      const up = await fetchUpstreamWithRetry(targetUrl, { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'cf-aig-collect-log-payload': 'false' },
        body, ctrl.signal, provCfg.label, null, { headerTimeoutMs: PROBE_LIMITS.perModelMs, effortFallback: false });
      if (!up.res) { results[m] = up.outcome || '失敗'; return; }
      const primed = await primeSseStream(up.res, Math.max(1000, PROBE_LIMITS.perModelMs - (Date.now() - t0)));
      if (!primed.ok) { results[m] = primed.outcome; return; }
      primed.res.body.cancel().catch(() => {});
      const ms = Date.now() - t0;
      results[m] = `可用（${(ms / 1000).toFixed(1)} 秒開始回應）`;
      available.push({ model: m, ms });
    } catch (e) {
      results[m] = String(e?.message || e).slice(0, 120);
    } finally {
      ctrl.abort();
    }
  };
  const worker = async () => {
    while (queue.length && Date.now() - startedAt < PROBE_LIMITS.overallMs) {
      await probeOne(queue.shift());
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROBE_LIMITS.concurrency, models.length) }, worker));
  for (const m of queue) results[m] = '未驗證（超過驗證時間上限）';
  available.sort((a, b) => a.ms - b.ms);
  return { available: available.map((x) => x.model), results };
}

async function handleProbeModels(req, env, providerId) {
  const provCfg = PROVIDERS[providerId];
  if (!provCfg.liveModels) return json({ ok: false, provider: providerId, error: `${provCfg.label} 不支援模型可用性驗證` }, 400);
  const keyInfo = resolveApiKey(req, env, providerId);
  if (keyInfo.error) return json({ ok: false, provider: providerId, error: keyInfo.error }, 400);
  if (!keyInfo.apiKey) return json({ ok: false, provider: providerId, error: `請先填入 ${provCfg.label} API Key，再驗證模型` }, 400);
  const epCheck = validateEndpointUrl(req.headers.get('x-ai-endpoint'), provCfg.chatUrl);
  if (epCheck.error) return json({ ok: false, provider: providerId, error: epCheck.error }, 400);
  const models = parseFallbackModels(req.headers.get('x-ai-probe-models'), '').slice(0, PROBE_LIMITS.maxModels);
  if (!models.length) return json({ ok: false, provider: providerId, error: '沒有要驗證的模型' }, 400);
  const { available, results } = await probeModels(epCheck.url, keyInfo.apiKey, models, provCfg);
  return json({ ok: true, provider: providerId, available, results, probedAt: Date.now() });
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
    if (reqUrl.searchParams.get('probe') === '1') {
      const removedMsg = removedProviderError(rawProv);
      if (removedMsg) return json({ ok: false, error: removedMsg, code: 'provider_removed' }, 400);
      return handleProbeModels(req, env, normProvider(rawProv));
    }
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
  const { model } = modelEffort;
  const effortSent = sendsReasoningEffort(providerId, model);
  const reasoningEffort = effortSent ? modelEffort.reasoningEffort : 'none';
  const reqProfile = provCfg.request;

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

  const candidates = provCfg.liveModels
    ? [model, ...parseFallbackModels(req.headers.get('x-ai-fallback-models'), model).filter((m) => !SMALL_MODEL_RE.test(m))]
    : [model];

  const upstreamCtrl = new AbortController();
  const enc = new TextEncoder();

  const body = new ReadableStream({
    async start(controller) {
      let outChars = 0;
      let reasoningChars = 0;
      let nonSseText = '';
      let usedModel = model;
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
          ...(effortSent ? { reasoning_effort: reasoningEffort } : {}),
          [reqProfile.maxTokensField]: reqProfile.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...userMessages,
          ],
        };
        const upstream = await fetchWithModelFallback(
          targetUrl,
          upstreamHeaders,
          upstreamBody,
          candidates,
          upstreamCtrl.signal,
          provCfg.label,
          providerId,
          modelEffort.reasoningEffort,
          (fromEffort, toEffort) => {
            effortNote = `（${provCfg.label} 以推理強度 ${fromEffort} 超過 100 秒未回應，已自動改用推理強度 ${toEffort} 重試）\n\n`;
          },
        );
        if (upstream.aborted) return;
        if (!upstream.res) {
          controller.enqueue(enc.encode(`\n\n［AI 分析失敗：${upstream.error}］`));
          return;
        }
        const res = upstream.res;
        usedModel = upstream.model;
        if (upstream.tried.length) {
          const why = upstream.tried.map((t) => `${t.model} ${t.outcome}`).join('、');
          controller.enqueue(enc.encode(`（${provCfg.label} ${why}，已自動改用模型 ${usedModel}）\n\n`));
        }
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
            if (!trimmed.startsWith('data:')) {
              if (trimmed && !trimmed.startsWith(':') && nonSseText.length < 200) nonSseText += (nonSseText ? ' ' : '') + trimmed;
              continue;
            }
            const dataStr = trimmed.slice(5).trim();
            if (!dataStr || dataStr === '[DONE]') continue;
            let ev;
            try { ev = JSON.parse(dataStr); } catch { continue; }
            if (ev.usage && typeof ev.usage === 'object') {
              usageReported = ev.usage;
            }
            const choice = Array.isArray(ev.choices) ? ev.choices[0] : null;
            if (choice) {
              const reasoningText = choice.delta?.reasoning_content ?? choice.delta?.reasoning;
              if (typeof reasoningText === 'string') reasoningChars += reasoningText.length;
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

        if (outChars === 0) {
          const why = reasoningChars > 0
            ? `只輸出推理、沒有正文（結束原因 ${finishReason || '未提供'}，推理約 ${reasoningChars} 字）`
            : `沒有輸出任何內容（結束原因 ${finishReason || '未提供'}${(nonSseText + buf.trim()).trim() ? `；上游回應：${(nonSseText + ' ' + buf.trim()).trim().slice(0, 200)}` : ''}）`;
          controller.enqueue(enc.encode(`\n\n［AI 分析失敗：${provCfg.label} ${usedModel} ${why}；請把推理強度調低或改選其他模型］`));
        } else if (finishReason === 'length' || finishReason === 'max_tokens') {
          controller.enqueue(enc.encode('\n\n（回覆已達長度上限，內容可能不完整）'));
        }

        const inTok = usageReported?.prompt_tokens ?? usageReported?.input_tokens ?? estInputTokens;
        const outTok = usageReported?.completion_tokens ?? usageReported?.output_tokens ?? Math.max(50, Math.ceil(outChars / 2));
        await recordUsage(env?.DB, keys, inTok, outTok, Date.now(), provCfg, usedModel);
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
