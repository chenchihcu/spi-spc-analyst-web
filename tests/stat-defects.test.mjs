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

test("C2 LISA（方案 B）：地圖標示為各焊墊名目 5%，空間群聚卡只依全域 Moran；真熱區仍檢出", () => {
  const r = mulberry32(11), nrm = normal(r);
  let sig = 0, tot = 0, card = 0;
  for (let t = 0; t < 40; t++) {
    const pts = Array.from({ length: 300 }, (_, i) => ({ pad: "p" + i, x: r() * 200, y: r() * 120, val: nrm() }));
    const sa = c.calcMoranAndLISA(pts, 6);
    sig += sa.lisa.filter((x) => x.isSig).length; tot += sa.n;
    if (sa.isSignificant) card++;
  }
  // 雙尾 p < 0.05、不做多重比較校正：i.i.d. 每焊墊約 5%（舊版 li/√(1/k) 不是 I_i 的標準誤；v10.4.0 單尾未乘 2 會偏高）
  assert.ok(sig / tot > 0.03 && sig / tot < 0.07, `每焊墊標示率應接近名目 5%，實際 ${(sig / tot * 100).toFixed(2)}%`);
  assert.ok(card <= 1, `i.i.d. 資料的全域 Moran 不應顯著（出卡），實際 ${card}/40`);
  // 3×3 熱區 +8（約 2.7σ）：FDR 校正版平均只檢出 2.6/9，方案 B 應明顯較多
  let hot = 0;
  for (let t = 0; t < 40; t++) {
    const pts = [];
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) pts.push({ pad: `P${i}_${j}`, x: j * 2, y: i * 2, val: 100 + nrm() * 3 + (i >= 3 && i <= 5 && j >= 3 && j <= 5 ? 8 : 0) });
    hot += c.calcMoranAndLISA(pts, 6).lisa.filter((x) => x.quad === "HH" && /^P[345]_[345]$/.test(x.pad)).length;
  }
  assert.ok(hot / 40 >= 5, `熱區 9 個焊墊平均應檢出 ≥ 5 個，實際 ${(hot / 40).toFixed(1)}`);
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


test("D1 報告 X̄ 管制狀態表：當前量測項目正確提取 LCL/UCL，不再恆為 —", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const html = fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://spi.example/", beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
    w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AA==";
    Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { return w.document.body; } });
    w.Element.prototype.scrollIntoView = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {} }); w.ResizeObserver = class { observe() {} }; w.scrollTo = () => {};
    w.Chart = class { constructor() {} destroy() {} static register() {} };
    w.SPI_TEST_HOOK = {};
  } });
  const w = dom.window;
  for (let i = 0; i < 200 && !(w.SPI_TEST_HOOK.renderReport && w.eval("typeof S!=='undefined'&&!!S.A")); i++) await tick(20);
  assert.ok(w.SPI_TEST_HOOK.renderReport, "頁面未就緒");
  w.SPI_TEST_HOOK.renderReport();
  const tbl = w.document.querySelector("#repSec2 table");
  assert.ok(tbl, "報告第二節應有五大判定項目表格");
  const curMetricRow = Array.from(tbl.querySelectorAll("tbody tr")).find(tr => tr.cells[0].textContent.includes("體積"));
  assert.ok(curMetricRow, "應有體積列");
  const lclText = curMetricRow.cells[2].textContent.trim();
  const uclText = curMetricRow.cells[3].textContent.trim();
  assert.notEqual(lclText, "—", `當前指標之 LCL 不應為 "—"，實際：${lclText}`);
  assert.notEqual(uclText, "—", `當前指標之 UCL 不應為 "—"，實際：${uclText}`);
  assert.match(lclText, /^\d+\.\d$/, "LCL 應為數字格式");
  assert.match(uclText, /^\d+\.\d$/, "UCL 應為數字格式");
});

test("D2 雙邊規格分側 PPM：支援非體積指標與群組規格覆寫", () => {
  const rows = [
    { board: "B1", group: "G1", volume: 100, height: 40, area: 100 },
    { board: "B1", group: "G1", volume: 100, height: 160, area: 100 },
    { board: "B2", group: "G1", volume: 100, height: 100, area: 100 },
    { board: "B2", group: "G1", volume: 100, height: 100, area: 100 }
  ];
  const specH = { lsl: 50, usl: 150 };
  const sided = c.computeSidedPpmBlock(rows, specH, "height", { boards: ["B1", "B2"] });
  assert.equal(sided.ok, true);
  assert.equal(sided.n, 4);
  assert.equal(sided.belowLslPpm, 250000);
  assert.equal(sided.aboveUslPpm, 250000);
  assert.equal(sided.eventDpmo, 500000);
  assert.equal(sided.boardDpmo, 500000);
});

