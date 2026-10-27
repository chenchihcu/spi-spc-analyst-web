// v10.4.0 統計／圖表交叉稽核：以正式站紀錄重現的缺陷（能力卡母體不一致、報告圖表空白、θ 補償恆為 0、
// Johnson SU/SL 參數、LISA 顯著性、Hotelling Phase II 基準）。全部使用合成資料（不含客戶資料）
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { JSDOM } = (() => { try { return require("jsdom"); } catch { return {}; } })();
const fs = require("fs");
const { loadCore, baseState, HTML } = require("./_load.js");
const c = loadCore();
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const normal = (r) => () => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
const st = (rows, extra = {}) => baseState(c, { rows, metrics: ["volume", "height", "area"], metric: "volume", ...extra });

// 兩個元件群組：G_OK 置中、G_BAD 貼近 USL 且板間變異大（最差群組的 Ppk/Cpk 比值遠小於全部群組）
function mixedRows(seed = 3) {
  const nrm = normal(mulberry32(seed)), rows = [];
  for (let b = 1; b <= 20; b++) {
    const shift = nrm() * 8;
    for (let i = 0; i < 40; i++) rows.push({ board: "B" + b, pad: "OK-" + i, comp: "OK" + (i >> 1), group: "G_OK", volume: 100 + nrm() * 4, height: 120, area: 100 });
    for (let i = 0; i < 4; i++) rows.push({ board: "B" + b, pad: "BAD-" + i, comp: "BAD", group: "G_BAD", volume: 125 + shift + nrm() * 1.5, height: 120, area: 100 });
  }
  return rows;
}

test("B4 混合群組：能力卡 Cpk/Ppk/PPM/比值取同一最差群組，全部群組加權另列", () => {
  const A = c.analyze(st(mixedRows()));
  const cap = A.cap, w = cap.groups.find((g) => g.g === cap.worst);
  assert.equal(cap.mixed, true);
  assert.equal(cap.worst, "G_BAD");
  assert.equal(cap.ppmExp, w.ppmExp, "預估 PPM 與最差群組相同");
  assert.equal(cap.ppmObs, w.ppmObs, "超規 PPM 與最差群組相同");
  assert.ok(Math.abs(cap.ratio - cap.ppk / cap.cpk) < 1e-9, "比值 = 同群組 Ppk ÷ Cpk");
  assert.ok(cap.ratio < 0.75, `最差群組板間變異大，比值應明顯小於 1，實際 ${cap.ratio}`);
  assert.ok(isFinite(cap.ppmExpAll) && cap.ppmExpAll < cap.ppmExp, "全部群組加權 PPM 另列且較低");
  const xv = A.xv.rows.find((x) => x.k === "短期 vs 長期變異");
  assert.notEqual(xv.st, "ok", "交叉驗證不可再以全部群組比值判定「板間變異不顯著」");
  assert.match(A.xv.rows.find((x) => x.k === "製程能力").ev, /最差群組 G_BAD：.*全部群組加權預估/);
});

test("B8 混合群組不對合併資料做非常態能力", () => {
  const A = c.analyze(st(mixedRows()));
  assert.equal(A.nonNormal.valid, false);
  assert.match(A.nonNormal.reason, /元件群組混合/);
});

test("B2/B3 零變異：交叉驗證為不適用（不是異常），超規 PPM 依實際比例", () => {
  const rows = [];
  for (let b = 1; b <= 10; b++) for (let i = 0; i < 5; i++) rows.push({ board: "B" + b, pad: "P" + i, comp: "P" + i, group: "G", volume: 140, height: 120, area: 100 });
  const A = c.analyze(st(rows));
  assert.equal(A.cap.ppmObs, 1e6, "全部 140 > USL，超規 PPM 應為 1,000,000");
  const cap = A.xv.rows.find((x) => x.k === "製程能力");
  assert.equal(cap.st, "na");
  assert.doesNotMatch(cap.ev, /NaN/);
});

