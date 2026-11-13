// 深入分析空狀態收斂與關係圖（specScatter / parallel / radar）回歸測試
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
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errs.push(e.message));
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    virtualConsole: vc,
    url: "https://example.test/",
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () =>
        new Proxy({}, {
          get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})),
          set: (t, k, v) => ((t[k] = v), true),
        });
      Object.defineProperty(w.HTMLElement.prototype, "offsetParent", {
        get() {
          let e = this;
          while (e) {
            if (e.hidden) return null;
            e = e.parentElement;
          }
          return w.document.body;
        },
      });
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} };
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = () => {};
      w.Chart = class {
        constructor(c, cfg) { charts.push({ id: c && c.id, cfg }); }
        destroy() {}
        static register() {}
      };
      withIdb(w);
      w.SPI_TEST_HOOK = { bootSample: true };
    },
  });
  return { w: dom.window, errs, charts };
}

async function ready(w) {
  for (let i = 0; i < 200; i++) {
    const H = w.SPI_TEST_HOOK;
    if (H && typeof H.setTab === "function" && H.S?.rows?.length) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("頁面初始化逾時：SPI_TEST_HOOK 未就緒");
}

function change(el, value) {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event("change", { bubbles: true }));
}

test("關係圖：specScatter / parallel / radar 皆有繪製且切換即時重繪", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, errs, charts } = open();
  await ready(w);
  const d = w.document;
  w.SPI_TEST_HOOK.setTab("deep/adv");

  const relCharts = () => charts.filter((x) => x.id === "cRelChart").map((x) => x.cfg);
  assert.equal(d.querySelector("#relChartBox").hidden, false);
  assert.equal(d.querySelector("#relChartEmpty").hidden, true);
  assert.equal(relCharts().at(-1)?.type, "scatter");

  change(d.querySelector("#selRelChart"), "parallel");
  assert.equal(d.querySelector("#relChartBox").hidden, false);
  assert.equal(d.querySelector("#relChartEmpty").hidden, true);
  const par = relCharts().at(-1);
  assert.equal(par?.type, "line");
  assert.equal(par?.data?.labels?.length, 3);
  assert.ok(par?.data?.datasets?.length >= 10);

  change(d.querySelector("#selRelChart"), "radar");
  assert.equal(d.querySelector("#relChartBox").hidden, false);
  assert.equal(d.querySelector("#relChartEmpty").hidden, true);
  const rad = relCharts().at(-1);
  assert.equal(rad?.type, "radar");
  assert.equal(rad?.data?.labels?.length, 3);
  assert.ok(rad?.data?.datasets?.length >= 2);
  assert.equal(rad?.options?.scales?.x, undefined, "Radar 不應殘留 Cartesian X 軸");

  assert.deepEqual(errs, []);
});

test("關係圖：特徵完全共線時拒絕繪製並隱藏圖框（FR-8）", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, errs, charts } = open();
  await ready(w);
  const d = w.document;
  const S = w.SPI_TEST_HOOK.S;
  S.rows = S.rows.slice(0, 60).map((r) => ({ ...r, volume: 100, area: 100, height: 120 }));
  w.SPI_TEST_HOOK.recompute();
  w.SPI_TEST_HOOK.setTab("deep/adv");
  charts.length = 0;

  change(d.querySelector("#selRelChart"), "radar");
  assert.equal(d.querySelector("#relChartBox").hidden, true);
  assert.equal(d.querySelector("#relChartEmpty").hidden, false);
  assert.match(d.querySelector("#relChartEmpty").textContent, /共線/);
  assert.equal(charts.filter((x) => x.id === "cRelChart").length, 0);
  assert.deepEqual(errs, []);
});

test("缺座標／缺偏移／缺時間戳記：LISA、停線衰退、對位分解不留空白框與誤導標籤", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, errs } = open();
  await ready(w);
  const d = w.document;
  const S = w.SPI_TEST_HOOK.S;
  S.rows = S.rows.slice(0, 120).map((r, i) => ({
    ...r,
    x: (i % 10) * 2,
    y: Math.floor(i / 10) * 2,
    gridPos: true,
    offx: null,
    offy: null,
    ts: null,
  }));
  w.SPI_TEST_HOOK.recompute();
  w.SPI_TEST_HOOK.setTab("deep/adv");

  // LISA：缺座標時隱藏圖例與 320px chartbox
  assert.equal(d.querySelector("#lisaLeg").hidden, true);
  assert.equal(d.querySelector("#lisaChartBox").hidden, true);
  assert.match(d.querySelector("#lisaMsg").textContent, /不適用/);
  assert.match(d.querySelector("#lisaMsg").textContent, /缺座標/);

  // 停線時效：缺時間戳記不可誤標「連續生產」或「停機間隔均 < 15 分鐘」
  assert.match(d.querySelector("#pauseSub").textContent, /不適用/);
  assert.doesNotMatch(d.querySelector("#pauseSub").textContent, /< 15 分鐘/);
  assert.match(d.querySelector("#pauseMsg").textContent, /不適用/);
  assert.doesNotMatch(d.querySelector("#pauseMsg").textContent, /連續生產/);
  assert.equal(d.querySelector("#pauseTblWrap").hidden, true);

  // 對位分解：無偏移時隱藏空下拉選單與 900x600 畫布
  assert.equal(d.querySelector("#alignToolbar").hidden, true);
  assert.equal(d.querySelector("#alignGrid").hidden, true);
  assert.equal(d.querySelector("#alignEmpty").hidden, false);
  assert.match(d.querySelector("#alignEmpty").textContent, /需要 X\/Y 座標與 X\/Y 偏移欄位/);

  assert.deepEqual(errs, []);
});

test("停線時效：有時間戳記且間隔均 < 15 分鐘才標示連續生產", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, errs } = open();
  await ready(w);
  const d = w.document;
  const S = w.SPI_TEST_HOOK.S;
  const baseT = Date.UTC(2026, 10, 1, 8, 0, 0);
  const boards = [...new Set(S.rows.map((r) => r.board))];
  const bTs = new Map(boards.map((b, idx) => [b, baseT + idx * 60_000]));
  S.rows = S.rows.map((r) => ({ ...r, ts: bTs.get(r.board) }));
  w.SPI_TEST_HOOK.recompute();
  w.SPI_TEST_HOOK.setTab("deep/adv");

  assert.match(d.querySelector("#pauseSub").textContent, /未檢出停線事件/);
  assert.match(d.querySelector("#pauseMsg").textContent, /連續生產/);
  assert.equal(d.querySelector("#pauseTblWrap").hidden, true);
  assert.deepEqual(errs, []);
});
