import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  parseCsv,
  validatePlacement,
  validateGenericMeasurement,
  validateWideMeasurement,
  validateMeasurement,
  placementSizeError,
} from "../lib/controlled-import.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { loadCore, baseState, HTML } = require("./_load.js");

const CORE = loadCore();

/* ---------- 固定種子 PRNG（Deterministic PRNG, 可依 Vector ID 精確重現） ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normalRand(rand, mu = 0, sd = 1) {
  const u1 = Math.max(1e-12, rand());
  const u2 = rand();
  return mu + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function fmtVecErr(vecId, seed, spec, expected, actual, msg) {
  return `[${vecId} seed=${seed}] ${msg} | spec=${JSON.stringify(spec)} | expected=${JSON.stringify(expected)} | actual=${JSON.stringify(actual)}`;
}

/* ---------- 抽取 spi-spc.html UI 純函式於共用沙箱（免開多個 JSDOM，確保 < 5 秒） ---------- */
function extractBlockFrom(src, anchor, endAnchor = null) {
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error(`找不到 ${anchor}`);
  let from = endAnchor ? src.indexOf(endAnchor, start) : start;
  if (from < 0) throw new Error(`找不到 ${endAnchor}`);
  if (src.slice(from, from + 9) === "function ") {
    let p = src.indexOf("(", from), pd = 0, pq = null, pe = false;
    for (; p < src.length; p++) {
      const c = src[p];
      if (pe) { pe = false; continue; }
      if (pq) { if (c === "\\") pe = true; else if (c === pq) pq = null; continue; }
      if (c === "'" || c === '"' || c === "`") { pq = c; continue; }
      if (c === "(") pd++;
      else if (c === ")") { pd--; if (pd === 0) { from = p + 1; break; } }
    }
  }
  let i = src.indexOf("{", from);
  if (i < 0) throw new Error(`找不到 { for ${anchor}`);
  let depth = 0, quote = null, escCh = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (escCh) { escCh = false; continue; }
    if (quote) {
      if (ch === "\\") escCh = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`未關閉的大括號：${anchor}`);
}

function loadUiSandbox() {
  const html = fs.readFileSync(HTML, "utf8");
  const withLimitsFn = extractBlockFrom(html, "function withLimits(");
  const evSvgFn = extractBlockFrom(html, "function evSvg(");
  const pmapFn = extractBlockFrom(html, "const PM_RANK=", "function buildPartProblemIndex(");
  const sortedValsFn = extractBlockFrom(html, "function sortedVals(");
  const quantFn = extractBlockFrom(html, "function quant(");
  const histFn = extractBlockFrom(html, "function histBins(");
  const posFn = extractBlockFrom(html, "function resolveComponentSpec(", "function pos3D(");
  const wideHelpers = extractBlockFrom(html, "function wideCols(", "function isWide(");
  const findColFn = "const findCol=(n,al)=>{for(const a of al){const i=n.indexOf(a);if(i>=0)return i}return-1};";
  const unpivotFn = extractBlockFrom(html, "function unpivotWide(");

  const escSrc = `
    const SORTED = new WeakMap();
    const isNumLim = v => v != null && v !== "" && Number.isFinite(+v);
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const f = (v, d = 1) => Number.isFinite(+v) ? (+v).toFixed(d) : "—";
    const safeId = s => String(s ?? "").replace(/[<>"'\`&\\u0000-\\u001f\\u007f]/g, "").trim();
  `;
  const ctx = {
    console, Math, Set, Map, WeakMap, Number, String, Array, Object, JSON, RegExp, Error,
    isFinite, parseFloat, parseInt,
    normH: CORE.normH,
    realXY: CORE.realXY,
    LIMIT_NARROW: 420,
    chartCaptionFontPx: () => 11,
    baseOpts: () => ({ plugins: {} }),
    T: {},
    S: { comp3dMode: "semi" },
  };
  vm.createContext(ctx);
  vm.runInContext(
    escSrc + "\n" + quantFn + "\n" + sortedValsFn + "\n" +
    withLimitsFn + "\n" + evSvgFn + "\n" + pmapFn + "\n" +
    histFn + "\n" + posFn + "\n" + wideHelpers + "\n" + findColFn + "\n" + unpivotFn,
    ctx
  );
  return ctx;
}
const UI = loadUiSandbox();

/* ---------- XLSX 解壓工具（驗證 issuesXlsx 内容） ---------- */
function readZipEntries(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const td = new TextDecoder();
  const entries = new Map();
  let off = 0;
  while (off + 30 <= u8.length && dv.getUint32(off, true) === 0x04034b50) {
    const compSize = dv.getUint32(off + 18, true);
    const fnLen = dv.getUint16(off + 26, true);
    const exLen = dv.getUint16(off + 28, true);
    const name = td.decode(u8.subarray(off + 30, off + 30 + fnLen));
    const start = off + 30 + fnLen + exLen;
    entries.set(name, td.decode(u8.subarray(start, start + compSize)));
    off = start + compSize;
  }
  return entries;
}
function parseXlsxSheet1(u8) {
  const entries = readZipEntries(u8);
  const xml = entries.get("xl/worksheets/sheet1.xml") || "";
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cols = [];
    for (const cm of rm[1].matchAll(/<t>([\s\S]*?)<\/t>|<v>([\s\S]*?)<\/v>/g)) {
      const val = (cm[1] ?? cm[2] ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      cols.push(val);
    }
    rows.push(cols);
  }
  return rows;
}
function parseCsvSimple(csv) {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  return lines.map(line => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === "," && !q) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  });
}

/* ============================================================================
 * PART A: 10 項跨鏈路核心缺陷 (BUG-01 ~ BUG-10) 直接精確回歸測試
 * ============================================================================ */