test("B1 印刷機 θ 補償：alignFit 的旋轉（thDeg）會帶入，不再恆為 0", () => {
  const nrm = normal(mulberry32(5)), rows = [], thMrad = 0.87; // 約 0.05°
  for (let b = 1; b <= 3; b++) for (let i = 0; i < 60; i++) {
    const x = (i % 10) * 20, y = Math.floor(i / 10) * 20;
    rows.push({ board: "B" + b, pad: "P" + i, group: "G", x, y, volume: 100, height: 120, area: 100,
      offx: -thMrad * (y - 50) + nrm() * 0.5, offy: thMrad * (x - 90) + nrm() * 0.5 });
  }
  const fit = c.alignFit(rows), corr = c.calcPrinterCorrection(rows, 3, 0.6);
  assert.ok(Math.abs(fit.thDeg) > 0.04, `合成旋轉應被 alignFit 抓到，實際 ${fit.thDeg}`);
  assert.equal(corr.observedOffset.theta, +fit.thDeg.toFixed(4));
  assert.ok(corr.correction.offsetTheta_deg !== 0 && Math.sign(corr.correction.offsetTheta_deg) === -Math.sign(fit.thDeg), "補償方向與觀測旋轉相反");
});

test("A5/B7 統計 CSV：Nelson 列的 sd 與 z 一致；規格內 |z|≥4 標為離群值", () => {
  const nrm = normal(mulberry32(9)), rows = [];
  for (let b = 1; b <= 25; b++) for (let i = 0; i < 30; i++) rows.push({ board: "B" + String(b).padStart(2, "0"), pad: "P" + i, comp: "P" + i, group: "G", volume: 100 + (b > 15 ? 3 : 0) + nrm() * 2, height: 120, area: 100 });
  rows[5].volume = 115; // 規格內（70–130），但群組內穩健 z 遠大於 4
  const s = st(rows);
  s.A = c.analyze(s);
  const out = c.buildStatsData(s);
  for (const o of out.filter((x) => /Nelson/.test(x.rule))) assert.ok(Math.abs((o.value - o.mean) / o.sd - o.z) < 1e-9, "(value − mean) ÷ sd 應等於 z");
  assert.ok(out.some((o) => o.rule === "離群值 (|z|≥4)" && o.value === 115), "離群值分支應可到達");
});

test("C1 Johnson SU／SL：以已知參數的合成資料配適，轉換後回到標準常態", () => {
  const nrm = normal(mulberry32(7));
  const su = Array.from({ length: 20000 }, () => 100 + 3 * Math.sinh((nrm() + 1) / 2));
  const sl = Array.from({ length: 20000 }, () => 80 + Math.exp((nrm() - 0.5) / 0.6));
  for (const [name, v] of [["SU", su], ["SL", sl]]) {
    const j = c.fitJohnson(v);
    assert.equal(j.valid, true, name);
    const t = v.map(j.transform), m = t.reduce((a, b) => a + b, 0) / t.length;
    const sd = Math.sqrt(t.reduce((a, b) => a + (b - m) ** 2, 0) / (t.length - 1));
    assert.ok(Math.abs(m) < 0.05 && Math.abs(sd - 1) < 0.05, `${name} 轉換後應約 N(0,1)，實際 mean ${m.toFixed(3)} sd ${sd.toFixed(3)}（舊公式 SU 的 sd 約 0.51）`);
    assert.ok(j.adP > 0.05, `${name} 轉換後 AD p 應不拒絕常態，實際 ${j.adP}`);
  }
});

test("C2 LISA：i.i.d. 資料的顯著焊墊比例受 FDR 控制（舊版 li/√(1/k) 約 5%）", () => {
  const r = mulberry32(11), nrm = normal(r);
  let sig = 0, tot = 0, gate = 0;
  for (let t = 0; t < 20; t++) {
    const pts = Array.from({ length: 300 }, (_, i) => ({ pad: "p" + i, x: r() * 200, y: r() * 120, val: nrm() }));
    const sa = c.calcMoranAndLISA(pts, 6);
    sig += sa.lisa.filter((x) => x.isSig).length; tot += sa.n;
    if (sa.counts.HH >= 3 || sa.counts.LL >= 3) gate++;
  }
  assert.ok(sig / tot < 0.005, `顯著比例應遠低於 5%，實際 ${(sig / tot * 100).toFixed(2)}%`);
  assert.equal(gate, 0, "i.i.d. 資料不應達到空間群聚卡的 HH/LL ≥ 3 閘門");
});

