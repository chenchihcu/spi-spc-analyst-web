import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  calcGChart,
  calcLaneyUChart,
  calcAcfPacf,
  calcCaCpQuadrant,
  calcRollingCpk,
  calcVarianceComponents,
  calcMultiVari,
  calcOffsetEllipse,
  calcBoardProfileXY,
  calcApertureOrientation,
  calcDoeInteraction,
} from "../lib/spi-stats-ext.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Task 1: lib/spi-stats-ext.mjs 階段一純統計核心", () => {
  it("calcGChart: 依正規板序計算間隔、Benneyan 界線與亂序 CSV 防呆", () => {
    // 模擬原始列未按板序排列（B2 排在 B1 前）
    const rows = [
      { board: "B2", bad: false },
      { board: "B2", bad: true },  // 依 [B1,B2,B3] 序為第 5 個 (index 4)
      { board: "B2", bad: false },
      { board: "B1", bad: false },
      { board: "B1", bad: true },  // index 1
      { board: "B1", bad: false },
      { board: "B3", bad: false },
      { board: "B3", bad: false },
      { board: "B3", bad: true },  // index 8
    ];
    const res = calcGChart(rows, (r) => (r.bad ? ["INS"] : []), ["B1", "B2", "B3"]);
    assert.equal(res.insufficient, false);
    assert.equal(res.totalPads, 9);
    assert.equal(res.defectCount, 3);
    // 不良位置在 [B1(3), B2(3), B3(3)] 中為 index 1, 4, 8 -> 間隔 g = [2, 3]
    assert.deepEqual(res.pts.map((p) => p.g), [2, 3]);
    assert.ok(Number.isFinite(res.ucl) && res.ucl >= res.clMean);
    assert.ok(Number.isFinite(res.lcl) && res.lcl >= 0);
    assert.ok(Number.isFinite(res.clMed) && res.clMed >= 0);
  });

  it("calcGChart: 不良數 < 2 回傳 insufficient；高良率 LCL=0 區間偵測連續叢發", () => {
    const empty = calcGChart([{ board: "B1", bad: false }, { board: "B1", bad: true }], (r) => (r.bad ? ["INS"] : []), ["B1"]);
    assert.equal(empty.insufficient, true);

    // 1000 焊墊，在 index 200, 201, 202 連續不良，另在 index 800 單次不良 -> g = [0, 0, 597]
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      board: `B${Math.floor(i / 100) + 1}`,
      bad: i === 200 || i === 201 || i === 202 || i === 800,
    }));
    const boards = Array.from({ length: 10 }, (_, i) => `B${i + 1}`);
    const res = calcGChart(rows, (r) => (r.bad ? ["INS"] : []), boards);
    assert.equal(res.insufficient, false);
    assert.equal(res.defectCount, 4);
    assert.ok(res.yieldPct >= 99);
    assert.equal(res.lcl, 0);
    assert.ok(res.burstCount >= 1, "應標記連續不良叢發");
    assert.ok(res.pts.some((p) => p.burst), "應有 burst 點");
  });

  it("calcLaneyUChart: 單焊墊多缺陷累加、過度離散修正與全板零不良防呆", () => {
    // 全板零不良不可產生 NaN
    const zeroRows = [
      { board: "B1", defs: [] },
      { board: "B1", defs: [] },
      { board: "B2", defs: [] },
      { board: "B2", defs: [] },
    ];
    const zRes = calcLaneyUChart(zeroRows, (r) => r.defs, ["B1", "B2"]);
    assert.equal(zRes.insufficient, false);
    assert.equal(zRes.uBar, 0);
    assert.equal(zRes.sigmaZ, 1);
    assert.equal(zRes.pts[0].ucl, 0);
    assert.equal(zRes.pts[0].lcl, 0);
    assert.ok(Number.isFinite(zRes.pts[0].z));

    // 單焊墊多缺陷累加：B1 2 個缺陷（同 1 焊墊觸發 2 類）、B2 0 缺陷、B3 4 缺陷
    const rows = [
      { board: "B1", defs: ["INS", "OFF"] },
      { board: "B1", defs: [] },
      { board: "B2", defs: [] },
      { board: "B2", defs: [] },
      { board: "B3", defs: ["INS", "LOWH"] },
      { board: "B3", defs: ["OFF", "BRG"] },
    ];
    const uRes = calcLaneyUChart(rows, (r) => r.defs, ["B1", "B2", "B3"]);
    assert.equal(uRes.pts[0].c, 2);
    assert.equal(uRes.pts[1].c, 0);
    assert.equal(uRes.pts[2].c, 4);
    assert.equal(uRes.uBar, 1);
    assert.equal(uRes.uBarPer1k, 1000);
    assert.ok(Number.isFinite(uRes.sigmaZ) && uRes.sigmaZ > 0);
  });

  it("calcAcfPacf: AR(1) 序列檢出顯著自相關；短序列或零方差回傳 insufficient", () => {
    assert.equal(calcAcfPacf([1, 2, 3, 4, 5]).insufficient, true);
    assert.equal(calcAcfPacf([10, 10, 10, 10, 10, 10, 10, 10]).insufficient, true);

    // 確定性 AR(1) 序列（phi = 0.85, N = 30）
    const x = [0];
    let s = 12345;
    for (let i = 1; i < 30; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const e = (s / 0xffffffff - 0.5) * 0.4;
      x.push(0.85 * x[i - 1] + e);
    }
    const res = calcAcfPacf(x);
    assert.equal(res.insufficient, false);
    assert.equal(res.n, 30);
    assert.ok(res.acf[0] > 0.6, `預期 lag 1 ACF > 0.6，實際 ${res.acf[0]}`);
    assert.ok(res.pacf[0] > 0.6, `預期 lag 1 PACF > 0.6，實際 ${res.pacf[0]}`);
    assert.ok(Math.abs(res.pacf[1]) < 0.4, `預期 lag 2 PACF 接近 0，實際 ${res.pacf[1]}`);
    assert.ok(res.lbP < 0.01, `預期 Ljung-Box p < 0.01，實際 ${res.lbP}`);
  });

  it("calcCaCpQuadrant: 四象限歸類、非對稱 tgt 中點恆等式、零變異與高 Cp 軟上限", () => {
    const spec = { lsl: 70, usl: 130, tgt: 95 }; // 非對稱 tgt（中點 M = 100, H = 30）
    const mk = (group, vals) => vals.map((v) => ({ group, volume: v }));
    const rows = [
      ...mk("G_HEALTHY", [99, 100, 101, 100, 99.5, 100.5]),         // 集中且居中 -> healthy
      ...mk("G_OFFCENTER", [108, 111, 115, 119, 122, 115]),         // Cp ≈ 1.98 >= 1.33 但偏心 Ca=+50% -> Cpk ≈ 0.99 < 1.33 (offCenter)
      ...mk("G_HIGHVAR", [85, 92, 100, 108, 115, 100]),             // 居中但變異大 -> highVar
      ...mk("G_ZEROVAR", [100, 100, 100, 100, 100]),                // 零變異 -> zeroVar, cp=null
      ...mk("G_SUPERCP", [99.9, 100.0, 100.1, 100.0, 99.95, 100.05]), // 極高 Cp -> capped
    ];
    const res = calcCaCpQuadrant(rows, "volume", spec, (r) => r.group);
    assert.equal(res.insufficient, false);
    assert.equal(res.midpoint, 100);
    assert.equal(res.asymmetricTarget, true);

    const byK = Object.fromEntries(res.pts.map((p) => [p.key, p]));
    assert.equal(byK.G_HEALTHY.zone, "healthy");
    assert.equal(byK.G_OFFCENTER.zone, "offCenter");
    assert.ok(Math.abs(byK.G_OFFCENTER.ca - 50) < 0.1, "Ca 應以規格中點 100 計算得 +50%");
    // 嚴格檢驗 Cpk === Cp * (1 - |Ca|/100)
    const expCpk = byK.G_OFFCENTER.cp * (1 - Math.abs(byK.G_OFFCENTER.ca) / 100);
    assert.ok(Math.abs(byK.G_OFFCENTER.cpk - expCpk) < 1e-9);
    assert.equal(byK.G_HIGHVAR.zone, "highVar");
    assert.equal(byK.G_ZEROVAR.zeroVar, true);
    assert.equal(byK.G_ZEROVAR.cp, null);
    assert.equal(byK.G_SUPERCP.capped, true);
    assert.ok(res.softYMax < byK.G_SUPERCP.cp);
  });

  it("calcRollingCpk: 滑動視窗 Cpk 衰退斜率、零變異視窗與短板數防呆", () => {
    const spec = { lsl: 70, usl: 130, tgt: 100 };
    assert.equal(calcRollingCpk([{ lab: "B1", vals: [100, 101] }, { lab: "B2", vals: [100, 99] }], spec, 5).insufficient, true);

    // 10 片板，前 5 片居中集中、後 5 片逐步偏移且變異擴大
    const boards = Array.from({ length: 10 }, (_, i) => {
      const shift = i * 2.2;
      const spread = 1 + i * 0.6;
      return {
        lab: `B${i + 1}`,
        vals: [-2, -1, 0, 1, 2].map((d) => 100 + shift + d * spread),
      };
    });
    const res = calcRollingCpk(boards, spec, 5);
    assert.equal(res.insufficient, false);
    assert.equal(res.pts.length, 6);
    assert.ok(res.pts[0].cpk > res.pts[res.pts.length - 1].cpk, "Cpk 應隨板序衰退");
    assert.ok(res.slope < 0, `衰退斜率應為負，實際 ${res.slope}`);

    // 零變異視窗回傳 null 不為 Infinity
    const flatBoards = Array.from({ length: 5 }, (_, i) => ({ lab: `B${i + 1}`, vals: [100, 100, 100] }));
    const fRes = calcRollingCpk(flatBoards, spec, 3);
    assert.equal(fRes.pts[0].cp, null);
    assert.equal(fRes.pts[0].cpk, null);
  });

  it("同步守衛: spi-spc.html <script id='core'> 內嵌 @spi-stats-ext 區塊與 lib/spi-stats-ext.mjs 一致", () => {
    const html = fs.readFileSync(path.join(root, "spi-spc.html"), "utf8");
    const coreMatch = html.match(/<script id="core">([\s\S]*?)<\/script>/);
    assert.ok(coreMatch, "應存在 <script id='core'>");
    const core = coreMatch[1];
    const blockMatch = core.match(/\/\* @spi-stats-ext START \*\/\r?\n([\s\S]*?)\r?\n\/\* @spi-stats-ext END \*\//);
    assert.ok(blockMatch, "<script id='core'> 內應包含 @spi-stats-ext 區塊");

    const libSrc = fs.readFileSync(path.join(root, "lib", "spi-stats-ext.mjs"), "utf8")
      .replace(/^export const /gm, "const ")
      .replace(/^export function /gm, "function ")
      .replace(/^export \{[\s\S]*?\};?\s*$/m, "")
      .trim()
      .replace(/\r\n/g, "\n");
    const embedded = blockMatch[1].trim().replace(/\r\n/g, "\n");
    assert.equal(embedded, libSrc, "spi-spc.html 內嵌區塊須與 lib/spi-stats-ext.mjs 逐字一致");
  });
});

