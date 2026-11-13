// NVIDIA 服務商設定介面：金鑰欄位、即時模型清單「更新模型清單」按鈕（新增／移除／改選／失敗沿用／重新載入後還原）
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { HTML, withIdb } = require("./_load");

let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); } catch { /* 未安裝 jsdom 時略過 */ }

const waitFor = async (cond, label, ms = 20000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("等待逾時：" + label);
    await new Promise((r) => setTimeout(r, 10));
  }
};

function open(store, fetchImpl) {
  const html = fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");
  const errs = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errs.push(e.message));
  const dom = new JSDOM(html, {
    runScripts: "dangerously", virtualConsole: vc, url: "https://example.test/",
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
      w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,";
      w.Element.prototype.scrollIntoView = () => {};
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} };
      w.scrollTo = () => {};
      w.Chart = class { constructor() {} destroy() {} static register() {} };
      withIdb(w);
      for (const [k, v] of Object.entries(store)) w.localStorage.setItem(k, v);
      w.fetch = fetchImpl;
      w.SPI_TEST_HOOK = { bootSample: true };
    },
  });
  const w = dom.window, d = w.document;
  return { w, d, $: (s) => d.querySelector(s), errs };
}

const modelsReply = (models, available = models, results = {}) => async (url) => {
  if (String(url).includes("models=1")) return { ok: true, status: 200, json: async () => ({ ok: true, provider: "nvidia", models }) };
  if (String(url).includes("probe=1")) return { ok: true, status: 200, json: async () => ({ ok: true, provider: "nvidia", available, results }) };
  return { ok: true, status: 200, json: async () => ({ ok: true, providers: {} }) };
};
const optionValues = ($) => [...$("#selAiModel").options].map((o) => o.value);