test("C3 Hotelling T² Phase II：新板不影響基準（平均向量與共變異只用 Phase I 板）", () => {
  const nrm = normal(mulberry32(13));
  const base = Array.from({ length: 15 }, (_, i) => ({ board: "B" + i, area: 100 + nrm() * 2, height: 120 + nrm() * 3 }));
  const mk = (shift) => [...base, ...[0, 1, 2].map((k) => ({ board: "N" + k, isNew: true, area: 100 + shift + nrm() * 2, height: 120 + nrm() * 3 }))];
  const a = c.hotellingT2(mk(0)), b = c.hotellingT2(mk(15));
  assert.equal(a.m, 15, "m 為 Phase I 板數");
  assert.deepEqual(a.meanVec, b.meanVec, "新板偏移不改變基準平均");
  assert.deepEqual(a.pts.slice(0, 15).map((p) => p.T2), b.pts.slice(0, 15).map((p) => p.T2), "Phase I 點的 T² 不受新板影響");
  assert.ok(b.pts.slice(15).every((p) => p.ooc), "偏移 15 的新板應全部超出 Phase II 界限");
});

test("A1–A3 報告：直方圖有資料、管制圖為 X̄ 界限、能力表有數值", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const charts = [];
  const html = fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://spi.example/", beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
    w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AA==";
    Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { let e = this; while (e) { if (e.hidden) return null; e = e.parentElement; } return w.document.body; } });
    w.Element.prototype.scrollIntoView = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {} }); w.ResizeObserver = class { observe() {} }; w.scrollTo = () => {};
    w.Chart = class { constructor(cv, cfg) { charts.push(cfg); } destroy() {} static register() {} };
    w.SPI_TEST_HOOK = {};
  } });
  const w = dom.window;
  // 等頁面初始化完成（測試掛鉤與範例分析結果就緒），帶逾時的條件輪詢，不用固定休眠
  for (let i = 0; i < 200 && !(w.SPI_TEST_HOOK.renderReport && w.eval("typeof S!=='undefined'&&!!S.A")); i++) await tick(20);
  assert.ok(w.SPI_TEST_HOOK.renderReport && w.eval("!!S.A"), "頁面初始化逾時（4 秒）");
  charts.length = 0;
  w.SPI_TEST_HOOK.renderReport();
  const A = JSON.parse(w.eval("JSON.stringify({cl:S.A.xs.cl,ucl:S.A.xs.pts.map(p=>p.ucl),v:S.A.xs.pts.map(p=>p.v),n:S.A.N})"));
  const hist = charts.find((cfg) => cfg.data.datasets[0].label === "實測頻數");
  assert.ok(hist, "報告應產生直方圖");
  assert.equal(hist.data.datasets[0].data.reduce((s, b) => s + b.y, 0), A.n, "直方圖頻數合計 = 樣本數");
  const ctrl = charts.find((cfg) => cfg.data.datasets[0].label === "每板平均");
  const plain = (v) => JSON.parse(JSON.stringify(v)); // jsdom 視窗的陣列原型不同，先轉成本 realm 物件再比對
  assert.deepEqual(plain(ctrl.data.datasets[0].data), A.v, "管制圖畫每板平均");
  assert.deepEqual(plain(ctrl.data.datasets[1].data), A.ucl, "UCL 為 X̄ 圖界限（非 EWMA）");
  const sec5 = w.document.querySelector("#repSec5").textContent;
  assert.match(sec5, /\d+\.\d\d/, "能力表應有 Cp/Cpk 數值");
  assert.match(w.document.querySelector("#repSec4").textContent, /X̄ 圖（板平均/);
});