import { loadCore } from "./_load.js";

describe("Task 2: analyze() 管制圖管線整合（Laney U′ 與 G 圖）", () => {
  it("chart='u' 產出 A.uc 與 A.series（板序對齊）", () => {
    const core = loadCore();
    const rows = core.sampleData();
    const st = { ...core.S, rows, metrics: ["volume", "height", "area", "offx", "offy"], metric: "volume", group: core.ALL_GRP, comp: null, chart: "u" };
    const A = core.analyze(st);
    assert.ok(A.uc && !A.uc.insufficient, "A.uc 應有效計算");
    assert.equal(A.series.length, A.boards.length, "U′ 圖 series 長度須等於板數");
    assert.ok(Number.isFinite(A.uc.uBarPer1k));
  });

  it("chart='g' 產出 A.gc 且 Nelson 僅保留 Rule 1、Rule 2–8 為 na", () => {
    const core = loadCore();
    const rows = core.sampleData();
    const st = { ...core.S, rows, metrics: ["volume", "height", "area", "offx", "offy"], metric: "volume", group: core.ALL_GRP, comp: null, chart: "g" };
    const A = core.analyze(st);
    assert.ok(A.gc && !A.gc.insufficient, "A.gc 應有效計算");
    const r1 = A.nel.rules.find((r) => r.id === 1);
    const others = A.nel.rules.filter((r) => r.id !== 1);
    assert.equal(Boolean(r1 && r1.na), false, "G 圖 Rule 1 應啟用");
    assert.ok(others.every((r) => r.na === true), "G 圖 Rule 2–8 須標記 na: true");
  });
});