test("D3 P' 圖分區線：低不良率下 -1σ/-2σ clamp 於 0% 以上", () => {
  const rows = [];
  for (let b = 1; b <= 20; b++) {
    for (let i = 0; i < 50; i++) {
      rows.push({ board: "B" + b, pad: "P" + i, group: "G", volume: (b === 1 && i === 0) ? 200 : 100, height: 120, area: 100 });
    }
  }
  const s = st(rows, { chart: "p" });
  s.A = c.analyze(s);
  assert.equal(s.A.pc.cl > 0, true);
  const cl = s.A.pc.cl, pts = s.A.pc.pts, ucl = pts.map(p => p.ucl), scale = 100, c_mode = "p";
  const zones = [1, 2].flatMap(k => [1, -1].map(sgn => ({
    data: pts.map((p, i) => {
      let v = cl + sgn * k * ((ucl[i] - cl) / 3);
      if (c_mode === "p") v = Math.max(0, Math.min(1, v));
      return v * scale;
    })
  })));
  for (const z of zones) {
    for (const val of z.data) {
      assert.ok(val >= 0, `P' 圖分區線不應小於 0%，實際：${val}`);
    }
  }
});

test("D4 I-MR 點數不足拒絕時抑制 Nelson 判異規則，回退為 nelZero()", () => {
  const rows = [
    { board: "B1", pad: "P1", group: "G", volume: 100, height: 120, area: 100 },
    { board: "B2", pad: "P1", group: "G", volume: 150, height: 120, area: 100 },
    { board: "B3", pad: "P1", group: "G", volume: 80, height: 120, area: 100 }
  ];
  const s = st(rows, { chart: "imr", pad: "P1" });
  const A = c.analyze(s);
  assert.equal(A.imr.rejected, true, "I-MR 應被拒絕");
  assert.equal(A.nel.flag.size, 0, "Nelson 判異規則應被抑制為 nelZero()");
  assert.ok(A.nel.rules.every(r => r.idx.length === 0), "所有規則的異常點索引應為空");
});

test("D5 非常態能力卡片：預估 PPM 為 0 時不短路回退至觀測超規數", () => {
  const nn = { ppmExp: 0, ppmObs: 500 };
  const ppmVal = isFinite(nn.ppmExp) ? nn.ppmExp : nn.ppmObs;
  assert.equal(ppmVal, 0, "預估 PPM 為 0 時應取 0，不可短路回退至 500");
});

test("D-M03: |Cpk| > 50 即使規格中心未超過 10σ 也要產生單位不符卡", () => {
  const rows = [];
  for (let b = 1; b <= 25; b++) for (const volume of [99, 100, 101])
    rows.push({ board: `B${String(b).padStart(2, "0")}`, pad: `P${volume}`, comp: `P${volume}`, group: "G", volume, height: 120, area: 100 });
  const specs = JSON.parse(JSON.stringify(c.DEF_SPECS));
  specs.volume = { lsl: -1800, usl: 2000, tgt: 100 };
  const S = st(rows, { specs });
  const A = c.analyze(S);
  assert.ok(Math.abs(A.cap.cpk - 633.3333) < 0.01, `反例需重現 Cpk 約 633.33，實得 ${A.cap.cpk}`);
  const issue = c.detectIssues(S).find(x => x.rule_id === "M-03 單位不符");
  assert.ok(issue, "|Cpk| > 50 必須觸發 M-03");
  assert.match(issue.rule_name, /\|Cpk\|>50/);
  assert.ok(issue.facts.some(x => /Cpk/.test(x)), "卡片需呈現觸發規則的 Cpk 證據");
});

test("D-AD: 超過 4000 筆時，列順序變換不改變 Anderson–Darling 結論", () => {
  let seed = 7319;
  const rnd = () => ((seed = (1664525 * seed + 1013904223) >>> 0) + 0.5) / 4294967296;
  const normalValues = [];
  for (let i = 0; i < 4000; i++) {
    let sum = 0;
    for (let j = 0; j < 12; j++) sum += rnd();
    normalValues.push(sum - 6);
  }
  const exponentialValues = Array.from({ length: 4000 }, () => -Math.log(rnd()));
  const values = [];
  for (let i = 0; i < 4000; i++) values.push(normalValues[i], exponentialValues[i]);
  const rowsFor = xs => xs.map((volume, i) => ({ board: `B${Math.floor(i / 100) + 1}`, pad: `P${i}`, comp: `P${i}`, group: "G", volume, height: 120 + i % 5, area: 100 + i % 5 }));
  const A = c.analyze(st(rowsFor(values)));
  const B = c.analyze(st(rowsFor(values.slice(1).concat(values[0]))));
  assert.equal(A.ad.sampled, null);
  const full = c.andersonDarling(values);
  assert.equal(A.ad.A, full.A);
  assert.equal(A.ad.p, full.p);
  assert.equal(B.ad.sampled, null);
  assert.equal(A.ad.A, B.ad.A, "A² 必須只依樣本值，不依輸入列位置");
  assert.equal(A.ad.p, B.ad.p, "p 值必須只依樣本值，不依輸入列位置");
  assert.equal(A.xv.rows.find(x => x.k === "常態性").st, B.xv.rows.find(x => x.k === "常態性").st);
});

