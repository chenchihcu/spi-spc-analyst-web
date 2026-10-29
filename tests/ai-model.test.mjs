// Cloudflare /api/analyze 的多平台 (OpenAI / Antigravity) API Key、模型選單、推理強度選單、自訂 Endpoint 與各平台獨立雙維度使用量限額測試：攔截 fetch，不呼叫真模型。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleAnalyze,
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
  ALLOWED_EFFORTS,
  MAX_TOKENS,
  OPENAI_CHAT_URL,
  ANTIGRAVITY_CHAT_URL,
  PROVIDERS,
  DEFAULT_LIMITS,
  extractUpstreamError,
  planUpstreamRetry,
  modelsUrlFromChatUrl,
} from '../cloudflare/ai.mjs';

function createD1Stub() {
  const settings = new Map();
  const stats = new Map();
  return {
    prepare(sql) {
      let bound = [];
      const stmt = {
        bind(...args) { bound = args; return stmt; },
        async first() {
          if (sql.includes('FROM system_settings WHERE key = ?')) {
            const val = settings.get(bound[0]);
            return val !== undefined ? { value: val } : null;
          }
          if (sql.includes('FROM stats WHERE key = ?')) {
            const val = stats.get(bound[0]);
            return val !== undefined ? { value: val } : null;
          }
          return null;
        },
        async all() {
          if (sql.includes('FROM stats WHERE key IN')) {
            const results = bound.filter(k => stats.has(k)).map(k => ({ key: k, value: stats.get(k) }));
            return { results };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes('INTO system_settings')) {
            settings.set(bound[0], bound[1]);
          } else if (sql.includes('INTO stats')) {
            const k = bound[0], delta = Number(bound[1] || 0);
            stats.set(k, (stats.get(k) || 0) + delta);
          }
          return { success: true };
        },
      };
      return stmt;
    },
    async batch(stmts) {
      for (const s of stmts) await s.run();
      return [];
    },
  };
}

const ENV = { OPENAI_API_KEY: 'key', ANTIGRAVITY_API_KEY: 'agy' };
const USER = { id: 'u1', email: 'test@example.com' };
const BODY = JSON.stringify({ payload: { 系統偵測問題清單: [{ 問題: '體積偏低', 事實: ['平均 82%'] }] } });

