import { validatePayload, buildMessages, SYSTEM_PROMPT, InputError } from '../lib/analyze-core.mjs';

// 預設模型為 OpenAI gpt-6.1-terra（可用環境變數 AI_MODEL 覆寫），推理強度預設為 high。
// max_completion_tokens 需容納高強度推理 tokens 與約 600–900 字繁中工程診斷回覆。
export const DEFAULT_MODEL = 'gpt-6.1-terra';
export const DEFAULT_REASONING_EFFORT = 'high';
export const MAX_TOKENS = 16000;
export const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

// gpt-6.1-terra 定價（USD / 百萬 tokens）：輸入 $1.00、輸出（含推理）$5.00
export const INPUT_PRICE_PER_M = 1.0;
export const OUTPUT_PRICE_PER_M = 5.0;

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

async function readQuotaAndUsage(db, user, now = new Date()) {
  const { day, month } = utc8Periods(now);
  const kDayReq = `ai:d:${user}:${day}:req`;
  const kMonReq = `ai:m:${user}:${month}:req`;
  const kMonIn = `ai:m:${user}:${month}:in_tok`;
  const kMonOut = `ai:m:${user}:${month}:out_tok`;
  const kMonCost = `ai:m:${user}:${month}:ucost`;
  const kLimits = `ai_limits:${user}`;

  let limits = { ...DEFAULT_LIMITS };
  const usage = {
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
    return { limits, usage, keys: { kDayReq, kMonReq, kMonIn, kMonOut, kMonCost, kLimits } };
  }

  try {
    const { results = [] } = await db.prepare(
      `SELECT key, value FROM stats WHERE key IN (?, ?, ?, ?, ?)`
    ).bind(kDayReq, kMonReq, kMonIn, kMonOut, kMonCost).all();
    const map = new Map(results.map(r => [r.key, Number(r.value) || 0]));
    usage.dailyRequests = map.get(kDayReq) || 0;
    usage.monthlyRequests = map.get(kMonReq) || 0;
    usage.monthlyInputTokens = map.get(kMonIn) || 0;
    usage.monthlyOutputTokens = map.get(kMonOut) || 0;
    usage.monthlyTotalTokens = usage.monthlyInputTokens + usage.monthlyOutputTokens;
    const ucost = map.get(kMonCost) || Math.round(
      usage.monthlyInputTokens * INPUT_PRICE_PER_M + usage.monthlyOutputTokens * OUTPUT_PRICE_PER_M
    );
    usage.monthlyUsd = Math.round((ucost / 1e6) * 10000) / 10000;
  } catch {}

  try {
    const row = await db.prepare(`SELECT value FROM system_settings WHERE key = ? LIMIT 1`).bind(kLimits).first();
    if (row && row.value) {
      limits = sanitizeLimits(JSON.parse(row.value));
    }
  } catch {}

  return { limits, usage, keys: { kDayReq, kMonReq, kMonIn, kMonOut, kMonCost, kLimits } };
}