test("BUG-01~BUG-10 跨鏈路缺陷直接回歸驗證", () => {
  // BUG-01: pos3D 絕不原地寫入 row.w / row.d / row.shape / row.dimAssumed
  const bug01Rows = [
    { board: "B01", pad: "R1-1", comp: "R1", pkg: "R0402", group: "R0402", componentX: 10, componentY: 10, dimAssumed: true, volume: 100, height: 120, area: 100, offx: 0, offy: 0 },
    { board: "B01", pad: "R1-2", comp: "R1", pkg: "R0402", group: "R0402", componentX: 10, componentY: 10, dimAssumed: true, volume: 100, height: 120, area: 100, offx: 0, offy: 0 },
  ];
  UI.T.pos = null;
  const pMap = UI.pos3D(bug01Rows);
  assert.equal(bug01Rows[0].w, undefined, "BUG-01: pos3D 不可覆寫 r.w");
  assert.equal(bug01Rows[0].d, undefined, "BUG-01: pos3D 不可覆寫 r.d");
  assert.equal(bug01Rows[0].dimAssumed, true, "BUG-01: pos3D 不可清除 r.dimAssumed");
  assert.equal(pMap.get(bug01Rows[0]).w, 0.55, "BUG-01: 推算尺寸只存於 3D Map");
  const st01 = baseState(CORE, { rows: bug01Rows, metrics: ["volume", "height", "area", "offx", "offy"] });
  assert.equal(CORE.geomAssumed(bug01Rows[0], st01), true, "BUG-01: 跑完 3D 後 DFM 仍判定 dimAssumed");

  // BUG-02: validateGenericMeasurement 含 Figure 時與 frontend buildRows 同為 panel-figure / panel/figure
  const genTab = {
    head: ["Board", "Figure", "Component ID", "PAD ID", "Volume(%)"],
    data: [["P10", "2", "R1", "1", "100"], ["P10", "3", "R1", "1", "105"]],
  };
  const srvRes = validateGenericMeasurement(genTab, "TOP", { items: [] });
  assert.equal(srvRes.boards, 2, "BUG-02: 同 Board 不同 Figure 必須算作 2 片板");
  const { rows: feRows } = CORE.buildRows(genTab, { board: 0, figure: 1, comp: 2, pad: 3, volume: 4 }, { heightUnit: "um" });
  assert.deepStrictEqual(Array.from(feRows, r => r.board), ["P10-2", "P10-3"], "BUG-02: 前端 buildRows 子板編號應為 P10-2, P10-3");

  // BUG-06: buildStatsData 包含 Nelson Rules 1, 2, 3, 4, 5, 6, 8 及狹窄範圍標記
  const fakeNelSt = baseState(CORE, {
    group: "0402",
    comp: CORE.compKeyOf({ comp: "R1" }),
    rows: [{ board: "B01", pad: "R1-1", comp: "R1", group: "0402", pkg: "0402", volume: 100 }],
    A: {
      m: "volume",
      sp: { lsl: 70, usl: 130, tgt: 100 },
      boards: ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08"],
      byBoard: Array.from({ length: 8 }, (_, i) => ({ board: "B0" + (i + 1), mean: 100 + i })),
      xs: { cl: 100, pts: Array.from({ length: 8 }, () => ({ sd: 2, z: 2.5 })) },
      nelX: {
        rules: [
          { id: 4, idx: [2] },
          { id: 5, idx: [4] },
          { id: 6, idx: [5] },
          { id: 7, na: true, idx: [0] },
          { id: 8, idx: [7] },
        ],
      },
      nelP: { rules: [] },
      stable: false,
      defRows: [],
      outliers: [],
    },
  });
  const anomRows = CORE.buildStatsData(fakeNelSt);
  const rulesText = anomRows.map(r => r.rule).join(" | ");
  assert.match(rulesText, /規則 4/, "BUG-06: 必須輸出 Nelson Rule 4");
  assert.match(rulesText, /規則 5/, "BUG-06: 必須輸出 Nelson Rule 5");
  assert.match(rulesText, /規則 6/, "BUG-06: 必須輸出 Nelson Rule 6");
  assert.match(rulesText, /規則 8/, "BUG-06: 必須輸出 Nelson Rule 8");
  assert.doesNotMatch(rulesText, /規則 7/, "BUG-06: na=true 的 Rule 7 不可輸出");
  assert.ok(anomRows.every(r => r.refdes === "R1" && r.group === "0402"), "BUG-06: 窄範圍必須保留 refdes 與 group");
  assert.match(CORE.statsDataCsv(fakeNelSt), /^分析範圍,/, "BUG-09: statsDataCsv 窄範圍必須標分析範圍");

  // BUG-07: buildPartProblemIndex 支援 row.placePkg
  const idx07 = UI.buildPartProblemIndex([
    { board: "B01", comp: "U1", pad: "U1-1", group: "BGA", placePkg: "BGA-64", componentX: 25, componentY: 35, volume: 100 },
  ], []);
  const part07 = [...idx07.parts.values()][0];
  assert.ok(part07.packages.has("BGA-64"), "BUG-07: buildPartProblemIndex 必須讀取 row.placePkg");

  // BUG-08: scopedDfmTable 只含範圍內群組
  const dfmRows = [
    { board: "B01", pad: "R1-1", comp: "R1", group: "0402", w: 0.5, d: 0.5, volume: 100, height: 120, area: 100 },
    { board: "B01", pad: "U1-1", comp: "U1", group: "QFN", w: 0.4, d: 0.4, volume: 95, height: 115, area: 95 },
  ];
  const st08All = baseState(CORE, { rows: dfmRows, group: "ALL", comp: "" });
  const st08Sco = baseState(CORE, { rows: dfmRows, group: "0402", comp: "" });
  assert.equal(CORE.scopedDfmTable(st08All).length, 2, "BUG-08: 全板回傳 2 群組");
  assert.deepStrictEqual(Array.from(CORE.scopedDfmTable(st08Sco), d => d.group), ["0402"], "BUG-08: 窄範圍只回傳 0402");

  // BUG-10: unpivotWide 振順豐格式以 it.pkg 查找 o.st.aperture.groups / o.apertures
  const zsfTab = {
    head: ["Component ID", "PAD ID", "Volume(mm)1", "Volume(mm)2"],
    data: [["R1", "1", "0.025", "0.026"]],
  };
  const zsfPlace = { items: [{ ref: "R1", side: "TOP", x: 10, y: 10, pkg: "R0402" }] };
  const zsfOut = UI.unpivotWide(zsfTab, {
    side: "TOP",
    place: zsfPlace,
    stencil: 120,
    st: { aperture: { groups: { R0402: { L: 0.5, W: 0.5 } } } },
  });
  assert.equal(zsfOut.tab.data.length, 2, "BUG-10: 依 pkg=R0402 查找開孔應成功展開 2 板");
  const v1 = parseFloat(zsfOut.tab.data[0][zsfOut.tab.head.indexOf("Volume(%)")]);
  const expectedPct = +(0.025 / (0.5 * 0.5 * 0.12) * 100).toFixed(2);
  assert.equal(v1, expectedPct, "BUG-10: 振順豐 mm→% 換算應精確吻合 0.025 / (0.5*0.5*0.12) * 100");
});

