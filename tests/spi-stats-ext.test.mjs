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