// 最小的 OpenAI Chat Completions 相容串流回應：一段文字 + usage + [DONE]
const sse = (model, text, finishReason = 'stop', usage = { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 }) => [
  { id: 'chatcmpl-1', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
  { id: 'chatcmpl-1', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage },
].map((d) => `data: ${JSON.stringify(d)}\n\n`).join('') + 'data: [DONE]\n\n';

async function postWithCapture(env, { finishReason = 'stop', headers = {}, body = BODY, user = USER, usage } = {}) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const sent = JSON.parse(init.body);
    calls.push({ url: String(url), headers: init.headers, body: sent });
    return new Response(sse(sent.model, '分析結果', finishReason, usage), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const req = new Request('https://spi.example/api/analyze', { method: 'POST', headers, body });
    const res = await handleAnalyze(req, env, user);
    return { res, text: await res.text(), calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function withFetch(impl, fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
}

test('AI 預設模型為 gpt-6.1-terra 且推理能力為 high，GET 健康檢查回報各平台狀態與允許推理強度', async () => {
  assert.equal(DEFAULT_MODEL, 'gpt-6.1-terra');
  assert.equal(DEFAULT_REASONING_EFFORT, 'high');
  assert.deepEqual(ALLOWED_EFFORTS, ['high', 'medium', 'low']);
  assert.deepEqual(Object.keys(PROVIDERS), ['openai', 'antigravity']);
  assert.ok(!PROVIDERS.openai.models.includes('gpt-6.1-terra-mini'), 'gpt-6.1-terra-mini 已證實不存在，不可列入型錄');

  const res = await handleAnalyze(new Request('https://spi.example/api/analyze'), ENV, USER);
  const data = await res.json();
  assert.equal(data.provider, 'openai');
  assert.equal(data.model, 'gpt-6.1-terra');
  assert.equal(data.reasoningEffort, 'high');
  assert.deepEqual(data.allowedEfforts, ['high', 'medium', 'low']);
  assert.equal(data.hasServerKey, true);
  assert.deepEqual(data.limits, DEFAULT_LIMITS);
  assert.deepEqual(Object.keys(data.providers), ['openai', 'antigravity']);
  assert.equal(data.providers.antigravity.defaultModel, 'gemini-3.1-pro-preview');
});

test('送往 OpenAI 的請求使用預設模型 gpt-6.1-terra、reasoning_effort: high 與足夠的 max_completion_tokens', async () => {
  const { res, text, calls } = await postWithCapture(ENV);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-AI-Provider'), 'openai');
  assert.equal(res.headers.get('X-AI-Model'), 'gpt-6.1-terra');
  assert.equal(res.headers.get('X-AI-Reasoning-Effort'), 'high');
  assert.equal(text, '分析結果');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OPENAI_CHAT_URL);
  assert.equal(calls[0].headers.Authorization, 'Bearer key');
  assert.equal(calls[0].body.model, 'gpt-6.1-terra');
  assert.equal(calls[0].body.reasoning_effort, 'high');
  assert.equal(calls[0].body.stream, true);
  assert.deepEqual(calls[0].body.stream_options, { include_usage: true });
  assert.equal(calls[0].body.max_completion_tokens, MAX_TOKENS);
  assert.ok(MAX_TOKENS >= 16000, `max_completion_tokens 過低會截斷回覆，實為 ${MAX_TOKENS}`);
});

test('Antigravity 平台切換：正確轉發對應端點、預設模型與專屬金鑰標頭；已移除的 Cursor 回 400 且不呼叫上游', async () => {
  // Antigravity 平台
  const rAgy = await postWithCapture({}, {
    headers: { 'X-AI-Provider': 'antigravity', 'X-Antigravity-Key': 'user-agy-key' },
  });
  assert.equal(rAgy.res.status, 200);
  assert.equal(rAgy.res.headers.get('X-AI-Provider'), 'antigravity');
  assert.equal(rAgy.res.headers.get('X-AI-Model'), 'gemini-3.1-pro-preview');
  assert.equal(rAgy.calls[0].url, ANTIGRAVITY_CHAT_URL);
  assert.equal(rAgy.calls[0].headers.Authorization, 'Bearer user-agy-key');
  assert.equal(rAgy.calls[0].body.model, 'gemini-3.1-pro-preview');

  // 舊前端設定仍送 Cursor：api.cursor.com 沒有 Chat Completions 路由，必須在呼叫上游前擋下，不可默默改送 OpenAI
  const rCur = await postWithCapture(ENV, {
    headers: { 'X-AI-Provider': 'cursor', 'X-Cursor-Key': 'user-cur-key', 'X-AI-Key': 'user-cur-key' },
  });
  assert.equal(rCur.res.status, 400);
  assert.equal(JSON.parse(rCur.text).code, 'provider_removed');
  assert.match(JSON.parse(rCur.text).error, /Cursor/);
  assert.equal(rCur.calls.length, 0);
});

test('模型與推理強度選單覆寫驗證，以及自訂 HTTPS Endpoint 與 SSRF 防護', async () => {
  // 合法自訂 HTTPS Endpoint + low 推理強度
  const rCustom = await postWithCapture(ENV, {
    headers: {
      'X-AI-Model': 'o4-mini',
      'X-AI-Reasoning-Effort': 'low',
      'X-AI-Endpoint': 'https://gateway.example.com/v1/chat/completions',
    },
  });
  assert.equal(rCustom.res.status, 200);
  assert.equal(rCustom.calls[0].url, 'https://gateway.example.com/v1/chat/completions');
  assert.equal(rCustom.calls[0].body.model, 'o4-mini');
  assert.equal(rCustom.calls[0].body.reasoning_effort, 'low');

  // 非法推理強度應回傳 400
  const rBadEffort = await postWithCapture(ENV, { headers: { 'X-AI-Reasoning-Effort': 'extreme' } });
  assert.equal(rBadEffort.res.status, 400);

  // SSRF 防護：拒絕非 https 或內網位址
  for (const badUrl of ['http://api.openai.com/v1/chat', 'https://localhost:8080/v1', 'https://127.0.0.1/v1', 'https://192.168.1.1/v1']) {
    const rBadUrl = await postWithCapture(ENV, { headers: { 'X-AI-Endpoint': badUrl } });
    assert.equal(rBadUrl.res.status, 400, `應拒絕不安全端點 ${badUrl}`);
  }
});

test('使用者透過 X-OpenAI-Key 帶入自訂 API Key 時，優先使用使用者金鑰（無需伺服器設定）', async () => {
  const { res, calls } = await postWithCapture({}, { headers: { 'X-OpenAI-Key': 'user-custom-key' } });
  assert.equal(res.status, 200);
  assert.equal(calls[0].headers.Authorization, 'Bearer user-custom-key');
});

test('未提供使用者 API Key 且伺服器未設定金鑰時，回傳 400 引導填寫對應平台金鑰', async () => {
  const req = new Request('https://spi.example/api/analyze', { method: 'POST', headers: { 'X-AI-Provider': 'antigravity' }, body: BODY });
  const res = await handleAnalyze(req, {}, USER);
  assert.equal(res.status, 400);
  const err = await res.json();
  assert.match(err.error, /Antigravity API Key/);
});

test('AI_MODEL 環境變數可覆寫預設模型', async () => {
  const { res, calls } = await postWithCapture({ ...ENV, AI_MODEL: 'o4-mini' });
  assert.equal(res.headers.get('X-AI-Model'), 'o4-mini');
  assert.equal(calls[0].body.model, 'o4-mini');
});

test('回覆達 length 上限時附加截斷提示', async () => {
  const { text } = await postWithCapture(ENV, { finishReason: 'length' });
  assert.match(text, /回覆已達長度上限/);
});

test('D1 各平台獨立使用量追蹤與雙維度限額攔截（OpenAI 額滿不阻擋 Antigravity）', async () => {
  const DB = createD1Stub();
  const envWithDb = { ...ENV, DB };

  // 1. 透過 PUT /api/analyze 設定 OpenAI 限額：每日上限 2 次、每月 Token 上限 5000、每月 USD 上限 $1.00
  const putReq = new Request('https://spi.example/api/analyze', {
    method: 'PUT',
    body: JSON.stringify({ provider: 'openai', limits: { dailyReqLimit: 2, monthlyTokenLimit: 5000, monthlyUsdLimit: 1.0 } }),
  });
  const putRes = await handleAnalyze(putReq, envWithDb, USER);
  assert.equal(putRes.status, 200);
  const putData = await putRes.json();
  assert.equal(putData.limits.dailyReqLimit, 2);
  assert.equal(putData.limits.monthlyTokenLimit, 5000);

  // 2. OpenAI 第 1、2 次呼叫（各消耗 2000 tokens）：成功
  const r1 = await postWithCapture(envWithDb, { usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 } });
  assert.equal(r1.res.status, 200);
  const r2 = await postWithCapture(envWithDb, { usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 } });
  assert.equal(r2.res.status, 200);

  // 3. OpenAI 第 3 次呼叫：超過每日呼叫次數上限 (2/2)，應回傳 429
  const r3 = await postWithCapture(envWithDb);
  assert.equal(r3.res.status, 429);
  const err3 = JSON.parse(r3.text);
  assert.equal(err3.code, 'daily_limit_exceeded');
  assert.equal(err3.provider, 'openai');
  assert.equal(err3.usage.dailyRequests, 2);
  assert.equal(err3.usage.monthlyTotalTokens, 4000);

  // 4. 此時切換至 Antigravity 平台，獨立配額未滿，應正常 200 通過並獨立計數
  const rAgy = await postWithCapture(envWithDb, {
    headers: { 'X-AI-Provider': 'antigravity' },
    usage: { prompt_tokens: 600, completion_tokens: 400, total_tokens: 1000 },
  });
  assert.equal(rAgy.res.status, 200);
  const agyGet = await handleAnalyze(new Request('https://spi.example/api/analyze?provider=antigravity'), envWithDb, USER);
  const agyData = await agyGet.json();
  assert.equal(agyData.provider, 'antigravity');
  assert.equal(agyData.usage.dailyRequests, 1);
  assert.equal(agyData.usage.monthlyTotalTokens, 1000);
  assert.equal(agyData.providers.openai.usage.dailyRequests, 2);

  // 5. 調高 OpenAI 每日次數上限至 10，但把每月 Token 上限調為 3500（低於目前已用 4000），應觸發每月 Token 上限 429
  await handleAnalyze(new Request('https://spi.example/api/analyze', {
    method: 'PUT',
    body: JSON.stringify({ provider: 'openai', limits: { dailyReqLimit: 10, monthlyTokenLimit: 3500, monthlyUsdLimit: 10.0 } }),
  }), envWithDb, USER);
  const r4 = await postWithCapture(envWithDb);
  assert.equal(r4.res.status, 429);
  const err4 = JSON.parse(r4.text);
  assert.equal(err4.code, 'monthly_token_limit_exceeded');
});