describe("Task 4: detectIssues 新增正交規則 M-22（ACF）與 M-23（G 圖高良率叢發）", () => {
  it("M-22: AR(1) 強自相關板序觸發 M-22，歸類為 process 且不使用空間分布類別", () => {
    const core = loadCore();
    const rows = [];
    // 24 片板、每板 10 個焊墊，volume 具強烈 AR(1) / 週期性波動
    let prev = 0;
    for (let bi = 0; bi < 24; bi++) {
      prev = 0.9 * prev + Math.sin(bi * 0.45) * 4;
      for (let pi = 0; pi < 10; pi++) {
        rows.push({
          board: `B${String(bi + 1).padStart(2, "0")}`,
          comp: `R${pi + 1}`,
          group: "0402",
          pad: `R${pi + 1}-1`,
          volume: 100 + prev + (pi % 3 - 1) * 0.5,
          height: 120,
          area: 100,
        });
      }
    }
    const st = { ...core.S, rows, metrics: ["volume", "height", "area"], metric: "volume", group: core.ALL_GRP, comp: null };
    const F = core.detectIssues(st);
    const acfCard = F.find((x) => x.sig && x.sig.t === "acf");
    assert.ok(acfCard, "強自相關板序應觸發 M-22 卡片");
    assert.equal(core.focusDomainOf(acfCard), "process");
    assert.notEqual(acfCard.cat, "空間分布");
    assert.ok(F.meta && F.meta.extCore && F.meta.extCore.acf, "F.meta.extCore 應附帶 ACF 結果");
  });

  it("M-23: 良率 ≥ 99% 且出現連續不良叢發觸發 M-23，歸類為 spike", () => {
    const core = loadCore();
    const rows = [];
    // 10 片板 × 100 焊墊 = 1000 焊墊，在 B05 出現 3 個連續少錫不良 + B09 1 個少錫不良（良率 99.6%）
    for (let bi = 0; bi < 10; bi++) {
      for (let pi = 0; pi < 100; pi++) {
        const isBad = (bi === 4 && (pi === 10 || pi === 11 || pi === 12)) || (bi === 8 && pi === 50);
        rows.push({
          board: `B${String(bi + 1).padStart(2, "0")}`,
          comp: `C${pi + 1}`,
          group: "0402",
          pad: `C${pi + 1}-1`,
          volume: isBad ? 55 : 100,
          height: 120,
          area: 100,
        });
      }
    }
    const st = { ...core.S, rows, metrics: ["volume", "height", "area"], metric: "volume", group: core.ALL_GRP, comp: null };
    const F = core.detectIssues(st);
    const gCard = F.find((x) => x.sig && x.sig.t === "gburst");
    assert.ok(gCard, "高良率連續不良叢發應觸發 M-23 卡片");
    assert.equal(core.focusDomainOf(gCard), "spike");
    assert.notEqual(gCard.cat, "空間分布");
    assert.ok(F.meta && F.meta.extCore && F.meta.extCore.gChart, "F.meta.extCore 應附帶 G 圖結果");
  });
});

