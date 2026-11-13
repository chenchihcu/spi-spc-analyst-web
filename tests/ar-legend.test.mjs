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
      withIdb(w); w.SPI_TEST_HOOK = { bootSample: true };
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

// 0.7 mm 估算幾何不可畫成面積比：曾讓所有焊墊疊在同一個 AR（如 1.92）成一條直線，並以估算值判定風險
const ptsOf = (c) => c.data.datasets.filter((d) => d.type !== "line").flatMap((d) => d.data);

test("全部焊墊尺寸未提供：不畫估算的面積比，表格不判定風險", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, errs, charts } = open();
  await ready(w);
  const S = w.SPI_TEST_HOOK.S;
  for (const r of S.rows) { r.w = 0.7; r.d = 0.7; r.apL = undefined; r.apW = undefined; r.dimAssumed = true; }
  const before = charts.length;
  w.SPI_TEST_HOOK.setTab("deep/adv");
  assert.equal(charts.slice(before).filter((c) => c?.options?.scales?.x?.title?.text === "面積比 AR").length, 0, "不應建立面積比散佈圖");
  const doc = w.document;
  assert.equal(doc.querySelector("#cAR").parentElement.hidden, true);
  assert.equal(doc.querySelector("#arNote").hidden, false);
  assert.match(doc.querySelector("#arNote").textContent, /面積比無法計算/);
  const tbl = doc.querySelector("#arTbl").textContent;
  assert.ok(!tbl.includes("風險"), "估算幾何不可判定風險");
  assert.match(tbl, /面積比無法判定/);
  w.SPI_TEST_HOOK.setTab("dfm");
  assert.ok(!/\d\.\d{3}×\d\.\d{3}/.test(doc.querySelector("#dfmTbl").textContent), "DFM 表不可列出 0.7 mm 估算開孔");
  assert.deepEqual(errs, []);
});

test("部分焊墊尺寸未提供：只畫有真實幾何的焊墊", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, errs, charts } = open();
  await ready(w);
  const S = w.SPI_TEST_HOOK.S;
  const groups = [...new Set(S.rows.map((r) => r.group))];
  const est = groups[0];
  for (const r of S.rows) if (r.group === est) { r.w = 0.7; r.d = 0.7; r.apL = undefined; r.apW = undefined; r.dimAssumed = true; }
  w.SPI_TEST_HOOK.setTab("deep/adv");
  const pts = ptsOf(arChart(charts));
  const realPads = new Set(S.rows.filter((r) => r.volume != null && r.group !== est).map((r) => r.pad));
  assert.equal(pts.length, realPads.size);
  assert.ok(pts.every((p) => p.p.group !== est));
  assert.match(w.document.querySelector("#arSub").textContent, /\d+ 個焊墊缺焊墊／開孔尺寸，未納入/);
  assert.deepEqual(errs, []);
});

test("所有焊墊 AR 相同：顯示說明，x 軸涵蓋資料與 0.66", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, errs, charts } = open();
  await ready(w);
  const S = w.SPI_TEST_HOOK.S;
  for (const r of S.rows) { r.apL = 0.8; r.apW = 0.8; r.dimAssumed = false; r.shape = "rect"; }
  w.SPI_TEST_HOOK.setTab("deep/adv");
  const c = arChart(charts), pts = ptsOf(c), xs = pts.map((p) => p.x);
  assert.equal(new Set(xs.map((x) => x.toFixed(2))).size, 1);
  const { min, max } = c.options.scales.x;
  assert.ok(min < 0.66 && max > Math.max(...xs), `x 範圍 ${min}–${max}`);
  const note = w.document.querySelector("#arNote");
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /所有焊墊開孔與鋼板厚度相同（AR \d\.\d\d）/);
  assert.deepEqual(errs, []);
});

// 圖表編碼：長條長度代表數值時軸要從 0 開始；截斷的軸改用點；平均標記不可寬過所屬區間
const byCanvasLabel = (charts, pred) => charts.filter(pred).at(-1);
test("轉移效率 A vs B 長條從 0 開始；擦拭週期平均改用點；群組多時平均標記縮小", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, errs, charts } = open();
  await ready(w);
  const H = w.SPI_TEST_HOOK;
  H.setTab("deep");
  const wipe = byCanvasLabel(charts, (c) => c?.options?.scales?.y2?.title?.text === "不良率");
  assert.ok(wipe, "擦拭週期圖");
  assert.equal(wipe.data.datasets[0].type, "line");
  assert.equal(wipe.data.datasets[0].showLine, false, "平均以點呈現（y 軸未從 0 開始）");
  H.setTab("improve/compare");
  const te = byCanvasLabel(charts, (c) => c?.type === "bar" && c?.options?.plugins?.tooltip?.callbacks?.label?.toString().includes("f(i.raw,1)}%"));
  assert.ok(te, "轉移效率 A vs B 圖");
  assert.equal(te.options.scales.y.beginAtZero, true);
  const S = H.S;
  S.rows = S.rows.map((r) => ({ ...r, group: "X" + r.pad }));
  H.recompute(); H.setTab("issues/cross");
  const g = byCanvasLabel(charts, (c) => c?.type === "bar" && c?.data?.datasets?.[1]?.pointStyle === "line");
  assert.ok(g && g.data.labels.length > 50, "元件群組比較");
  assert.ok(g.data.datasets[1].pointRadius <= 3, `平均標記半徑 ${g.data.datasets[1].pointRadius}`);
  assert.deepEqual(errs, []);
});