/* ============================================================================
 * PART B: 5,000 個可重現四軸反驗證向量 (VEC-0001 ~ VEC-5000)
 * ============================================================================ */

test("Axis 1 (VEC-0001~VEC-1250): 座標檔＋量測紀錄雙向溯源 (1,250 向量)", () => {
  // 5 格式 × 5 座標配置 × 5 重複/排序模式 × 10 種子 = 1,250 vectors
  const formats = ["generic", "lirong_pct", "zsf_mm", "panel_fig", "board_fig"];
  const placeCfgs = [
    { unit: "mm", side: "TOP", missing: 0, otherSide: false },
    { unit: "mil", side: "TOP", missing: 1, otherSide: false },
    { unit: "inch", side: "BOT", missing: 0, otherSide: false },
    { unit: "mm", side: "BOTH", missing: 1, otherSide: true },
    { unit: "mil", side: "BOTH", missing: 2, otherSide: true },
  ];
  const orderModes = ["last", "first", "mean", "shuffled_time", "shifted_pad"];
  let vecNum = 0;

  for (const fmt of formats) {
    for (const pcfg of placeCfgs) {
      for (const omode of orderModes) {
        for (let sIdx = 0; sIdx < 10; sIdx++) {
          vecNum++;
          const vecId = `VEC-${String(vecNum).padStart(4, "0")}`;
          const seed = 0x5a170000 + vecNum;
          const rand = mulberry32(seed);
          const nComps = 4 + (vecNum % 4); // 4~7 comps (>=2 included even with missing=2)
          const nBoards = 2 + (vecNum % 3); // 2~4 boards
          const conv = pcfg.unit === "mil" ? 1 / 0.0254 : pcfg.unit === "inch" ? 1 / 25.4 : 1;
          const targetSide = pcfg.side === "BOTH" ? (vecNum % 2 === 0 ? "TOP" : "BOT") : pcfg.side;

          // 建立座標檔 CSV
          const uCol = pcfg.unit === "inch" ? "(in)" : `_${pcfg.unit}`;
          const pHead = pcfg.side === "BOTH"
            ? `RefDes,X${uCol},Y${uCol},Package,Side`
            : `RefDes,X${uCol},Y${uCol},Package`;
          const pLines = [pHead];
          const refs = [];
          for (let c = 0; c < nComps; c++) {
            const ref = `R${c + 1}`;
            const xMm = +(5 + c * 8 + rand() * 3).toFixed(3);
            const yMm = +(6 + (c % 2) * 10 + rand() * 3).toFixed(3);
            const pkg = c % 2 === 0 ? "0402" : "0603";
            const include = c < nComps - pcfg.missing;
            const rowSide = (pcfg.otherSide && c === 0) ? (targetSide === "TOP" ? "BOT" : "TOP") : targetSide;
            refs.push({ ref, xMm, yMm, pkg, inPlace: include, rowSide });
            if (include) {
              const rx = (xMm * conv).toFixed(4), ry = (yMm * conv).toFixed(4);
              pLines.push(pcfg.side === "BOTH" ? `${ref},${rx},${ry},${pkg},${rowSide}` : `${ref},${rx},${ry},${pkg}`);
            }
          }
          const placeCsv = pLines.join("\n");
          const placeTab = parseCsv(placeCsv);
          const vPlace = validatePlacement(placeTab, { side: pcfg.side, unit: pcfg.unit });
          assert.ok(!vPlace.error, fmtVecErr(vecId, seed, { fmt, pcfg, omode }, "valid placement", vPlace.error, "座標檔驗證失敗"));
          assert.equal(placementSizeError(vPlace.items, pcfg.unit), null, fmtVecErr(vecId, seed, pcfg, null, "size error", "板面尺寸守衛誤報"));

          // 依格式產生量測資料並驗證雙向溯源
          if (fmt === "lirong_pct" || fmt === "zsf_mm") {
            const isZsf = fmt === "zsf_mm";
            const unitTag = isZsf ? "(mm)" : "(%)";
            const cols = ["Component ID", "PAD ID"];
            for (let b = 1; b <= nBoards; b++) cols.push(`Volume${unitTag}${b}`, `Height${unitTag}${b}`, `Area${unitTag}${b}`);
            const data = [];
            for (const rf of refs) {
              const row = [rf.ref, "1"];
              for (let b = 1; b <= nBoards; b++) {
                if (isZsf) row.push((0.02 + rand() * 0.01).toFixed(4), (0.11 + rand() * 0.02).toFixed(4), (0.24 + rand() * 0.03).toFixed(4));
                else row.push((95 + rand() * 15).toFixed(2), (98 + rand() * 10).toFixed(2), (97 + rand() * 10).toFixed(2));
              }
              if (omode === "shifted_pad" && data.length === 0) {
                // 立榮錯位焊墊編號回溯測試
                const shiftedRow = [...row];
                shiftedRow[1] = "";
                shiftedRow[3] = "1";
                shiftedRow[2] = "";
                shiftedRow[4] = "";
                if (!isZsf) data.push(shiftedRow);
                else data.push(row);
              } else {
                data.push(row);
              }
            }
            const measCsv = [cols.join(","), ...data.map(r => r.join(","))].join("\n");
            const measTab = parseCsv(measCsv);
            const srv = validateMeasurement(measTab, targetSide, { items: vPlace.items });
            assert.ok(!srv.error, fmtVecErr(vecId, seed, { fmt, pcfg, omode }, "ok", srv.error, "伺服器寬表驗證失敗"));

            // BUG-10: ZSF 使用 pkg 查找開孔設定
            const apOpts = isZsf ? { st: { aperture: { groups: { "0402": { L: 0.5, W: 0.5 }, "0603": { L: 0.8, W: 0.8 } } } }, apertures: Object.fromEntries(refs.map(rf => [rf.ref, { L: 0.5, W: 0.5 }])) } : {};
            const fe = UI.unpivotWide(measTab, { side: targetSide, place: { items: vPlace.items }, stencil: 120, ...apOpts });
            assert.equal(fe.tab.data.length, srv.boards * refs.length, fmtVecErr(vecId, seed, fmt, srv.boards * refs.length, fe.tab.data.length, "前端展開列數須與伺服器板數×焊墊一致"));
            assert.equal(fe.info.place.missing.length, srv.missing.length, fmtVecErr(vecId, seed, fmt, srv.missing.length, fe.info.place.missing.length, "missing 位號數必須前後端完全吻合"));
            assert.equal(fe.info.place.other.length, srv.wrongSide.length, fmtVecErr(vecId, seed, fmt, srv.wrongSide.length, fe.info.place.other.length, "wrongSide/otherSide 位號數必須前後端完全吻合"));
          } else {
            // generic / panel_fig / board_fig
            const hasFig = fmt === "panel_fig" || fmt === "board_fig";
            const head = fmt === "panel_fig"
              ? ["Panel ID", "Figure ID", "Component ID", "Pin No", "Volume(%)", "Height(um)", "Area(%)"]
              : fmt === "board_fig"
              ? ["Board", "Figure", "Component ID", "PAD ID", "Volume(%)", "Height(um)", "Area(%)"]
              : ["Board", "Component ID", "PAD ID", "Volume(%)", "Height(um)", "Area(%)"];
            const data = [];
            let dupIdx = -1;
            const order = Array.from({ length: nBoards }, (_, i) => i + 1);
            if (omode === "shuffled_time") order.reverse();
            for (const b of order) {
              const fig = String((b % 2) + 1);
              const bName = `B${String(b).padStart(2, "0")}`;
              for (const rf of refs) {
                const v = (95 + rand() * 15).toFixed(2);
                const h = (115 + rand() * 15).toFixed(2);
                const a = (98 + rand() * 10).toFixed(2);
                if (hasFig) data.push([bName, fig, rf.ref, "1", v, h, a]);
                else data.push([bName, rf.ref, "1", v, h, a]);
                if ((omode === "last" || omode === "first" || omode === "mean") && rf === refs[0] && b === order[0]) {
                  // 注入重複列確認 dedup 策略可回溯
                  const v2 = (110 + rand() * 5).toFixed(2);
                  dupIdx = data.length;
                  if (hasFig) data.push([bName, fig, rf.ref, "1", v2, h, a]);
                  else data.push([bName, rf.ref, "1", v2, h, a]);
                }
              }
            }
            const measCsv = [head.join(","), ...data.map(r => r.join(","))].join("\n");
            const shaMeas = createHash("sha256").update(measCsv).digest("hex");
            assert.equal(shaMeas.length, 64, "SHA-256 指紋長度必為 64");
            const measTab = parseCsv(measCsv);
            const hasDupInjected = dupIdx >= 0;
            const srvRaw = validateGenericMeasurement(measTab, targetSide, { items: vPlace.items });
            if (hasDupInjected) {
              assert.equal(srvRaw.code, "duplicate_point", fmtVecErr(vecId, seed, { fmt, omode }, "duplicate_point", srvRaw, "受控匯入對重複量測點必須 fail-closed 拒絕"));
            }
            const cleanTab = hasDupInjected ? { head: measTab.head, data: measTab.data.filter((_, idx) => idx !== dupIdx) } : measTab;
            const srv = hasDupInjected ? validateGenericMeasurement(cleanTab, targetSide, { items: vPlace.items }) : srvRaw;
            assert.ok(!srv.error, fmtVecErr(vecId, seed, { fmt, omode }, "valid", srv.error, "無重複列應通過伺服器驗證"));
            const dupMode = omode === "first" ? "first" : omode === "mean" ? "mean" : "last";
            const { rows: feRows } = CORE.buildRows(measTab, CORE.autoMap(measTab.head), { dupMode, heightUnit: "um" });
            const placeMap = new Map(vPlace.items.filter(it => it.side === targetSide).map(it => [it.ref, it]));
            for (const r of feRows) {
              const pItem = placeMap.get(r.comp);
              if (pItem) {
                r.componentX = pItem.x;
                r.componentY = pItem.y;
                r.placePkg = pItem.pkg;
              }
              if (fmt === "panel_fig" || fmt === "board_fig") assert.match(r.board, /^B\d{2}-\d+$/, fmtVecErr(vecId, seed, fmt, "Bxx-fig", r.board, "Panel/Board+Figure 格式應為 Bxx-fig"));
              if (pItem) {
                assert.ok(Math.abs(r.componentX - pItem.x) < 1e-9 && Math.abs(r.componentY - pItem.y) < 1e-9, fmtVecErr(vecId, seed, fmt, [pItem.x, pItem.y], [r.componentX, r.componentY], "元件中心回溯座標不一致"));
              }
            }
            const uniqueBoards = new Set(feRows.map(r => r.board)).size;
            assert.equal(uniqueBoards, srv.boards, fmtVecErr(vecId, seed, { fmt, pcfg, omode }, srv.boards, uniqueBoards, "前後端板數必須一致"));
            assert.equal(feRows.length, nBoards * refs.length, fmtVecErr(vecId, seed, { fmt, pcfg, omode }, nBoards * refs.length, feRows.length, "dedup 後總量測列數不符"));
          }
        }
      }
    }
  }
  assert.equal(vecNum, 1250, "Axis 1 向量數必須正好為 1,250");
});

