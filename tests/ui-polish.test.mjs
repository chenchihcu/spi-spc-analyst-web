// v10.28.0 介面整理：管制界限數值標示、Cp/Cpk/Pp/Ppk 寫法、空白狀態、匯出中心摘要與樣式守衛
// 同一個 jsdom 頁面依序檢查（每開一頁約 2.5–5 秒，避免拖長 CI）
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { HTML } = require("./_load.js");
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); } catch { /* 未安裝時略過 */ }
const skip = !JSDOM && "未安裝 jsdom（npm install）";
const src = fs.readFileSync(HTML, "utf8");

function open() {
  const html = src.replace(/<script src=[^>]+><\/script>/g, "");
  const errs = [], charts = [];
  const vc = new VirtualConsole(); vc.on("jsdomError", (e) => errs.push(e.message));
  const dom = new JSDOM(html, { runScripts: "dangerously", virtualConsole: vc, url: "https://example.test/",
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
      Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { let e = this; while (e) { if (e.hidden) return null; e = e.parentElement; } return w.document.body; } });
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} }; w.scrollTo = () => {}; w.scrollBy = () => {}; w.Element.prototype.scrollIntoView = () => {};
      w.Chart = class { constructor(cv, cfg) { charts.push({ id: cv && cv.id, cfg }); } destroy() {} static register() {} };
      w.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => "" });
      if (!w.TextEncoder) w.TextEncoder = TextEncoder;
      if (!w.TextDecoder) w.TextDecoder = TextDecoder;
      w.SPI_TEST_HOOK = {};
    } });
  return { w: dom.window, d: dom.window.document, errs, charts };
}
async function until(fn, what) {   // 條件輪詢（帶逾時），不用固定休眠
  for (let i = 0; i < 300; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error("逾時：" + what);
}
const lastChart = (charts, id) => [...charts].reverse().find((c) => c.id === id)?.cfg;
const kpiLabels = (d, sel) => [...d.querySelectorAll(sel + " .kpi .k")].map((e) => e.textContent);

test("介面整理：空白狀態、範例資料、KPI 寫法、管制界限數值與匯出摘要", { skip }, async (t) => {
  const { w, d, errs, charts } = open();
  await until(() => typeof w.SPI_TEST_HOOK?.setTab === "function" && Array.isArray(w.SPI_TEST_HOOK.S?.runs), "SPI_TEST_HOOK 未就緒");
  const hook = w.SPI_TEST_HOOK, S = hook.S;

  await t.test("空白：分析設定欄位與預設規格隱藏、問題地圖隱藏、只留一個標題與兩個按鈕", () => {
    assert.ok(d.querySelector(".rail").classList.contains("rail--empty"), "沒有回合時分析設定列標示為空白");
    assert.equal(d.querySelector("#selRun").options.length, 0);
    assert.ok(d.querySelector("#pmapDetails").hidden, "沒有資料時不顯示空的問題地圖");
    assert.match(d.querySelector("#issHead").textContent, /尚未匯入量測資料/);
    assert.doesNotMatch(d.querySelector("#issList").textContent, /尚無問題偵測結果/, "不重複第二個標題");
    assert.ok(d.querySelector("#issList [data-load-sample]") && d.querySelector("#issList [data-goto-import]"));
    assert.match(d.querySelector("#issSub").textContent, /「記錄庫」/, "指向實際的「記錄庫」按鈕");
  });

  d.querySelector("#issList [data-load-sample]").click();
  await until(() => S.A && S.rows && S.rows.length && /問題定義|統計發現/.test(d.querySelector("#issHead").textContent), "範例資料分析與問題清單完成");

  await t.test("載入後：分析設定列與問題地圖恢復", () => {
    assert.ok(!d.querySelector(".rail").classList.contains("rail--empty"));
    assert.ok(!d.querySelector("#pmapDetails").hidden);
  });

  await t.test("總覽 KPI 用 Cpk／Ppk 寫法，不良 PPM 標題不重複副標", () => {
    hook.setTab("overview");
    const ks = kpiLabels(d, "#kpis");
    assert.ok(ks.some((k) => /^Cpk/.test(k)) && ks.some((k) => /^Ppk/.test(k)), ks.join(" | "));
    assert.ok(!ks.some((k) => /CPK|PPK/.test(k)), "不再出現全大寫 CPK／PPK");
    assert.ok(ks.includes("不良 PPM"));
  });

  await t.test("製程能力 KPI 用 Cp／Cpk／Pp／Ppk，全部群組 PPM 卡加寬", () => {
    hook.setTab("capability");
    const ks = kpiLabels(d, "#capKpis");
    for (const k of ["Cp", "Cpk", "Pp", "Ppk"]) assert.ok(ks.includes(k), `缺 ${k}：${ks.join(" | ")}`);
    const all = [...d.querySelectorAll("#capKpis .kpi")].find((e) => e.querySelector(".k").textContent === "全部群組 PPM");
    assert.ok(all && all.classList.contains("wide"), "範例資料為混合群組，全部群組 PPM 卡要加寬");
  });

  await t.test("管制圖：UCL／CL／LCL 數值與分析結果一致；總覽縮圖不標示；S 圖圖例維持隱藏", () => {
    charts.length = 0;
    hook.setTab("control");
    const A = S.A, c1 = lastChart(charts, "cCtrl1");
    assert.ok(c1, "主管制圖有建立");
    const items = c1.options.plugins.limitLabels.items;
    assert.deepEqual([...items].map((x) => x.t.split(" ")[0]), ["UCL", "CL", "LCL"]);
    assert.equal(items[0].v, A.xs.pts.at(-1).ucl);
    assert.equal(items[1].v, A.xs.cl);
    assert.equal(items[2].v, A.xs.pts.at(-1).lcl);
    assert.equal(items[0].t, "UCL " + A.xs.pts.at(-1).ucl.toFixed(2));
    assert.ok(!/ -\d/.test(items.map((x) => x.t).join(" ")), "負值用 − 而非連字號");
    const padFor = (width) => c1.options.layout.padding({ chart: { width } }).right;
    assert.ok(padFor(1000) > 0, "寬圖保留右側留白放數值");
    assert.equal(padFor(300), 0, "手機寬度不保留右側留白，數值改印在繪圖區內");
    const c2 = lastChart(charts, "cCtrl2");
    assert.ok(c2 && c2.options.plugins.limitLabels.items.length === 3, "S 圖也標示界限");
    assert.equal(c2.options.plugins.legend.display, false, "S 圖不可出現預設圖例（undefined 標籤）");
    charts.length = 0;
    hook.setTab("overview");
    const mini = lastChart(charts, "cOvCtrl");
    assert.ok(mini, "總覽縮圖有建立");
    assert.equal(mini.options.plugins.limitLabels, undefined, "縮圖不標示界限數值");
  });

  await t.test("窄圖界限數值：貼近頂端時仍保持間距，不互相重疊", () => {
    const plugin = hook.limitLabels, ys = [];
    const ctx = { save() {}, restore() {}, fillRect() {}, measureText: (s) => ({ width: s.length * 7 }), fillText: (s, x, y) => ys.push(y) };
    const ch = { ctx, width: 300, chartArea: { top: 0, bottom: 200, left: 40, right: 290 }, scales: { y: { getPixelForValue: (v) => v } } };
    plugin.afterDatasetsDraw(ch, {}, { items: [{ t: "UCL", v: 0, c: "r" }, { t: "CL", v: 3, c: "a" }, { t: "LCL", v: 6, c: "r" }] });
    const fs = hook.chartCaptionFontPx();
    assert.equal(ys.length, 3);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= fs, `第 ${i} 與 ${i + 1} 個數值間距 ${ys[i] - ys[i - 1]} < 字高 ${fs}`);
    assert.ok(ys[0] >= fs / 2, "第一個數值不超出繪圖區頂端");
  });

  await t.test("匯出中心摘要：焊墊筆數取目前量測列，沒有版次時不補 V1", async () => {
    d.querySelector("#btnOpenExportModal").click();
    const el = d.querySelector("#exportCenterSummary");
    await until(() => /焊墊筆數/.test(el.textContent), "匯出中心摘要");
    assert.match(el.textContent, new RegExp("焊墊筆數：" + S.rows.length.toLocaleString().replace(/,/g, ",")));
    assert.doesNotMatch(el.textContent, /\(V1\)/);
  });

  assert.deepEqual(errs.filter((e) => !/Could not parse CSS|Not implemented/.test(e)), [], "頁面不可有執行期錯誤");
});

test("樣式守衛：狀態膠囊同字級、核取方塊配色、子分頁同一套強調色、管制圖選項列無行內對齊", () => {
  assert.match(src, /button\.load-state\{[^}]*font-size:var\(--fs-caption\)/);
  assert.match(src, /input\[type=checkbox\],input\[type=radio\][^{]*\{accent-color:var\(--accent\)\}/);
  assert.match(src, /\.subtab\[aria-selected="true"\]\{background:var\(--accent-soft\);color:var\(--accent-ink\);border-color:var\(--accent\)/);
  assert.doesNotMatch(src, /class="rail-fields" style="[^"]*align-items:flex-end/);
  assert.match(src, /Chart\.register\(vlines,limitLabels\)/);
});
