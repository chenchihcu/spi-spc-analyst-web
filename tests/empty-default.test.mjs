// 開啟頁面一律空白：不自動載入範例、不還原上次的回合；資料相關的瀏覽器紀錄在開啟時清除，偏好設定保留
// 規格：docs/spec-empty-default-state-rfc.md
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { HTML } = require("./_load.js");
let JSDOM, VirtualConsole, IDBFactory, IDBKeyRange;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); ({ IDBFactory, IDBKeyRange } = require("fake-indexeddb")); } catch { /* 未安裝時略過 */ }
const skip = !JSDOM && "未安裝 jsdom（npm install）";

const req = (q) => new Promise((ok, no) => { q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
async function idbOpen(idb, name, store) {
  const q = idb.open(name, 1);
  q.onupgradeneeded = () => q.result.createObjectStore(store);
  return req(q);
}
async function idbGet(idb, name, store, key) {
  const db = await idbOpen(idb, name, store);
  try { return await req(db.transaction(store).objectStore(store).get(key)); } finally { db.close(); }
}
async function idbPut(idb, name, store, key, val) {
  const db = await idbOpen(idb, name, store);
  await new Promise((ok, no) => { const t = db.transaction(store, "readwrite"); t.objectStore(store).put(val, key); t.oncomplete = ok; t.onerror = () => no(t.error); });
  db.close();
}

function open({ idb = new IDBFactory(), storage = {} } = {}) {
  const html = fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");
  const errs = [], calls = { print: 0, blob: 0, fetch: [] };
  const vc = new VirtualConsole(); vc.on("jsdomError", (e) => errs.push(e.message));
  const dom = new JSDOM(html, { runScripts: "dangerously", virtualConsole: vc, url: "https://example.test/",
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
      Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { let e = this; while (e) { if (e.hidden) return null; e = e.parentElement; } return w.document.body; } });
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} }; w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
      w.Chart = class { constructor() {} destroy() {} static register() {} };
      w.print = () => { calls.print++; };
      w.URL.createObjectURL = () => { calls.blob++; return "blob:x"; };
      w.fetch = async (u, o = {}) => { calls.fetch.push([String(u), (o.method || "GET").toUpperCase()]); return { ok: false, status: 404, json: async () => ({}), text: async () => "" }; };
      w.indexedDB = idb; w.IDBKeyRange = IDBKeyRange;
      if (!w.TextEncoder) w.TextEncoder = TextEncoder;
      if (!w.TextDecoder) w.TextDecoder = TextDecoder;
      for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
      w.SPI_TEST_HOOK = {};
    } });
  return { w: dom.window, d: dom.window.document, errs, calls, idb };
}
async function until(fn, what) {   // 條件輪詢（帶逾時），不用固定休眠
  for (let i = 0; i < 300; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error("逾時：" + what);
}
const ready = (w) => until(() => typeof w.SPI_TEST_HOOK?.setTab === "function" && Array.isArray(w.SPI_TEST_HOOK.S?.runs), "SPI_TEST_HOOK 未就緒");

test("FR-1：開啟頁面沒有回合、不分析，各頁顯示空白狀態而非規格鎖定", { skip }, async () => {
  const { w, d, errs } = open();
  await ready(w);
  const H = w.SPI_TEST_HOOK, S = H.S;
  assert.equal(S.runs.length, 0, "不可自動載入範例回合");
  assert.equal(S.rows.length, 0);
  assert.equal(S.A, null, "沒有資料不可產生分析結果");
  assert.equal(d.querySelector("#selRun").options.length, 0, "回合選單為空");
  assert.ok(d.querySelector("#busy").hidden, "開啟後不可出現計算中提示");
  assert.match(d.querySelector("#issHead").textContent, /尚未匯入量測資料/);
  assert.ok(d.querySelector("#issList [data-load-sample]"), "問題頁空白狀態要有「載入範例資料」按鈕");
  assert.ok(d.querySelector("#issList [data-goto-import]"), "問題頁空白狀態要有「前往匯入」按鈕");
  for (const t of ["overview", "control", "capability", "sim3d", "deep", "improve", "report"]) {
    H.setTab(t);
    assert.ok(d.querySelector("#p-gate").hidden, `${t}：沒有資料時不顯示「尚未套用料號規格」鎖定頁`);
    assert.ok(!d.querySelector("#p-" + t).hidden, `${t}：分頁本身可見`);
  }
  H.setTab("overview");
  assert.equal(d.querySelector("#vTitle").textContent, "尚未載入分析資料");
  H.setTab("sim3d");
  await until(() => /尚未載入量測資料/.test(d.querySelector("#hud").textContent), "3D 空白提示");
  assert.doesNotMatch(d.body.textContent, /點選頂部「載入範例資料」/, "不可指向不存在的頂部按鈕");
  assert.deepEqual(errs, []);
});

test("FR-2/FR-3/FR-11：舊版留在瀏覽器的資料於開啟時清除，偏好設定保留", { skip }, async () => {
  const idb = new IDBFactory();
  await idbPut(idb, "spi-spc", "kv", "runs", { v: 1, savedAt: 1, runId: 1, runs: [{ id: 1, name: "上一位使用者的回合", rows: [{ board: 1, pad: "P1", volume: 100 }], metrics: ["volume"], cfg: {} }] });
  await idbPut(idb, "spi-spc-cache", "det", "k", { F: [] });
  const { w, d } = open({ idb, storage: {
    "spi-stencil": JSON.stringify({ t: 100, lo: 70, hi: 130 }),
    "spi-place": JSON.stringify({ recId: "r1", part: "PN-OLD", rev: "A", name: "舊座標.csv", tab: { head: [], rows: [] }, unit: "mm", side: "TOP" }),
    "spi-last-part": "PN-OLD",
    "spi-theme": "dark",
    "spi-profiles": JSON.stringify([{ name: "我的格式" }]),
  } });
  await ready(w);
  const S = w.SPI_TEST_HOOK.S;
  assert.equal(S.runs.length, 0, "不可還原上次的回合");
  assert.equal(S.stencil, 120, "鋼板厚度回到預設");
  assert.deepEqual({ ...S.htol }, { lo: 75, hi: 125 }, "高度公差回到預設");
  assert.equal(w.SPI_TEST_HOOK.getPlace(), null, "座標檔不沿用");
  assert.equal(d.querySelector("#inPart").value, "", "產品料號不帶入上次的值");
  await until(() => w.localStorage.getItem("spi-stencil") === null, "清除 spi-stencil");
  for (const k of ["spi-stencil", "spi-place", "spi-last-part"]) assert.equal(w.localStorage.getItem(k), null, k + " 應清除");
  assert.equal(w.localStorage.getItem("spi-theme"), "dark", "主題偏好保留");
  assert.ok(w.localStorage.getItem("spi-profiles"), "欄位對應設定檔保留");
  assert.equal(d.documentElement.dataset.theme, "dark", "深色主題仍套用");
  await w.SPI_TEST_HOOK.purgeLegacyData();
  const names = (await idb.databases()).map((x) => x.name);
  assert.ok(!names.includes("spi-spc"), "舊版保存回合的資料庫應刪除");
  assert.ok(!names.includes("spi-spc-cache"), "舊版問題偵測快取應刪除");
});

test("FR-7/FR-2/FR-10：範例只由按鈕載入、不寫入瀏覽器；刪除最後一個回合回到空白", { skip }, async () => {
  const { w, d, errs, idb } = open();
  await ready(w);
  const H = w.SPI_TEST_HOOK, S = H.S;
  d.querySelector("#issList [data-load-sample]").click();
  await until(() => S.runs.length === 2 && S.F && S.F.length > 0 && !S.F.pending, "範例偵測完成");
  assert.deepEqual([...S.runs.map((r) => r.name)], ["試產 1 · 鋼板 V1", "試產 2 · V2 BGA 加大＋奈米塗層"]);
  assert.equal(S.tab, "issues");
  assert.match(d.querySelector("#runSaveNote").textContent, /重新整理或重新登入後會清空/);
  // 不寫入瀏覽器：沒有回合、鋼板、座標或料號紀錄
  for (const k of ["spi-stencil", "spi-place", "spi-last-part"]) assert.equal(w.localStorage.getItem(k), null, k + " 不可寫入");
  await new Promise((r) => setTimeout(r, 600));   // 舊版的延遲保存是 500 ms；確認此後仍未寫入
  assert.equal(await idbGet(idb, "spi-spc", "kv", "runs"), undefined, "回合不可寫入 IndexedDB");
  H.setTab("data"); H.setSub("runs");
  for (let i = 0; i < 2; i++) {
    const del = d.querySelector("#runTbl [data-delrun]");
    assert.ok(!del.disabled, "最後一個回合也可以刪除");
    del.click();
  }
  assert.equal(S.runs.length, 0);
  assert.equal(S.rows.length, 0);
  assert.equal(S.A, null);
  assert.equal(S.specSrc, "none", "範例規格不沿用");
  H.setTab("overview");
  assert.equal(d.querySelector("#vTitle").textContent, "尚未載入分析資料");
  assert.deepEqual(errs, []);
});

test("FR-6：沒有資料時列印、PDF、交付包、AI 都不產生輸出", { skip }, async () => {
  const { w, d, calls } = open();
  await ready(w);
  const toast = () => d.querySelector("#toast")?.textContent || "";
  d.querySelector("#btnRepPrint").click();
  await until(() => /目前沒有量測資料/.test(toast()), "列印提示");
  assert.equal(calls.print, 0, "不可開啟列印");
  await d.querySelector("#btnRepPdf").onclick();
  d.querySelector("#btnDownloadStandardBundle").click();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.blob, 0, "不可產生下載檔");
  const before = calls.fetch.filter(([u, m]) => m === "POST" && /\/api\/(analyze|share)/.test(u)).length;
  await d.querySelector("#btnAI").onclick();
  assert.match(d.querySelector("#aiState").textContent, /目前沒有量測資料/);
  assert.equal(calls.fetch.filter(([u, m]) => m === "POST" && /\/api\/(analyze|share)/.test(u)).length, before, "不可送出 AI 或分享請求");
});