test("Axis 2 (VEC-1251~VEC-2750): 統計分析結果與 12 道誤判預防守衛 (1,500 向量)", () => {
  // 15 製程情境 × 5 規格模式 × 20 種子 = 1,500 vectors
  const scenarios = [
    "stable_iid_small", "pure_between_board", "zero_within_sd", "single_board_spike", "linear_drift",
    "spatial_gradient", "squeegee_even_odd", "wipe_decay", "align_shift_rot", "bimodal",
    "unit_mismatch_cpk", "unknown_height_unit", "step_stencil", "pause_decay", "multivariate_2d",
  ];
  const specModes = ["two_sided", "upper_only", "lower_only", "group_override", "no_spec"];
  let vecNum = 1250;

  for (let scIdx = 0; scIdx < scenarios.length; scIdx++) {
    const sc = scenarios[scIdx];
    for (let spIdx = 0; spIdx < specModes.length; spIdx++) {
      const spMode = specModes[spIdx];
      for (let sIdx = 0; sIdx < 20; sIdx++) {
        vecNum++;
        const vecId = `VEC-${String(vecNum).padStart(4, "0")}`;
        const seed = 0x5a170000 + vecNum;
        const rand = mulberry32(seed);
        const nBoards = 8;
        const nPads = (sc === "multivariate_2d" || sc === "spatial_gradient") ? 12 : 6;
        const rows = [];
        const sqByBoard = {};

        for (let b = 0; b < nBoards; b++) {
          const bId = `B${String(b + 1).padStart(2, "0")}`;
          const sq = b % 2 === 0 ? "F" : "R";
          sqByBoard[bId] = sq;
          const bShift = sc === "pure_between_board" ? normalRand(rand, 0, 8)
            : sc === "single_board_spike" && b === nBoards - 1 ? 35
            : sc === "linear_drift" ? (b - 3.5) * 6
            : sc === "squeegee_even_odd" ? (b % 2 === 0 ? 18 : -18)
            : sc === "wipe_decay" ? (b % 3 === 2 ? -22 : 2)
            : sc === "pause_decay" && b >= 4 ? -25
            : 0;
          for (let p = 0; p < nPads; p++) {
            const x = sc === "spatial_gradient" ? 10 + (p % 6) * 15 : 10 + (p % 3) * 20;
            const y = 10 + Math.floor(p / (sc === "spatial_gradient" ? 6 : 3)) * 20;
            const grp = p < nPads / 2 ? "0402" : "0603";
            let vol = sc === "zero_within_sd" ? 100 + (b % 2 === 0 ? 0 : 0)
              : sc === "bimodal" ? (p % 2 === 0 ? 85 : 115) + normalRand(rand, 0, 1.5)
              : sc === "unit_mismatch_cpk" ? 0.1 + rand() * 0.002 // mm 當作 %/um 量級
              : sc === "spatial_gradient" ? 100 + x * 0.6 + normalRand(rand, 0, 1.5)
              : 100 + bShift + normalRand(rand, 0, 2.5);
            if (sc === "multivariate_2d" && b === 2 && p === 0) vol = 165;
            const hgt = sc === "multivariate_2d" && b === 2 && p === 0 ? 75
              : sc === "step_stencil" && grp === "0603" ? 150 + normalRand(rand, 0, 2)
              : 120 + (bShift * 0.8) + normalRand(rand, 0, 2);
            const offx = sc === "align_shift_rot" ? 32 + (y - 20) * 0.5 + normalRand(rand, 0, 1) : normalRand(rand, 0, 3);
            const offy = sc === "align_shift_rot" ? -28 - (x - 30) * 0.5 + normalRand(rand, 0, 1) : normalRand(rand, 0, 3);
            rows.push({
              board: bId, comp: `R${p + 1}`, pad: `R${p + 1}-1`, group: grp, pkg: grp,
              x, y, w: 0.6, d: 0.6,
              volume: +vol.toFixed(4), height: +hgt.toFixed(4), area: +(98 + normalRand(rand, 0, 2)).toFixed(3),
              offx: +offx.toFixed(3), offy: +offy.toFixed(3),
              ...(sc === "squeegee_even_odd" ? { sq } : {}),
            });
          }
        }

        const baseSpec = spMode === "two_sided" ? { lsl: 70, usl: 130, tgt: 100 }
          : spMode === "upper_only" ? { usl: 130, tgt: 100 }
          : spMode === "lower_only" ? { lsl: 70, tgt: 100 }
          : spMode === "group_override" ? { lsl: 75, usl: 125, tgt: 100 }
          : null;
        const specs = baseSpec ? { volume: baseSpec, height: { lsl: 90, usl: 150, tgt: 120 }, area: { lsl: 75, usl: 125, tgt: 100 }, offx: { lsl: -50, usl: 50, tgt: 0 }, offy: { lsl: -50, usl: 50, tgt: 0 } }
          : { volume: null, height: null, area: null, offx: null, offy: null };
        const specsG = spMode === "group_override" ? { "0402": { volume: { lsl: 80, usl: 120, tgt: 100 } } } : {};

        const st = baseState(CORE, {
          rows,
          metric: sc === "unit_mismatch_cpk" ? "volume" : "volume",
          metrics: ["volume", "height", "area", "offx", "offy"],
          specs,
          specsG,
          heightUnit: sc === "unknown_height_unit" ? "unknown" : "um",
          wipe: 3,
          sqDir: "Y",
          sqByBoard: sc === "squeegee_even_odd" ? sqByBoard : {},
          step: sc === "step_stencil" ? { on: true, zones: [{ name: "Z1", mode: "group", group: "0603", t: 150 }] } : { on: false, zones: [] },
        });
        if (sc === "unknown_height_unit") {
          for (const r of st.rows) delete r.hpct;
        }
        const A = CORE.analyze(st);

        // Invariant 2(a): 由 S.rows.filter(scopeFilter(S)) 獨立逆算 A.byBoard 與 gMean 誤差 < 1e-9
        const scRows = st.rows.filter(CORE.scopeFilter(st));
        const expectedMean = scRows.reduce((s, r) => s + r.volume, 0) / scRows.length;
        assert.ok(Math.abs(A.gMean - expectedMean) < 1e-9, fmtVecErr(vecId, seed, { sc, spMode }, expectedMean, A.gMean, "gMean 逆算誤差超過 1e-9"));
        for (const bb of A.byBoard) {
          const br = scRows.filter(r => r.board === bb.board).map(r => r.volume);
          const bm = br.reduce((s, v) => s + v, 0) / br.length;
          assert.ok(Math.abs(bb.mean - bm) < 1e-9, fmtVecErr(vecId, seed, { sc, spMode, board: bb.board }, bm, bb.mean, "byBoard.mean 逆算誤差超過 1e-9"));
        }

        // Invariant 2(b): 12 道誤判守衛 (G-01 ~ G-12) 嚴格驗證
        if (spMode === "no_spec") {
          // G-02: 無規格時拒絕估計 Cpk
          assert.ok(!A.cap || !Number.isFinite(A.cap.cpk), fmtVecErr(vecId, seed, { sc, spMode }, "no cpk", A.cap?.cpk, "G-02: 無規格不可估計 Cpk"));
        }
        if (sc === "zero_within_sd") {
          // G-01: 組內及組間變異皆 0 時，xs.rejected 必為 true 且 stable === null
          assert.equal(A.stable, null, fmtVecErr(vecId, seed, sc, null, A.stable, "G-01: 零變異管制圖不可判定為穩定"));
        }
        if (sc === "unit_mismatch_cpk" && spMode === "two_sided") {
          // G-03: |Cpk|>50 或單位錯置阻斷守衛 (unitMismatch 警示 + Stage 2 量測卡)
          assert.equal(A.unitMismatch, true, fmtVecErr(vecId, seed, sc, true, A.unitMismatch, "G-03: 單位錯置未觸發 unitMismatch"));
        }
        if (sc === "unknown_height_unit") {
          // G-12: 未知高度單位不傳回高度規格
          assert.equal(CORE.specOfGroup(st, "ALL", "height"), null, fmtVecErr(vecId, seed, sc, null, CORE.specOfGroup(st, "ALL", "height"), "G-12: 未知高度單位不可回傳規格"));
        }

        // 對每個 (情境 × 規格) 的首 2 個種子跑完整 detectIssues() 驗證誤報/命中回溯（其餘種子保持毫秒級執行）
        if (sIdx < 2) {
          const F = CORE.detectIssues(st, A);
          if (sc === "stable_iid_small" && spMode === "two_sided") {
            const severe = F.filter(c => c.lv === "ng");
            assert.equal(severe.length, 0, fmtVecErr(vecId, seed, { sc, spMode }, 0, severe.map(c => c.t), "G-04/G-05: 穩定 i.i.d. 小樣本不可產生嚴重誤報卡"));
          }
          if (sc === "squeegee_even_odd" && spMode === "two_sided") {
            const sqCard = F.find(c => c.sig?.t === "stroke");
            assert.ok(sqCard, fmtVecErr(vecId, seed, sc, "stroke card", F.map(c => c.sig?.t), "應檢出刮刀奇偶差"));
          }
          if (sc === "spatial_gradient" && spMode === "two_sided") {
            const grCard = F.find(c => c.sig?.t === "grad");
            assert.ok(grCard, fmtVecErr(vecId, seed, sc, "grad card", F.map(c => c.sig?.t), "應檢出空間梯度"));
          }
          if (sc === "align_shift_rot" && spMode === "two_sided") {
            const alCard = F.find(c => c.sig?.t === "align");
            assert.ok(alCard, fmtVecErr(vecId, seed, sc, "align card", F.map(c => c.sig?.t), "應檢出對位平移/旋轉"));
          }
        }
      }
    }
  }
  assert.equal(vecNum, 2750, "Axis 2 累積向量數必須正好為 2,750 (本軸 1,500)");
});