async function saveUserLimits(db, user, limits) {
  const cleanLim = sanitizeLimits(limits);
  if (db && typeof db.prepare === 'function') {
    const kLimits = `ai_limits:${user}`;
    await db.prepare(
      `INSERT INTO system_settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).bind(kLimits, JSON.stringify(cleanLim)).run();
  }
  return cleanLim;
}

async function recordUsage(db, keys, inTokens, outTokens, nowMs = Date.now()) {
  if (!db || typeof db.prepare !== 'function') return;
  const inT = Math.max(0, Math.round(Number(inTokens) || 0));
  const outT = Math.max(0, Math.round(Number(outTokens) || 0));
  // 1 input token = 1 micro-USD ($1/1M), 1 output token = 5 micro-USD ($5/1M)
  const ucost = Math.round(inT * INPUT_PRICE_PER_M + outT * OUTPUT_PRICE_PER_M);
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

function resolveApiKey(req, env) {
  const headerKey = (req.headers.get('x-openai-key') || '').trim();
  if (headerKey) {
    if (headerKey.length < 8 || headerKey.length > 256 || /[\u0000-\u0020]/.test(headerKey)) {
      return { error: 'OpenAI API Key 格式不正確（不可包含空白或控制字元）' };
    }
    return { apiKey: headerKey, source: 'user' };
  }
  const envKey = String(env?.OPENAI_API_KEY || env?.ANTHROPIC_API_KEY || '').trim();
  if (envKey) return { apiKey: envKey, source: 'server' };
  return { apiKey: '', source: 'none' };
}

export async function handleAnalyze(req, env = {}, userArg = '') {
  if (env && env.AI_ENABLED === 'false') {
    return json({ error: '管理員已停用 AI 分析功能' }, 403);
  }
  const model = env?.AI_MODEL || DEFAULT_MODEL;
  const reasoningEffort = env?.AI_REASONING_EFFORT || DEFAULT_REASONING_EFFORT;
  const logPayload = env?.AI_LOG_PAYLOAD === 'true';
  const user = normUser(req, userArg);
  const hasServerKey = Boolean(String(env?.OPENAI_API_KEY || env?.ANTHROPIC_API_KEY || '').trim());

  if (req.method === 'GET') {
    const { limits, usage } = await readQuotaAndUsage(env?.DB, user);
    return json({
      ok: true,
      provider: 'openai',
      model,
      reasoningEffort,
      hasServerKey,
      gateway: true,
      logPayload,
      limits,
      usage,
      pricing: { inputPerM: INPUT_PRICE_PER_M, outputPerM: OUTPUT_PRICE_PER_M },
    });
  }

  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return json({ error: '不接受其他網站的請求' }, 403);

  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return json({ error: '設定內容必須為有效的 JSON' }, 400); }
    const saved = await saveUserLimits(env?.DB, user, body?.limits || body || {});
    const { usage } = await readQuotaAndUsage(env?.DB, user);
    return json({ ok: true, limits: saved, usage });
  }

  if (req.method !== 'POST') return json({ error: '只接受 GET、PUT 或 POST' }, 405);

  const keyInfo = resolveApiKey(req, env);
  if (keyInfo.error) return json({ error: keyInfo.error }, 400);
  if (!keyInfo.apiKey) {
    return json({ error: '請先在「API 金鑰與使用量設定」填入您的 OpenAI API Key（sk-...）' }, 400);
  }

  let payload;
  const rawBody = await req.text();
  try { payload = validatePayload(rawBody); }
  catch (e) { if (e instanceof InputError) return json({ error: e.message }, 400); throw e; }

  const { limits: dbLimits, usage, keys } = await readQuotaAndUsage(env?.DB, user);
  const hdrLimits = parseHeaderLimits(req);
  const activeLimits = hdrLimits ? {
    dailyReqLimit: Math.min(dbLimits.dailyReqLimit, hdrLimits.dailyReqLimit),
    monthlyTokenLimit: Math.min(dbLimits.monthlyTokenLimit, hdrLimits.monthlyTokenLimit),
    monthlyUsdLimit: Math.min(dbLimits.monthlyUsdLimit, hdrLimits.monthlyUsdLimit),
  } : dbLimits;

  if (usage.dailyRequests >= activeLimits.dailyReqLimit) {
    return json({
      error: `已達今日 AI 分析次數上限（${usage.dailyRequests} / ${activeLimits.dailyReqLimit} 次）。請於明日再試，或在設定介面調高每日上限。`,
      code: 'daily_limit_exceeded',
      usage,
      limits: activeLimits,
    }, 429);
  }
  if (usage.monthlyTotalTokens >= activeLimits.monthlyTokenLimit) {
    return json({
      error: `已達本月累計 Token 使用上限（${usage.monthlyTotalTokens.toLocaleString()} / ${activeLimits.monthlyTokenLimit.toLocaleString()} tokens）。請在設定介面調整上限。`,
      code: 'monthly_token_limit_exceeded',
      usage,
      limits: activeLimits,
    }, 429);
  }
  if (usage.monthlyUsd >= activeLimits.monthlyUsdLimit) {
    return json({
      error: `已達本月預估費用上限（$${usage.monthlyUsd.toFixed(2)} / $${activeLimits.monthlyUsdLimit.toFixed(2)} USD）。請在設定介面調整上限。`,
      code: 'monthly_usd_limit_exceeded',
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
      try {
        const res = await fetch(OPENAI_CHAT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${keyInfo.apiKey}`,
            ...(logPayload ? {} : { 'cf-aig-collect-log-payload': 'false' }),
          },
          body: JSON.stringify({
            model,
            reasoning_effort: reasoningEffort,
            max_completion_tokens: MAX_TOKENS,
            stream: true,
            stream_options: { include_usage: true },
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              ...userMessages,
            ],
          }),
          signal: upstreamCtrl.signal,
        });

        if (!res.ok) {
          let errMsg = `OpenAI 回應 HTTP ${res.status}`;
          try {
            const errJson = await res.json();
            if (errJson?.error?.message) errMsg = `${res.status} ${errJson.error.message}`;
          } catch {}
          controller.enqueue(enc.encode(`\n\n［AI 分析失敗：${errMsg}］`));
          return;
        }

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
        await recordUsage(env?.DB, keys, inTok, outTok);
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
      'X-AI-Model': model,
      'X-AI-Reasoning-Effort': reasoningEffort,
    },
  });
}