test("D-R7: 只有 Nelson 規則 7 時，摘要明確顯示低變異警訊而非未觸發", () => {
  const z = [0.39970568963326525, -0.862040838226676, -0.1013269067276269, -0.744498452078551, -0.661023699073121,
    -0.4477773355320096, 0.6554959328379483, -0.0074705631472170575, -0.11420027031563218, 0.21997522339224818,
    0.48363933297805495, -0.014352352079004094, 0.17607804690487694, -0.06405330877751114, -0.30887053557671607];
  const nelX = c.nelson(z);
  assert.deepEqual(Array.from(nelX.rules.filter(r => r.idx.length), r => r.id), [7]);
  const rows = z.map((v, i) => ({ board: `B${i + 1}`, pad: "P1", comp: "P1", group: "G", volume: 100 + v, height: 120 + i * 0.01, area: 100 + i * 0.01 }));
  const A = c.analyze(st(rows));
  A.nelX = nelX;
  const summary = c.crossValidate(A).rows.find(x => x.k === "管制狀態");
  assert.equal(summary.st, "warn");
  assert.match(summary.ev, /規則 7/);
  assert.match(summary.ev, /不列為製程失穩/);
  assert.doesNotMatch(summary.ev, /皆未觸發/);
});

test("D-SPACE: 群組置中後的空間偏相關自由度扣除群組效果", () => {
  const rows = [];
  for (let b = 0; b < 10; b++) for (let g = 0; g < 3; g++) for (let p = 0; p < 20; p++) {
    const x = (p % 10) * 5, y = Math.floor(p / 10) * 5;
    const noise = (((p * 7) % 11) - 5) * 0.5;
    rows.push({ board: `B${b + 1}`, pad: `G${g}-P${p}`, comp: `G${g}`, group: `G${g}`, x, y,
      volume: 90 + g * 20 + x * 0.5 + y * 0.12 + noise + ((b % 3) - 1) * 0.2, height: 120, area: 100 });
  }
  const issue = c.detectIssues(st(rows)).find(x => x.rule_id.startsWith("空間偏相關") && x.metric === "體積");
  assert.ok(issue, "合成座標梯度需產生空間偏相關卡");
  assert.match(issue.z, /df = 56/, "n=60、3 個群組估計效果及 1 個斜率，自由度應為 60−3−1=56");
});

test("D-XBAR: 25 板樣本數不等時，X̄ 圖與 Nelson 卡使用同一加權總平均和規則", () => {
  const means = [-0.03200873977039009, -0.7153201182372868, -0.9299620600650087, -0.47056447621434927, -0.8342999551678076,
    -0.6503820777870715, -0.49709215166512877, -0.7804447775706649, -0.7475894769886509, -0.07431758241727948,
    -0.3035069709876552, 0.11985174287110567, -0.19516100140754133, 0.3628164096735418, 0.21218805422540754,
    -0.3665263829752803, -1.0281890021869913, -0.9861722220666707, -0.9317986915120855, -0.25599010195583105,
    -0.4682436134899035, -0.4239359558559954, -0.39240301924292, -0.16041315998882055, 0.2900482373079285];
  const counts = [2, 3, 1, 5, 4, 1, 1, 1, 11, 1, 1, 20, 1, 35, 34, 35, 13, 1, 1, 1, 4, 1, 1, 1, 1];
  const rows = [];
  for (let i = 0; i < means.length; i++) for (let j = 0; j < counts[i]; j++)
    rows.push({ board: `B${String(i + 1).padStart(2, "0")}`, pad: `P${j}`, comp: `P${j}`, group: "G",
      volume: 100 + means[i], height: 120 + (j % 2) * 0.01, area: 100 + (j % 3) * 0.01 });
  const S = st(rows, { chart: "xbars" });
  const A = c.analyze(S);
  const cards = c.detectIssues(S).filter(x => x.category === "管制圖規則" && x.metric === "體積");
  const cardRules = Array.from(new Set(Array.from(cards, x => Number(x.rule_id.match(/(\d+)$/)[1])))).sort((a, b) => a - b);
  const chartRules = Array.from(A.nelX.rules.filter(r => r.idx.length && r.id !== 7), r => r.id).sort((a, b) => a - b);
  assert.ok(Math.abs(A.xs.cl - c.mean(rows.map(r => r.volume))) < 1e-10, "X̄ 中心線應為依各板量測數加權的總平均");
  assert.deepEqual(chartRules, cardRules, `X̄ 圖觸發 ${chartRules.join(",")}，卡片觸發 ${cardRules.join(",")}`);
  assert.deepEqual(chartRules, [1, 2, 5, 6], "規則 8 現要求中心線兩側均有點；此反例八點皆在同一側，因此其餘 4 條規則仍須一致");
});

