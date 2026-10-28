// Cloudflare /api/analyze 的 OpenAI gpt-6.1-terra 串接、推理強度 high、API Key 與雙維度使用量限額測試：攔截 fetch，不呼叫真模型。
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAnalyze, DEFAULT_MODEL, DEFAULT_REASONING_EFFORT, MAX_TOKENS, OPENAI_CHAT_URL, DEFAULT_LIMITS } from '../cloudflare/ai.mjs';

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

const ENV = { OPENAI_API_KEY: 'key' };
const USER = { id: 'u1', email: 'test@example.com' };
const BODY = JSON.stringify({ payload: { 系統偵測問題清單: [{ 問題: '體積偏低', 事實: ['平均 82%'] }] } });

// 最小的 OpenAI Chat Completions 串流回應：一段文字 + usage + [DONE]
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

test('AI 預設模型為 gpt-6.1-terra 且推理能力為 high，GET 健康檢查回報同一模型與限額', async () => {
  assert.equal(DEFAULT_MODEL, 'gpt-6.1-terra');
  assert.equal(DEFAULT_REASONING_EFFORT, 'high');
  const res = await handleAnalyze(new Request('https://spi.example/api/analyze'), ENV, USER);
  const data = await res.json();
  assert.equal(data.provider, 'openai');
  assert.equal(data.model, 'gpt-6.1-terra');
  assert.equal(data.reasoningEffort, 'high');
  assert.equal(data.hasServerKey, true);
  assert.deepEqual(data.limits, DEFAULT_LIMITS);
});

test('送往 OpenAI 的請求使用預設模型 gpt-6.1-terra、reasoning_effort: high 與足夠的 max_completion_tokens', async () => {
  const { res, text, calls } = await postWithCapture(ENV);
  assert.equal(res.status, 200);
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

test('使用者透過 X-OpenAI-Key 帶入自訂 API Key 時，優先使用使用者金鑰（無需伺服器設定）', async () => {
  const { res, calls } = await postWithCapture({}, { headers: { 'X-OpenAI-Key': 'user-custom-key' } });
  assert.equal(res.status, 200);
  assert.equal(calls[0].headers.Authorization, 'Bearer user-custom-key');
});

test('未提供使用者 API Key 且伺服器未設定金鑰時，回傳 400 引導填寫金鑰（不再回 503 Gateway 未設定）', async () => {
  const req = new Request('https://spi.example/api/analyze', { method: 'POST', body: BODY });
  const res = await handleAnalyze(req, {}, USER);
  assert.equal(res.status, 400);
  const err = await res.json();
  assert.match(err.error, /OpenAI API Key/);
});

test('AI_MODEL 環境變數可覆寫預設模型', async () => {
  const { res, calls } = await postWithCapture({ ...ENV, AI_MODEL: 'gpt-6.1-terra-mini' });
  assert.equal(res.headers.get('X-AI-Model'), 'gpt-6.1-terra-mini');
  assert.equal(calls[0].body.model, 'gpt-6.1-terra-mini');
});

test('回覆達 length 上限時附加截斷提示', async () => {
  const { text } = await postWithCapture(ENV, { finishReason: 'length' });
  assert.match(text, /回覆已達長度上限/);
});

test('D1 使用量追蹤與雙維度限額攔截（每日次數 + 每月 Token / 預估費用 USD）', async () => {
  const DB = createD1Stub();
  const envWithDb = { ...ENV, DB };

  // 1. 透過 PUT /api/analyze 設定限額：每日上限 2 次、每月 Token 上限 5000、每月 USD 上限 $1.00
  const putReq = new Request('https://spi.example/api/analyze', {
    method: 'PUT',
    body: JSON.stringify({ limits: { dailyReqLimit: 2, monthlyTokenLimit: 5000, monthlyUsdLimit: 1.0 } }),
  });
  const putRes = await handleAnalyze(putReq, envWithDb, USER);
  assert.equal(putRes.status, 200);
  const putData = await putRes.json();
  assert.equal(putData.limits.dailyReqLimit, 2);
  assert.equal(putData.limits.monthlyTokenLimit, 5000);

  // 2. 第 1 次呼叫（消耗 2000 tokens）：成功
  const r1 = await postWithCapture(envWithDb, { usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 } });
  assert.equal(r1.res.status, 200);

  // 3. 第 2 次呼叫（消耗 2000 tokens，累計 4000 tokens）：成功
  const r2 = await postWithCapture(envWithDb, { usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 } });
  assert.equal(r2.res.status, 200);

  // 4. 第 3 次呼叫：超過每日呼叫次數上限 (2/2)，應回傳 429
  const r3 = await postWithCapture(envWithDb);
  assert.equal(r3.res.status, 429);
  const err3 = JSON.parse(r3.text);
  assert.equal(err3.code, 'daily_limit_exceeded');
  assert.equal(err3.usage.dailyRequests, 2);
  assert.equal(err3.usage.monthlyTotalTokens, 4000);

  // 5. 調高每日次數上限至 10，但把每月 Token 上限調為 3500（低於目前已用 4000），應觸發每月 Token 上限 429
  await handleAnalyze(new Request('https://spi.example/api/analyze', {
    method: 'PUT',
    body: JSON.stringify({ limits: { dailyReqLimit: 10, monthlyTokenLimit: 3500, monthlyUsdLimit: 10.0 } }),
  }), envWithDb, USER);
  const r4 = await postWithCapture(envWithDb);
  assert.equal(r4.res.status, 429);
  const err4 = JSON.parse(r4.text);
  assert.equal(err4.code, 'monthly_token_limit_exceeded');
});