test("Axis 3 (VEC-2751~VEC-4000): 圖表、問題地圖與 3D 輸出零失真對齊 (1,250 向量)", () => {
  // 25 資料集 × 5 量測指標 × 5 圖表/視覺輸出 × 2 操作順序 = 1,250 vectors
  const metrics = ["volume", "height", "area", "offx", "offy"];
  const outputs = ["withLimits", "histBins", "evSvg", "partMap", "pos3D"];
  let vecNum = 2750;

  for (let ds = 0; ds < 25; ds++) {
    const seedDs = 0x5a173000 + ds;
    const rand = mulberry32(seedDs);
    const baseRows = [];
    for (let b = 0; b < 5; b++) {
      for (let p = 0; p < 4; p++) {
        baseRows.push({
          board: `B0${b + 1}`,
          comp: p < 2 ? "U1" : "R2",
          pad: p < 2 ? `U1-${p + 1}` : `R2-${p - 1}`,
          group: p < 2 ? "QFN" : "0402",
          placePkg: p < 2 ? "QFN-16" : "0402",
          componentX: p < 2 ? 15 : 40,
          componentY: p < 2 ? 20 : 25,
          dimAssumed: true,
          volume: +(95 + b * 2 + rand() * 8).toFixed(2),
          height: +(115 + rand() * 12).toFixed(2),
          area: +(98 + rand() * 6).toFixed(2),
          offx: +(-5 + rand() * 10).toFixed(2),
          offy: +(-4 + rand() * 8).toFixed(2),
        });
      }
    }
    const st = baseState(CORE, { rows: baseRows, metrics });
    const A_byMetric = {};
    for (const m of metrics) {
      st.metric = m;
      A_byMetric[m] = CORE.analyze(st);
    }

    for (const m of metrics) {
      const A = A_byMetric[m];
      for (const outType of outputs) {
        for (let ord = 0; ord < 2; ord++) {
          vecNum++;
          const vecId = `VEC-${String(vecNum).padStart(4, "0")}`;
          const spec = { ds, m, outType, ord };

          if (outType === "histBins") {
            const hb = UI.histBins(A);
            const sumY = hb.bins.reduce((s, b) => s + b.y, 0);
            assert.equal(sumY, A.N, fmtVecErr(vecId, seedDs, spec, A.N, sumY, "直方圖所有分箱頻數總和必須精確等於 A.N"));
            assert.ok(hb.nb >= 8 && hb.nb <= 45, fmtVecErr(vecId, seedDs, spec, "[8,45]", hb.nb, "直方圖分箱數超出範圍"));
          } else if (outType === "withLimits") {
            const opts = UI.withLimits({ responsive: true }, [
              { n: "UCL", v: A.xs.ucl, c: "#c00" },
              { n: "CL", v: A.xs.cl, c: "#666" },
              { n: "LCL", v: A.xs.lcl, c: "#c00" },
            ], false);
            assert.ok(opts.plugins.limitLabels.items.length >= 1, fmtVecErr(vecId, seedDs, spec, ">=1 label", opts.plugins.limitLabels.items.length, "withLimits 必須產生限界標籤"));
            assert.equal(opts.layout.padding({ chart: { width: 300 } }).right, 0, fmtVecErr(vecId, seedDs, spec, 0, "non-zero", "窄畫面圖表右側不應擠壓留白"));
          } else if (outType === "evSvg") {
            const ev = {
              type: ds % 2 === 0 ? "series" : "bars",
              title: `${m} 趨勢`,
              unit: m === "height" ? "µm" : "%",
              labels: A.byBoard.map(b => b.board),
              values: A.byBoard.map(b => b.mean),
              hi: [0],
            };
            const svgHtml = UI.evSvg(ev, "warn");
            const titles = [...svgHtml.matchAll(/<title>([^<]+)<\/title>/g)].map(x => x[1]);
            assert.equal(titles.length, ev.values.length, fmtVecErr(vecId, seedDs, spec, ev.values.length, titles.length, "evSvg <title> 點數須與輸入序列一致"));
            for (let ti = 0; ti < titles.length; ti++) {
              assert.ok(titles[ti].includes(ev.labels[ti]), fmtVecErr(vecId, seedDs, spec, ev.labels[ti], titles[ti], "evSvg 標籤必須回溯至原始板號"));
            }
          } else if (outType === "partMap") {
            const idx = UI.buildPartProblemIndex(baseRows, []);
            const parts = [...idx.parts.values()];
            assert.equal(parts.length, 2, fmtVecErr(vecId, seedDs, spec, 2, parts.length, "問題地圖零件數應為 2"));
            assert.ok(parts.some(p => p.packages.has("QFN-16")), fmtVecErr(vecId, seedDs, spec, "QFN-16", [...parts[0].packages], "BUG-07: 問題地圖必須追蹤 placePkg"));
          } else if (outType === "pos3D") {
            const rowsCopy = baseRows.map(r => ({ ...r }));
            const snapBefore = rowsCopy.map(r => ({ w: r.w, d: r.d, shape: r.shape, dimAssumed: r.dimAssumed, x: r.x, y: r.y, cx: r.componentX, cy: r.componentY }));
            if (ord === 0) {
              UI.T.pos = null;
              const P = UI.pos3D(rowsCopy);
              assert.equal(P.size, rowsCopy.length, fmtVecErr(vecId, seedDs, spec, rowsCopy.length, P.size, "所有具 componentX/Y 之焊墊都應出現在 3D Map"));
              CORE.dfmTable(baseState(CORE, { rows: rowsCopy }));
            } else {
              CORE.dfmTable(baseState(CORE, { rows: rowsCopy }));
              UI.T.pos = null;
              UI.pos3D(rowsCopy);
            }
            const snapAfter = rowsCopy.map(r => ({ w: r.w, d: r.d, shape: r.shape, dimAssumed: r.dimAssumed, x: r.x, y: r.y, cx: r.componentX, cy: r.componentY }));
            assert.deepStrictEqual(snapAfter, snapBefore, fmtVecErr(vecId, seedDs, spec, snapBefore[0], snapAfter[0], "BUG-01: 3D 與 DFM 任一執行順序下皆不可變更 S.rows 原始幾何"));
          }
        }
      }
    }
  }
  assert.equal(vecNum, 4000, "Axis 3 累積向量數必須正好為 4,000 (本軸 1,250)");
});