test("NVIDIA：三個服務商皆有金鑰欄位；更新模型清單會新增、移除、改選，失敗沿用舊清單，重新載入後還原", { skip: !JSDOM && "未安裝 jsdom（npm install）" }, async () => {
  let reply = modelsReply(["openai/gpt-oss-20b", "meta/old-model"]);
  const calls = [];
  const fetchImpl = (url, init) => { calls.push({ url: String(url), headers: (init && init.headers) || {} }); return reply(url, init); };
  const a = open({}, fetchImpl);
  await new Promise((r) => setTimeout(r, 50));
  const { $, d, w } = a;

  for (const id of ["inAiKey", "inAiKeyAntigravity", "inAiKeyNvidia", "btnAiKeyToggleNvidia", "aiBadgeNvidia"]) assert.ok($("#" + id), "需有 #" + id);
  d.querySelector('#aiProviderSeg [data-ai-prov="nvidia"]').click();
  assert.equal($("#btnAiCheckModels").textContent, "更新模型清單");
  assert.equal($("#aiModelListNote").hidden, false);
  assert.equal($("#aiModelListNote").textContent, "尚未更新模型清單");
  assert.deepEqual(optionValues($), ["openai/gpt-oss-20b", "custom"], "未更新前用內建清單");
  assert.equal($("#aiPriceLabel").textContent, "免費帳號不計費，受 NVIDIA 帳號速率與額度限制");
  assert.equal($("#inAiUsdLim").disabled, true, "免費服務商不設定美金上限");

  // 第一次更新取得含 meta/old-model 的清單並選它；第二次更新它已下架：新模型出現、改選仍可用的推薦模型
  $("#inAiKeyNvidia").value = "nvapi-test-key-000000";
  $("#btnAiCheckModels").click();
  await waitFor(() => /驗證 \d+ 個模型/.test($("#aiCfgMsg").textContent), "第一次清單更新與驗證完成");
  $("#selAiModel").value = "meta/old-model";
  $("#selAiModel").dispatchEvent(new w.Event("change"));
  $("#aiCfgMsg").textContent = "";
  reply = modelsReply(["openai/gpt-oss-20b", "meta/llama-next-70b", "nvidia/nemotron-new", "nvidia/nemotron-3-embed-1b"], ["openai/gpt-oss-20b", "meta/llama-next-70b"]);
  $("#btnAiCheckModels").click();
  await waitFor(() => /驗證 \d+ 個模型/.test($("#aiCfgMsg").textContent), "清單更新與驗證完成");
  const probeCall = calls.filter((c) => c.url.includes("probe=1")).pop();
  assert.equal(probeCall.headers["X-AI-Probe-Models"], "openai/gpt-oss-20b,meta/llama-next-70b,nvidia/nemotron-new", "驗證所選模型與對話模型，排除嵌入模型");
  assert.match($("#aiCfgMsg").textContent, /驗證 3 個模型，可用 2 個：openai\/gpt-oss-20b、meta\/llama-next-70b/);
  const call = calls.find((c) => c.url.includes("models=1"));
  assert.match(call.url, /provider=nvidia/);
  assert.equal(call.headers["X-Nvidia-Key"], "nvapi-test-key-000000");
  assert.deepEqual(optionValues($), ["openai/gpt-oss-20b", "meta/llama-next-70b", "nvidia/nemotron-3-embed-1b", "nvidia/nemotron-new", "custom"]);
  assert.equal($("#selAiModel").value, "openai/gpt-oss-20b");
  assert.match($("#aiCfgMsg").textContent, /共 4 個/);
  assert.match($("#aiCfgMsg").textContent, /meta\/old-model 已不在清單，已改選 openai\/gpt-oss-20b/);
  assert.match($("#aiModelListNote").textContent, /^模型清單更新於 \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 4 個模型 · 驗證可用 2 個$/);
  const cached = JSON.parse(w.localStorage.getItem("spi-ai-models"));
  assert.deepEqual(cached.nvidia.models, ["openai/gpt-oss-20b", "meta/llama-next-70b", "nvidia/nemotron-new", "nvidia/nemotron-3-embed-1b"]);
  // 備援模型：即時清單中排除選定模型與非對話模型（嵌入），推薦模型在前
  assert.deepEqual([...w.SPI_TEST_HOOK.aiFallbackModels("nvidia", "openai/gpt-oss-20b")], ["meta/llama-next-70b", "nvidia/nemotron-new"]);
  assert.deepEqual([...w.SPI_TEST_HOOK.aiFallbackModels("nvidia", "meta/llama-next-70b")], ["openai/gpt-oss-20b", "nvidia/nemotron-new"]);
  assert.deepEqual([...w.SPI_TEST_HOOK.aiFallbackModels("openai", "gpt-6.1-terra")], [], "非即時清單服務商不送備援");
  // 曾成功產生分析的模型排在最前；重新整理清單後仍保留
  w.SPI_TEST_HOOK.saveAiGoodModel("nvidia", "nvidia/nemotron-new");
  assert.deepEqual([...w.SPI_TEST_HOOK.aiFallbackModels("nvidia", "openai/gpt-oss-20b")], ["nvidia/nemotron-new", "meta/llama-next-70b"]);
  assert.equal(JSON.stringify(cached).includes("nvapi-"), false, "模型清單快取不得含金鑰");

  // 選即時清單中的新模型：不當成自訂模型，推理強度可選（NVIDIA 所有模型都送 reasoning_effort，預設 low）
  $("#selAiModel").value = "meta/llama-next-70b";
  $("#selAiModel").dispatchEvent(new w.Event("change"));
  assert.equal($("#aiCustomModelField").hidden, true);
  assert.equal($("#selAiEffort").disabled, false);
  assert.equal($("#selAiEffort").value, "low");
  $("#selAiModel").value = "openai/gpt-oss-20b";
  $("#selAiModel").dispatchEvent(new w.Event("change"));
  assert.equal($("#selAiEffort").disabled, false);

  // 上游失敗：清單不變，訊息說明沿用
  reply = async () => ({ ok: false, status: 502, json: async () => ({ ok: false, error: "401 Unauthorized" }) });
  $("#btnAiCheckModels").click();
  await waitFor(() => /更新失敗/.test($("#aiCfgMsg").textContent), "失敗訊息");
  assert.match($("#aiCfgMsg").textContent, /NVIDIA 模型清單更新失敗：401 Unauthorized；沿用上次的清單/);
  assert.deepEqual(optionValues($), ["openai/gpt-oss-20b", "meta/llama-next-70b", "nvidia/nemotron-3-embed-1b", "nvidia/nemotron-new", "custom"]);
  assert.equal($("#btnAiCheckModels").textContent, "更新模型清單");
  assert.equal($("#btnAiCheckModels").disabled, false);

  // 其他服務商維持「檢查可用模型」
  d.querySelector('#aiProviderSeg [data-ai-prov="openai"]').click();
  assert.equal($("#btnAiCheckModels").textContent, "檢查可用模型");
  assert.equal($("#aiModelListNote").hidden, true);
  assert.equal($("#selAiEffort").disabled, false);
  assert.equal($("#inAiUsdLim").disabled, false);
  assert.deepEqual(a.errs, []);

  // 重新載入：從快取還原清單與所選模型
  const store = { "spi-ai-models": w.localStorage.getItem("spi-ai-models"), "spi-ai-config": w.localStorage.getItem("spi-ai-config") };
  const cfg = JSON.parse(store["spi-ai-config"]);
  cfg.activeProvider = "nvidia"; cfg.providers.nvidia.model = "nvidia/nemotron-new";
  store["spi-ai-config"] = JSON.stringify(cfg);
  const b = open(store, modelsReply(["openai/gpt-oss-20b"]));
  await new Promise((r) => setTimeout(r, 50));
  b.w.SPI_TEST_HOOK.setTab("ai");
  await waitFor(() => optionValues(b.$).includes("nvidia/nemotron-new"), "還原清單");
  assert.equal(b.$("#selAiModel").value, "nvidia/nemotron-new");
  assert.deepEqual(b.errs, []);
});