describe("Phase 2 Task 1: lib/spi-stats-ext.mjs 變異／偏移／空間剖面／開孔方向純統計核心", () => {
  it("calcVarianceComponents & calcMultiVari: 混合交叉/巢狀分解百分比總和 100% 且正確辨識主因", () => {
    // 構造強「群組間」差異 + 中等「板間」差異 + 小殘差，且每板含 2 子板（交叉因子）
    const rows = [];
    for (let bi = 0; bi < 6; bi++) {
      const bEff = (bi - 2.5) * 2.0;
      for (let fi = 1; fi <= 2; fi++) {
        const fEff = fi === 1 ? -0.5 : 0.5;
        for (const [g, gEff] of [["0402", -8], ["BGA", 8]]) {
          for (let pi = 0; pi < 5; pi++) {
            rows.push({ board: `B${bi + 1}`, figure: String(fi), group: g, volume: 100 + gEff + bEff + fEff + (pi - 2) * 0.2 });
          }
        }
      }
    }
    const vc = calcVarianceComponents(rows, "volume");
    assert.equal(vc.insufficient, false);
    const sumPct = vc.layers.reduce((s, l) => s + l.pct, 0);
    assert.ok(Math.abs(sumPct - 100) < 0.2, `變異佔比總和應為 100%，實際 ${sumPct}`);
    assert.equal(vc.dominant.key, "group", "最大變異來源應為元件群組間");

    // 單一群組範圍自動省略 group 層，改以板間為主因
    const vcSingle = calcVarianceComponents(rows.filter((r) => r.group === "0402"), "volume");
    assert.equal(vcSingle.layers.some((l) => l.key === "group"), false);
    assert.equal(vcSingle.dominant.key, "board");

    const mv = calcMultiVari(rows, "volume", ["B1", "B2", "B3", "B4", "B5", "B6"]);
    assert.equal(mv.insufficient, false);
    assert.equal(mv.boards.length, 6);
    assert.ok(mv.strata.length >= 2);
  });

  it("calcOffsetEllipse: 計算 95% 信賴橢圓、前/後行程背隙 Hotelling T² 與奇異矩陣防呆", () => {
    const rows = [];
    for (let i = 0; i < 40; i++) {
      const fwd = i < 20;
      const dx = (i % 5 - 2) * 2.1 + (fwd ? 12 : -12);
      const dy = (Math.floor(i / 5) % 4 - 1.5) * 1.8 + (fwd ? 6 : -6);
      rows.push({ offx: dx, offy: dy, stroke: fwd ? "F" : "R" });
    }
    const res = calcOffsetEllipse(rows, { offx: { lsl: -75, usl: 75 }, offy: { lsl: -75, usl: 75 } });
    assert.equal(res.insufficient, false);
    assert.equal(res.overall.ellipse.length, 65);
    assert.ok(res.strokeSplit && res.strokeSplit.valid);
    assert.ok(res.strokeSplit.backlashUm > 20, `背隙應 > 20 µm，實際 ${res.strokeSplit.backlashUm}`);
    assert.ok(res.strokeSplit.p < 0.001, `Hotelling T² p 應 < 0.001，實際 ${res.strokeSplit.p}`);

    // coreOnly 模式跳過 65 點橢圓多邊形生成
    const fast = calcOffsetEllipse(rows, { offx: { lsl: -75, usl: 75 }, offy: { lsl: -75, usl: 75 } }, { coreOnly: true });
    assert.equal(fast.overall.ellipse.length, 0);
    assert.ok(fast.strokeSplit.p < 0.001);

    // 奇異共線矩陣防呆（offx === offy）不產生 NaN
    const collin = Array.from({ length: 20 }, (_, i) => ({ offx: i, offy: i, stroke: i < 10 ? "F" : "R" }));
    const sRes = calcOffsetEllipse(collin, {});
    assert.equal(sRes.overall.singular, true);
    assert.ok(sRes.strokeSplit.p === null || Number.isFinite(sRes.strokeSplit.p));
  });

  it("calcBoardProfileXY: 虛擬網格 fail-visible、單線座標防呆與真實斜率檢出", () => {
    // 1. 純虛擬網格（無 x/y 且無 componentX/Y）必須回傳 reason: "virtual_grid"
    const vRes = calcBoardProfileXY([{ volume: 100 }, { volume: 102 }], "volume");
    assert.equal(vRes.insufficient, true);
    assert.equal(vRes.reason, "virtual_grid");

    // 2. 真實物理座標具明顯 X 方向線性梯度（每 100mm +10%）與單線 Y 防呆
    const rows = Array.from({ length: 100 }, (_, i) => ({
      x: i,
      y: 50, // 單線共線 Y
      volume: 95 + 0.1 * i + ((i % 3) - 1) * 0.1,
    }));
    const pRes = calcBoardProfileXY(rows, "volume", { bins: 10 });
    assert.equal(pRes.insufficient, false);
    assert.equal(pRes.xAxis.bins.length, 10);
    assert.ok(Math.abs(pRes.xAxis.slopePer100mm - 10) < 0.5, `X 斜率應接近 +10/100mm，實際 ${pRes.xAxis.slopePer100mm}`);
    assert.ok(pRes.xAxis.p < 0.001);
    assert.equal(pRes.yAxis.degenerate, true, "單線 Y 軸應標記 degenerate 並不除以 0");
    assert.equal(pRes.yAxis.slopePer100mm, null);
  });

  it("calcApertureOrientation: 0° 平行 vs 90° 垂直刮刀比較與無方向性欄位防呆", () => {
    const rows = [];
    for (let i = 0; i < 30; i++) {
      // sqDir = "Y": Y 長邊（apw > apl）為平行刮刀 0°，X 長邊（apl > apw）為垂直刮刀 90°
      rows.push({ apl: 0.3, apw: 0.6, volume: 104 + (i % 3 - 1) * 0.5 }); // 0° 平行
      rows.push({ apl: 0.6, apw: 0.3, volume: 96 + (i % 3 - 1) * 0.5 });  // 90° 垂直
      rows.push({ apl: 0.5, apw: 0.5, volume: 100 });                     // 方形
    }
    const oRes = calcApertureOrientation(rows, "volume", "Y");
    assert.equal(oRes.insufficient, false);
    assert.equal(oRes.singleAxisOnly, false);
    assert.ok(oRes.diff > 7, `0° - 90° 應約 +8%，實際 ${oRes.diff}`);
    assert.ok(oRes.p < 0.001);
    assert.ok(Math.abs(oRes.cohenD) > 2);

    // 無方向性欄位（全體 apl > apw）回傳 singleAxisOnly: true
    const uni = Array.from({ length: 30 }, () => ({ apl: 0.6, apw: 0.3, volume: 100 }));
    const uRes = calcApertureOrientation(uni, "volume", "Y");
    assert.equal(uRes.singleAxisOnly, true);
  });
});