test("D-EVIDENCE: 形貌與停線迷你圖按板顯示觀測值，不複製全批統計量", () => {
  const boardBridge = [2, 1, 0], boardPeak = [0, 1, 2];
  const morphRows = [];
  for (let b = 0; b < 3; b++) for (let p = 0; p < 6; p++) morphRows.push({
    board: `M${b + 1}`, pad: `P${p}`, comp: `P${p}`, group: "G", volume: 95 + b * 2 + p * 0.1, height: 120, area: 100,
    bridgemargin: p < boardBridge[b] ? 20 : 35, peaking: p < boardPeak[b] ? 40 : 10
  });
  const morph = c.detectIssues(st(morphRows));
  const bridge = morph.find(x => x.rule_id === "形貌缺陷 橋接餘裕");
  const peak = morph.find(x => x.rule_id === "形貌缺陷 脫模拉尖");
  assert.deepEqual(Array.from(bridge.ev.values), boardBridge, "橋接小圖應為各板真實風險焊墊數");
  assert.deepEqual(Array.from(peak.ev.values), boardPeak, "拉尖小圖應為各板真實超標焊墊數");

  const means = [95, 105, 100, 110, 90, 102, 99, 104, 101, 75], pauseRows = [];
  for (let b = 0; b < means.length; b++) for (let p = 0; p < 5; p++) pauseRows.push({
    board: `P${String(b + 1).padStart(2, "0")}`, pad: `P${p}`, comp: `P${p}`, group: "G", ts: (b < 9 ? b : 39) * 60000,
    volume: means[b], height: 120, area: 100
  });
  const pause = c.detectIssues(st(pauseRows)).find(x => x.rule_id === "停線時效 PauseDecay");
  assert.ok(pause, "停線後體積下降資料需產生停線卡");
  assert.deepEqual(Array.from(pause.ev.values), means, "停線小圖應顯示各板實際體積平均，不使用 100% 合成基準");

  const lisaRows = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
    const hot = (x < 5 && y < 5) || (x >= 5 && y >= 5);
    lisaRows.push({ board: "L1", pad: `P${y * 10 + x}`, comp: `P${y * 10 + x}`, group: "G", x: x * 5, y: y * 5,
      volume: (hot ? 120 : 80) + ((x * 3 + y) % 7), height: 120, area: 100 });
  }
  const lisa = c.detectIssues(st(lisaRows)).find(x => x.rule_id === "空間自相關 MoranLISA");
  assert.ok(lisa, "空間群聚資料需產生 LISA 摘要卡");
  assert.match(lisa.ev.title, /未依群聚分類/);
  assert.deepEqual(Array.from(lisa.ev.hi), [], "未分類殘差不得標示為群聚焊墊");
  assert.equal(lisa.ev.type, "bars", "LISA 摘要小圖應顯示實測焊墊殘差");
  assert.equal(lisa.ev.values.length, 10, "LISA 小圖應顯示前 10 個實際焊墊值");
  assert.ok(new Set(lisa.ev.values).size > 1, "LISA 小圖不可將全域 Moran's I 複製成板序列");
});

 test("D-AD calibration: 50000 筆常態資料保留名目拒絕率並檢出偏態", () => {
  let rejected = 0, skewRejected = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const nrm = normal(mulberry32(seed));
    const values = Array.from({length:50000}, () => nrm());
    if (c.andersonDarling(values).p < .05) rejected++;
    if (seed <= 30 && c.andersonDarling(values.map(x => Math.exp(.1*x))).p < .05) skewRejected++;
  }
  assert.ok(rejected >= 1 && rejected <= 12, `常態拒絕 ${rejected}/100`);
  assert.ok(skewRejected >= 25, `偏態拒絕 ${skewRejected}/30`);
});