test('extractUpstreamError 支援 Gemini 陣列與 OpenAI 物件', () => {
  const fromArray = extractUpstreamError('[{"error":{"message":"Resource has been exhausted (e.g. check quota).","code":429}}]');
  assert.equal(fromArray.message, 'Resource has been exhausted (e.g. check quota).');
  const fromObject = extractUpstreamError('{"error":{"message":"You exceeded your current quota"}}');
  assert.equal(fromObject.message, 'You exceeded your current quota');
  const limitZero = extractUpstreamError('{"error":{"message":"Quota exceeded, limit: 0, model: gemini-3.1-pro"}}');
  assert.equal(limitZero.hasLimitZero, true);
  assert.equal(planUpstreamRetry({ status: 429, headers: new Headers(), bodyText: limitZero.bodyText, attemptIndex: 0 }).retry, false);
});

test('Antigravity 429 陣列錯誤本文：解析上游 message 且不盲目重試 limit: 0', async () => {
  const gemini429 = JSON.stringify([{
    error: {
      code: 429,
      message: 'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-pro',
      status: 'RESOURCE_EXHAUSTED',
    },
  }]);
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(gemini429, { status: 429, headers: { 'content-type': 'application/json' } });
  };
  try {
    const req = new Request('https://spi.example/api/analyze', {
      method: 'POST',
      headers: { 'X-AI-Provider': 'antigravity', 'X-Antigravity-Key': 'user-agy-key' },
      body: BODY,
    });
    const res = await handleAnalyze(req, {}, USER);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.equal(calls, 1);
    assert.match(text, /429 Quota exceeded/);
    assert.match(text, /Google AI Studio/);
    assert.doesNotMatch(text, /Antigravity 回應 HTTP 429］/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('短暫 429 配合 Retry-After: 0 自動重試後成功', async () => {
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: 'Rate limit', status: 'RESOURCE_EXHAUSTED' } }), {
        status: 429,
        headers: { 'Retry-After': '0' },
      });
    }
    const sent = JSON.parse(init.body);
    return new Response(sse(sent.model, '分析結果'), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const req = new Request('https://spi.example/api/analyze', {
      method: 'POST',
      headers: { 'X-AI-Provider': 'antigravity', 'X-Antigravity-Key': 'user-agy-key' },
      body: BODY,
    });
    const res = await handleAnalyze(req, {}, USER);
    const text = await res.text();
    assert.equal(calls, 2);
    assert.equal(text, '分析結果');
    assert.doesNotMatch(text, /［AI 分析失敗/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('OpenAI 形狀 { error: { message } } 的 429 可讀取 message', async () => {
  const errBody = JSON.stringify({ error: { message: 'You exceeded your current quota', type: 'insufficient_quota' } });
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(errBody, { status: 429, headers: { 'Retry-After': '120' } });
  };
  try {
    const req = new Request('https://spi.example/api/analyze', { method: 'POST', headers: { 'X-OpenAI-Key': 'user-custom-key' }, body: BODY });
    const res = await handleAnalyze(req, {}, USER);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.equal(calls, 1);
    assert.match(text, /You exceeded your current quota/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('modelsUrlFromChatUrl：…/chat/completions 轉為 …/models，其他形狀回 null', () => {
  assert.equal(modelsUrlFromChatUrl(OPENAI_CHAT_URL), 'https://api.openai.com/v1/models');
  assert.equal(modelsUrlFromChatUrl(ANTIGRAVITY_CHAT_URL), 'https://generativelanguage.googleapis.com/v1beta/openai/models');
  assert.equal(modelsUrlFromChatUrl('https://gateway.example.com/v1/responses'), null);
  assert.equal(modelsUrlFromChatUrl('not a url'), null);
});

test('GET ?models=1 以使用者金鑰查詢上游可用模型（OpenAI 與 Antigravity，去掉 models/ 前綴）', async () => {
  const calls = [];
  const upstream = async (url, init) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization });
    const data = String(url).includes('googleapis')
      ? [{ id: 'models/gemini-3.1-pro-preview' }, { id: 'models/gemini-3.0-flash' }]
      : [{ id: 'o4-mini' }, { id: 'gpt-6.1-terra' }, { id: 'o4-mini' }];
    return Response.json({ object: 'list', data });
  };
  await withFetch(upstream, async () => {
    const rOai = await handleAnalyze(new Request('https://spi.example/api/analyze?models=1&provider=openai', {
      headers: { 'X-OpenAI-Key': 'user-oai-key' },
    }), {}, USER);
    assert.equal(rOai.status, 200);
    assert.deepEqual(await rOai.json(), { ok: true, provider: 'openai', models: ['gpt-6.1-terra', 'o4-mini'] });

    const rAgy = await handleAnalyze(new Request('https://spi.example/api/analyze?models=1&provider=antigravity', {
      headers: { 'X-Antigravity-Key': 'user-agy-key' },
    }), {}, USER);
    assert.deepEqual((await rAgy.json()).models, ['gemini-3.0-flash', 'gemini-3.1-pro-preview']);
  });
  assert.deepEqual(calls, [
    { url: 'https://api.openai.com/v1/models', auth: 'Bearer user-oai-key' },
    { url: 'https://generativelanguage.googleapis.com/v1beta/openai/models', auth: 'Bearer user-agy-key' },
  ]);
});

test('GET ?models=1：無金鑰 400、上游 401 回 502 並帶上游訊息、Cursor 回 provider_removed、自訂端點非標準路徑回 models:null', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return Response.json({ error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }, { status: 401 });
  }, async () => {
    const rNoKey = await handleAnalyze(new Request('https://spi.example/api/analyze?models=1&provider=openai'), {}, USER);
    assert.equal(rNoKey.status, 400);
    assert.match((await rNoKey.json()).error, /OpenAI API Key/);

    const rBad = await handleAnalyze(new Request('https://spi.example/api/analyze?models=1&provider=openai', {
      headers: { 'X-OpenAI-Key': 'user-oai-key' },
    }), {}, USER);
    assert.equal(rBad.status, 502);
    const bad = await rBad.json();
    assert.equal(bad.ok, false);
    assert.match(bad.error, /401 Incorrect API key provided/);

    const rCur = await handleAnalyze(new Request('https://spi.example/api/analyze?models=1&provider=cursor'), ENV, USER);
    assert.equal(rCur.status, 400);
    assert.equal((await rCur.json()).code, 'provider_removed');

    const rCustom = await handleAnalyze(new Request('https://spi.example/api/analyze?models=1&provider=openai', {
      headers: { 'X-OpenAI-Key': 'user-oai-key', 'X-AI-Endpoint': 'https://gateway.example.com/v1/responses' },
    }), {}, USER);
    assert.deepEqual(await rCustom.json(), { ok: true, provider: 'openai', models: null, reason: 'custom_endpoint' });
  });
  assert.equal(calls, 1, '只有帶金鑰的標準端點會呼叫上游');
});

test('上游 404 模型不存在與路由不存在：串流失敗訊息附上修正指引', async () => {
  const cases = [
    {
      body: { error: { message: 'The model `gpt-6.1-terra-mini` does not exist or you do not have access to it.', type: 'invalid_request_error', code: 'model_not_found' } },
      expect: /［AI 分析失敗：404 The model `gpt-6.1-terra-mini` does not exist[^］]*檢查可用模型/,
    },
    {
      body: { message: 'Route POST:/v1/chat/completions not found', error: 'Not Found', statusCode: 404 },
      expect: /［AI 分析失敗：404 Route POST:\/v1\/chat\/completions not found[^］]*自訂 API 端點/,
    },
  ];
  for (const c of cases) {
    let calls = 0;
    await withFetch(async () => { calls += 1; return Response.json(c.body, { status: 404 }); }, async () => {
      const req = new Request('https://spi.example/api/analyze', { method: 'POST', headers: { 'X-OpenAI-Key': 'user-oai-key' }, body: BODY });
      const text = await (await handleAnalyze(req, {}, USER)).text();
      assert.match(text, c.expect);
    });
    assert.equal(calls, 1, '404 不重試');
  }
});