describe("Phase 2 Task 3: detectIssues 正交規則 M-24（雙行程偏移背隙）與 M-25（開孔方向效應）", () => {
  it("M-24: 前／後行程偏移存在顯著雙變量背隙時觸發 M-24，歸類為 align 且不使用空間分布類別", () => {
    const core = loadCore();
    const rows = [];
    for (let bi = 0; bi < 6; bi++) {
      const stroke = bi % 2 === 0 ? "F" : "R";
      const shift = stroke === "F" ? 18 : -18;
      for (let pi = 0; pi < 20; pi++) {
        rows.push({
          board: `B${String(bi + 1).padStart(2, "0")}`,
          comp: `U${pi + 1}`,
          group: "0402",
          pad: `U${pi + 1}-1`,
          stroke,
          volume: 100 + ((pi % 3) - 1),
          height: 120,
          area: 100,
          offx: shift + Math.sin(pi) * 2,
          offy: (stroke === "F" ? 6 : -6) + Math.cos(pi) * 2,
        });
      }
    }
    const st = { ...core.S, rows, metrics: ["volume", "height", "area", "offx", "offy"], metric: "volume", group: core.ALL_GRP, comp: null };
    const F = core.detectIssues(st);
    const card = F.find((x) => x.sig && x.sig.t === "backlash");
    assert.ok(card, "顯著雙行程偏移背隙應觸發 M-24 卡片");
    assert.equal(core.focusDomainOf(card), "align");
    assert.notEqual(card.cat, "空間分布");
    assert.ok(F.meta && F.meta.extCore && F.meta.extCore.offsetEllipse, "F.meta.extCore 應附帶 offsetEllipse");
  });

  it("M-25: 0° 平行與 90° 垂直刮刀開孔體積存在顯著差異時觸發 M-25，歸類為 aperture", () => {
    const core = loadCore();
    const rows = [];
    for (let bi = 0; bi < 4; bi++) {
      for (let pi = 0; pi < 25; pi++) {
        rows.push({
          board: `B${String(bi + 1).padStart(2, "0")}`,
          comp: `R${pi + 1}`,
          group: "0402",
          pad: `R${pi + 1}-1`,
          apl: 0.3,
          apw: 0.6,
          volume: 105 + ((pi % 3) - 1) * 1.2,
          height: 120,
          area: 100,
        });
        rows.push({
          board: `B${String(bi + 1).padStart(2, "0")}`,
          comp: `C${pi + 1}`,
          group: "0402",
          pad: `C${pi + 1}-1`,
          apl: 0.6,
          apw: 0.3,
          volume: 95 + ((pi % 3) - 1) * 1.2,
          height: 120,
          area: 100,
        });
      }
    }
    const st = { ...core.S, rows, metrics: ["volume", "height", "area"], metric: "volume", group: core.ALL_GRP, comp: null, sqDir: "Y" };
    const F = core.detectIssues(st);
    const card = F.find((x) => x.sig && x.sig.t === "orient");
    assert.ok(card, "顯著開孔方向體積差異應觸發 M-25 卡片");
    assert.equal(core.focusDomainOf(card), "aperture");
    assert.notEqual(card.cat, "空間分布");
    assert.ok(F.meta && F.meta.extCore && F.meta.extCore.orientation, "F.meta.extCore 應附帶 orientation");
  });
});

