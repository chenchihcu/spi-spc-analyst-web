// 面積比 × 轉移效率：圖例不可隨群組數膨脹（以 refdes 分群時曾逐一列出約 800 個群組）
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { HTML, withIdb } = require("./_load.js");
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); } catch { /* 未安裝 jsdom 時略過 */ }

function open() {
  const html = fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");
  const errs = [], charts = [];
  const vc = new VirtualConsole(); vc.on("jsdomError", (e) => errs.push(e.message));
  const dom = new JSDOM(html, { runScripts: "dangerously", virtualConsole: vc, url: "https://example.test/",
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
      Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { let e = this; while (e) { if (e.hidden) return null; e = e.parentElement; } return w.document.body; } });
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} }; w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
      w.Chart = class { constructor(_c, cfg) { charts.push(cfg); } destroy() {} static register() {} };
      withIdb(w); w.SPI_TEST_HOOK = {};
    } });
  return { w: dom.window, errs, charts };
}
async function ready(w) {   // 條件輪詢（帶逾時），不用固定休眠
  for (let i = 0; i < 200; i++) {
    const H = w.SPI_TEST_HOOK;
    if (H && typeof H.setTab === "function" && H.S?.rows?.length) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("頁面初始化逾時：SPI_TEST_HOOK 未就緒");
}
const arChart = (charts) => charts.filter((c) => c?.options?.scales?.x?.title?.text === "面積比 AR").at(-1);

test("群組數 ≤ 色盤：逐群組列圖例，參考線分成兩項", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, errs, charts } = open();
  await ready(w);
  w.SPI_TEST_HOOK.setTab("deep/adv");
  const leg = w.document.querySelector("#arLeg");
  const groups = [...new Set(w.SPI_TEST_HOOK.S.rows.map((r) => r.group))];
  assert.ok(groups.length <= 6, `範例資料群組數 ${groups.length}`);
  for (const g of groups) assert.ok(leg.textContent.includes(g), `圖例應含群組 ${g}`);
  const spans = [...leg.querySelectorAll("span")].map((s) => s.textContent);
  assert.ok(spans.includes("直虛線：AR 0.66（IPC-7525 建議下限）"));
  assert.ok(spans.includes("橫虛線：體積規格上下限"));
  assert.equal(arChart(charts).data.datasets.filter((d) => d.type !== "line").length, groups.length);
  assert.deepEqual(errs, []);
});

test("群組數 > 色盤（以 refdes 分群）：圖例只列判讀等級，不列群組名稱", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, errs, charts } = open();
  await ready(w);
  const S = w.SPI_TEST_HOOK.S;
  for (const r of S.rows) r.group = "X" + r.pad;   // 每個焊墊各成一群，模擬大量 refdes 群組
  const groups = new Set(S.rows.map((r) => r.group));
  assert.ok(groups.size > 6);
  w.SPI_TEST_HOOK.setTab("deep/adv");
  const leg = w.document.querySelector("#arLeg");
  const spans = [...leg.querySelectorAll("span")].map((s) => s.textContent);
  assert.ok(spans.length <= 6, `圖例項目 ${spans.length}：${spans.join(" | ")}`);
  for (const g of groups) assert.ok(!leg.textContent.includes(g), `圖例不應列出群組 ${g}`);
  assert.match(leg.textContent, /風險 \d+ 個焊墊/);
  assert.match(leg.textContent, new RegExp(`共 ${groups.size} 個群組`));
  const pts = arChart(charts).data.datasets.filter((d) => d.type !== "line");
  assert.equal(pts.map((d) => d.label).join(","), "風險,注意,正常");
  assert.equal(pts.reduce((n, d) => n + d.data.length, 0), new Set(S.rows.filter((r) => r.volume != null).map((r) => r.pad)).size, "每個焊墊仍各有一點");
  assert.deepEqual(errs, []);
});