test("NVIDIA：清單超過 24 小時且已填金鑰時，進入 AI 頁自動更新一次", { skip: !JSDOM && "未安裝 jsdom（npm install）" }, async () => {
  const old = Date.now() - 25 * 3600 * 1000;
  const store = {
    "spi-ai-models": JSON.stringify({ nvidia: { at: old, models: ["openai/gpt-oss-20b", "old/retired-model"] } }),
    "spi-ai-config": JSON.stringify({ activeProvider: "nvidia", providers: { nvidia: { apiKey: "nvapi-test-key-000000", model: "old/retired-model" } } }),
  };
  let n = 0;
  const base = modelsReply(["openai/gpt-oss-20b", "brand/new-model"]);
  const c = open(store, (url, init) => { if (String(url).includes("models=1")) n += 1; return base(url, init); });
  await new Promise((r) => setTimeout(r, 50));
  c.w.SPI_TEST_HOOK.setTab("ai");
  await waitFor(() => /驗證 \d+ 個模型/.test(c.$("#aiCfgMsg").textContent), "自動更新與驗證");
  assert.deepEqual(optionValues(c.$), ["openai/gpt-oss-20b", "brand/new-model", "custom"]);
  assert.equal(c.$("#selAiModel").value, "openai/gpt-oss-20b", "已下架的模型改選可用模型");
  assert.match(c.$("#aiCfgMsg").textContent, /old\/retired-model 已不在清單/);
  c.w.SPI_TEST_HOOK.setTab("overview");
  c.w.SPI_TEST_HOOK.setTab("ai");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(n, 1, "清單已是新的，不重複查詢");
  assert.deepEqual(c.errs, []);
});

test("NVIDIA：所選模型未通過可用性驗證時改選最快的可用模型；沒有可用模型時說明分析可能失敗", { skip: !JSDOM && "未安裝 jsdom（npm install）" }, async () => {
  const store = {
    "spi-ai-config": JSON.stringify({ activeProvider: "nvidia", providers: { nvidia: { apiKey: "nvapi-test-key-000000", model: "openai/gpt-oss-20b" } } }),
  };
  let reply = modelsReply(["openai/gpt-oss-20b", "fast/model", "other/model"], ["fast/model"], { "openai/gpt-oss-20b": "等待 15 秒未開始回應" });
  const a = open(store, (url, init) => reply(url, init));
  await new Promise((r) => setTimeout(r, 50));
  a.w.SPI_TEST_HOOK.setTab("ai");
  a.$("#btnAiCheckModels").click();
  await waitFor(() => /驗證 \d+ 個模型/.test(a.$("#aiCfgMsg").textContent), "驗證完成");
  assert.match(a.$("#aiCfgMsg").textContent, /所選 openai\/gpt-oss-20b（等待 15 秒未開始回應）已改選 fast\/model/);
  assert.equal(a.$("#selAiModel").value, "fast/model");
  assert.deepEqual([...a.w.SPI_TEST_HOOK.aiFallbackModels("nvidia", "fast/model")], ["openai/gpt-oss-20b", "other/model"]);

  reply = modelsReply(["openai/gpt-oss-20b", "fast/model"], []);
  a.$("#btnAiCheckModels").click();
  await waitFor(() => /目前沒有可用模型/.test(a.$("#aiCfgMsg").textContent), "無可用模型訊息");
  assert.equal(a.$("#selAiModel").value, "fast/model", "沒有可用模型時不改選");
  assert.match(a.$("#aiModelListNote").textContent, /驗證可用 0 個/);
  assert.deepEqual(a.errs, []);
});