describe("Phase 3: calcDoeInteraction 雙因子交互作用圖與 2-Way ANOVA", () => {
  it("顯著交叉交互作用（p < 0.05）vs 平行線無交互（p > 0.05）", () => {
    const crossBoards = [];
    // pressure (4, 6) × speed (25, 50), 3 replicates per cell = 12 boards
    const reps = [-0.4, 0, 0.4];
    for (const r of reps) {
      crossBoards.push({ fv: { pressure: 4, speed: 25 }, y: { vol: 95 + r } });
      crossBoards.push({ fv: { pressure: 4, speed: 50 }, y: { vol: 105 + r } });
      crossBoards.push({ fv: { pressure: 6, speed: 25 }, y: { vol: 106 + r } });
      crossBoards.push({ fv: { pressure: 6, speed: 50 }, y: { vol: 96 + r } });
    }
    const cRes = calcDoeInteraction(crossBoards, "vol", ["pressure", "speed"]);
    assert.equal(cRes.insufficient, false);
    assert.equal(cRes.pairs.length, 1);
    assert.equal(cRes.pairs[0].significant, true, "交叉折線應檢出顯著交互");
    assert.ok(cRes.pairs[0].p < 0.001, `p 應遠小於 0.001，實際 ${cRes.pairs[0].p}`);

    // 平行線：無交互
    const parBoards = [];
    for (const r of reps) {
      parBoards.push({ fv: { pressure: 4, speed: 25 }, y: { vol: 95 + r } });
      parBoards.push({ fv: { pressure: 4, speed: 50 }, y: { vol: 100 + r } });
      parBoards.push({ fv: { pressure: 6, speed: 25 }, y: { vol: 101 + r } });
      parBoards.push({ fv: { pressure: 6, speed: 50 }, y: { vol: 106 + r } });
    }
    const pRes = calcDoeInteraction(parBoards, "vol", ["pressure", "speed"]);
    assert.equal(pRes.pairs[0].significant, false, "平行線不應觸發顯著交互");
    assert.ok(pRes.pairs[0].p > 0.5, `p 應大於 0.5，實際 ${pRes.pairs[0].p}`);
  });

  it("無重複樣本（dfErr <= 0）、缺格子與不足 2 因子防呆（無 NaN）", () => {
    const unrep = [
      { fv: { pressure: 4, speed: 25 }, y: { vol: 96 } },
      { fv: { pressure: 4, speed: 50 }, y: { vol: 104 } },
      { fv: { pressure: 6, speed: 25 }, y: { vol: 103 } },
      { fv: { pressure: 6, speed: 50 }, y: { vol: 97 } },
    ];
    const uRes = calcDoeInteraction(unrep, "vol", ["pressure", "speed"]);
    assert.equal(uRes.insufficient, false);
    assert.equal(uRes.pairs[0].F, null);
    assert.equal(uRes.pairs[0].p, null);
    assert.match(uRes.pairs[0].noTestReason, /無重複樣本/);

    const missing = [
      { fv: { pressure: 4, speed: 25 }, y: { vol: 96 } },
      { fv: { pressure: 4, speed: 25 }, y: { vol: 97 } },
      { fv: { pressure: 4, speed: 50 }, y: { vol: 104 } },
      { fv: { pressure: 6, speed: 25 }, y: { vol: 103 } },
    ];
    const mRes = calcDoeInteraction(missing, "vol", ["pressure", "speed"]);
    assert.equal(mRes.pairs[0].hasMissingCells, true);
    assert.equal(mRes.pairs[0].p, null);
    assert.match(mRes.pairs[0].noTestReason, /缺資料/);

    const oneFac = [{ fv: { pressure: 4 }, y: { vol: 100 } }, { fv: { pressure: 6 }, y: { vol: 102 } }];
    assert.equal(calcDoeInteraction(oneFac, "vol", ["pressure", "speed"]).insufficient, true);
  });

  it("doeAnalyze() 整合：DOE 範例資料產出 3 組雙因子配對交互作用", () => {
    const core = loadCore();
    const rows = core.sampleData({ variant: "DOE" });
    const st = { ...core.S, rows, metrics: ["volume", "height", "area", "offx", "offy"] };
    const D = core.doeAnalyze(st, "vol");
    assert.ok(D && D.interaction && !D.interaction.insufficient, "DOE 範例應產出 interaction");
    assert.equal(D.interaction.pairs.length, 3, "3 個因子應產出 C(3,2)=3 組配對");
  });
});