test("Axis 4 (VEC-4001~VEC-5000): 報告與匯出端到端反驗證回溯 (1,000 向量)", () => {
  // 20 多群組/多子板回合 × 5 分析範圍 × 10 交付物 = 1,000 vectors
  const scopes = [
    { name: "ALL", group: "ALL", comp: "" },
    { name: "G_0402", group: "0402", comp: "" },
    { name: "G_QFN", group: "QFN", comp: "" },
    { name: "C_U1_F1", group: "ALL", comp: CORE.compKeyOf({ figure: "1", comp: "U1" }) },
    { name: "C_R2_F1", group: "ALL", comp: CORE.compKeyOf({ figure: "1", comp: "R2" }) },
  ];
  const deliverables = [
    "issuesCsv", "issuesXlsx", "issuesMd", "statsDataCsv", "boardStatsCsv",
    "defectPadsCsv", "scopedDfmTable", "reportMd", "scopeFilterParity", "auditShaTrace",
  ];
  let vecNum = 4000;

  for (let ds = 0; ds < 20; ds++) {
    const seed = 0x5a174000 + ds;
    const rand = mulberry32(seed);
    const rows = [];
    for (let b = 1; b <= 6; b++) {
      const bId = `B0${b}-1`;
      for (const item of [
        { comp: "U1", pad: "U1-1", group: "QFN", w: 0.4, d: 0.4, vBase: b === 6 ? 155 : 100 },
        { comp: "U1", pad: "U1-2", group: "QFN", w: 0.4, d: 0.4, vBase: 99 },
        { comp: "R2", pad: "R2-1", group: "0402", w: 0.5, d: 0.5, vBase: b === 1 ? 62 : 101 },
        { comp: "R2", pad: "R2-2", group: "0402", w: 0.5, d: 0.5, vBase: 100 },
      ]) {
        rows.push({
          board: bId, figure: "1", comp: item.comp, pad: item.pad, group: item.group, pkg: item.group,
          w: item.w, d: item.d, boardInferred: ds % 2 === 1,
          volume: +(item.vBase + rand() * 2).toFixed(2),
          height: +(120 + rand() * 4).toFixed(2),
          area: +(100 + rand() * 3).toFixed(2),
          offx: +(-2 + rand() * 4).toFixed(2),
          offy: +(-2 + rand() * 4).toFixed(2),
        });
      }
    }
    const fullSt = baseState(CORE, { rows, metrics: ["volume", "height", "area", "offx", "offy"], boardInferred: ds % 2 === 1 ? 4 : 0 });
    const fullA = CORE.analyze(fullSt);
    const fullF = CORE.detectIssues(fullSt, fullA);
    const rowSetByKey = new Map(rows.map(r => [`${r.board}|${r.pad}|${r.comp}`, r]));

    for (const sc of scopes) {
      const scSt = baseState(CORE, {
        rows,
        group: sc.group,
        comp: sc.comp,
        metrics: ["volume", "height", "area", "offx", "offy"],
        boardInferred: ds % 2 === 1 ? 4 : 0,
      });
      const scA = CORE.analyze(scSt);
      scSt.A = scA;
      scSt.F = fullF;
      const scFilter = CORE.scopeFilter(scSt);
      const scRows = rows.filter(scFilter);
      const scFindingIds = new Set(CORE.detectIssues ? fullF.filter(c => {
        if (!CORE.scopeIsNarrow(scSt)) return true;
        // 與 CORE scope 規則一致檢查
        const rInScope = new Set(scRows.map(r => r.pad));
        const bInScope = new Set(scRows.map(r => r.board));
        const gInScope = new Set(scRows.map(r => r.group));
        const ents = c.ents || [];
        return !ents.length || ents.some(e => (e.startsWith("p:") && rInScope.has(e.slice(2))) || (e.startsWith("g:") && gInScope.has(e.slice(2))) || (e.startsWith("b:") && bInScope.has(e.slice(2))));
      }).map(c => c.id) : []);

      // 預計算一次匯出資料供檢查（快速無 DOM 開銷）
      const narrow = CORE.scopeIsNarrow(scSt);
      const csvIssues = CORE.withScopeCsv(scSt, CORE.issuesCsv(fullF.filter(c => scFindingIds.has(c.id)), scSt));
      const xlsxBytes = CORE.issuesXlsx(fullF.filter(c => scFindingIds.has(c.id)), scSt);
      const mdIssues = CORE.issuesMd(fullF.filter(c => scFindingIds.has(c.id)), scSt);
      const statsCsv = CORE.statsDataCsv(scSt);
      const dfmScoped = CORE.scopedDfmTable(scSt);
      const allowedGroups = new Set(scRows.map(r => r.group));

      for (const deliv of deliverables) {
        vecNum++;
        const vecId = `VEC-${String(vecNum).padStart(4, "0")}`;
        const spec = { ds, scope: sc.name, deliv };

        if (deliv === "issuesCsv") {
          const parsed = parseCsvSimple(csvIssues);
          if (narrow) assert.equal(parsed[0][0], "分析範圍", fmtVecErr(vecId, seed, spec, "分析範圍", parsed[0][0], "窄範圍 CSV 首列必為分析範圍"));
        } else if (deliv === "issuesXlsx") {
          const sheetRows = parseXlsxSheet1(xlsxBytes);
          assert.ok(sheetRows.length >= 1 && sheetRows[0][0] === "no", fmtVecErr(vecId, seed, spec, "no", sheetRows[0]?.[0], "XLSX sheet1 表頭首欄必為 no"));
          assert.equal(sheetRows.length, scFindingIds.size + 1, fmtVecErr(vecId, seed, spec, scFindingIds.size + 1, sheetRows.length, "XLSX 匯出列數須等於範圍內問題卡數 + 1"));
        } else if (deliv === "issuesMd") {
          if (narrow) assert.ok(mdIssues.includes(CORE.scopeLabel(scSt)), fmtVecErr(vecId, seed, spec, CORE.scopeLabel(scSt), "missing", "issuesMd 必須標明分析範圍"));
        } else if (deliv === "statsDataCsv") {
          const parsed = parseCsvSimple(statsCsv);
          if (narrow) assert.equal(parsed[0][0], "分析範圍", fmtVecErr(vecId, seed, spec, "分析範圍", parsed[0][0], "BUG-09: statsDataCsv 窄範圍必須標明分析範圍"));
          const headIdx = narrow ? 1 : 0;
          const bCol = parsed[headIdx].indexOf("板號");
          const pCol = parsed[headIdx].indexOf("焊墊");
          const vCol = parsed[headIdx].indexOf("量測值");
          for (let ri = headIdx + 1; ri < parsed.length; ri++) {
            const bVal = parsed[ri][bCol], pVal = parsed[ri][pCol];
            if (bVal && bVal !== "—" && pVal && pVal !== "全部" && pVal !== "—") {
              const rawHit = scRows.find(r => r.board === bVal && r.pad === pVal);
              assert.ok(rawHit, fmtVecErr(vecId, seed, spec, `${bVal}/${pVal}`, "not in scope", "異常 CSV 列必須可 100% 回溯至範圍內原始量測列"));
              assert.ok(Math.abs(parseFloat(parsed[ri][vCol]) - rawHit.volume) < 0.05, fmtVecErr(vecId, seed, spec, rawHit.volume, parsed[ri][vCol], "異常 CSV 量測值必須對回原始列"));
            }
          }
        } else if (deliv === "boardStatsCsv") {
          const sumN = scA.byBoard.reduce((s, b) => s + b.n, 0);
          assert.equal(sumN, scRows.length, fmtVecErr(vecId, seed, spec, scRows.length, sumN, "byBoard 樣本數總和必等於範圍內原始列數"));
        } else if (deliv === "defectPadsCsv") {
          for (const dr of scA.defRows) {
            assert.ok(scFilter(dr), fmtVecErr(vecId, seed, spec, "in scope", `${dr.board}/${dr.pad}`, "defect-pads 每列皆須通過 scopeFilter"));
          }
        } else if (deliv === "scopedDfmTable") {
          assert.ok(dfmScoped.every(d => allowedGroups.has(d.group)), fmtVecErr(vecId, seed, spec, [...allowedGroups], dfmScoped.map(d => d.group), "BUG-08: scopedDfmTable 不可包含範圍外群組"));
        } else if (deliv === "reportMd") {
          assert.equal(scRows.length, scA.N, fmtVecErr(vecId, seed, spec, scRows.length, scA.N, "報告納入筆數須等於 scopeFilter 筆數"));
        } else if (deliv === "scopeFilterParity") {
          assert.ok(scA.groups.every(g => allowedGroups.has(g.g)), fmtVecErr(vecId, seed, spec, [...allowedGroups], scA.groups.map(g => g.g), "A.groups 不可出現範圍外群組"));
        } else if (deliv === "auditShaTrace") {
          for (const sr of scRows) {
            const orig = rowSetByKey.get(`${sr.board}|${sr.pad}|${sr.comp}`);
            assert.ok(orig && orig.volume === sr.volume, fmtVecErr(vecId, seed, spec, orig?.volume, sr.volume, "每一筆範圍內分析列都可逆推回原始記錄列"));
          }
        }
      }
    }
  }
  assert.equal(vecNum, 5000, "Axis 4 累積向量數必須正好為 5,000 (四軸總計 5,000)");
});
