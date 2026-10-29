#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const { HTML, loadCore } = require("../../tests/_load.js");

const UP = "/home/ubuntu/.cursor/projects/workspace/uploads";
const OUT = "/workspace/artifacts/round2-data.json";
const core = loadCore();

function createHook() {
  const dom = new JSDOM(fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, ""), {
    runScripts: "dangerously",
    url: "https://spi.example/",
    beforeParse(w) {
      w.scrollTo = () => {};
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
      w.SPI_TEST_HOOK = {};
    },
  });
  return dom.window.SPI_TEST_HOOK;
}

function pipeline(stencilUm, groupMode = "comp") {
  const hook = createHook();
  const placeRes = hook.parsePlacement(
    hook.csvTable(fs.readFileSync(path.join(UP, "placement_cad_8eab.csv"), "utf8")),
    "mm",
    "BOTH",
  );
  const raw = hook.csvTable(fs.readFileSync(path.join(UP, "spi_raw_B_2384rows_d310.csv"), "utf8"));
  const conv = hook.unpivotWide(raw, { side: "TOP", place: placeRes, stencil: stencilUm });
  const map = core.autoMap(conv.tab.head);
  const built = core.buildRows(
    conv.tab,
    map,
    { ...core.guessOpts(conv.tab.head, map), side: "TOP", place: placeRes, groupFallback: "comp" },
    5,
  );
  if (groupMode === "comp") for (const r of built.rows) if (r.comp) r.group = r.comp;
  const spec = JSON.parse(fs.readFileSync(path.join(UP, "spec_301-0011001123_v3_a3ca.json"), "utf8"));
  const pst = core.partSpecToState(spec, stencilUm);
  const st = {
    ...core.S,
    rows: built.rows,
    metrics: built.metrics,
    metric: "volume",
    group: core.ALL_GRP,
    stencil: stencilUm,
    specSrc: "part",
    specs: pst.specs,
    specsG: pst.specsG,
    htol: pst.htol,
    partSpec: { part: spec.part, ver: 3, sha: "87eec342530a", stencilRef: 120 },
  };
  for (const r of st.rows) {
    if (r.height != null) r.hpct = Math.round((r.height / stencilUm) * 1000) / 10;
  }
  const F = core.detectIssues(st);
  return { st, F, A: core.analyze({ ...st, metric: "volume" }) };
}

function nelson4NaN() {
  const z = Array(14).fill(NaN);
  const r = core.nelson(z);
  const rule4 = r.rules.find((x) => x.id === 4);
  return { rule4Idx: rule4.idx, rule4Na: rule4.na };
}

function poissonTests() {
  const cases = [
    [5, 1],
    [20, 1],
    [1000, 1000],
  ];
  return cases.map(([k, l]) => ({ k, l, app: core.poissonSf(k, l) }));
}

function zeroVarianceCard() {
  const rows = [];
  for (let b = 1; b <= 5; b++) {
    for (const pad of ["P1", "P2"]) {
      rows.push({
        board: `B0${b}`,
        pad,
        comp: "U1",
        group: "U1",
        volume: 130,
        height: 120,
        hpct: 100,
        area: 100,
        offx: 0,
        offy: 0,
      });
    }
  }
  const st = {
    ...core.S,
    rows,
    metrics: ["volume", "hpct", "area", "offx", "offy"],
    metric: "volume",
    group: core.ALL_GRP,
    stencil: 120,
    specSrc: "part",
    specs: { ...core.DEF_SPECS, volume: { lsl: 70, usl: 130, tgt: 100 } },
    specsG: null,
    partSpec: { part: "TEST", ver: 1, sha: "0", stencilRef: 120 },
  };
  const F = core.detectIssues(st);
  const rv = F.filter((x) => x.rule_id === "焊墊位置穩健 Cpk<1.00");
  const { m, s } = core.robust(rows.filter((r) => r.pad === "P1").map((r) => r.volume));
  return { robust_m: m, robust_s: s, cards: rv.map((x) => ({ title: x.title, level: x.level, observed: x.observed })) };
}

function nonCpkCards(F) {
  return F.filter((x) => x.rule_id !== "焊墊位置穩健 Cpk<1.00" && x.rule_id !== "焊墊位置長期偏離（穩健 Cpk<1.00 且 |z|≥4）").map((x) => ({
    no: x.no,
    level: x.level,
    rule_id: x.rule_id,
    title: x.title,
    metric: x.metric,
    sig: x.sig,
  }));
}

function chartPoints(A) {
  if (!A || !A.xs) return null;
  return {
    xbar: A.xs.pts.map((p) => ({ lab: p.lab, v: p.v, ucl: p.ucl, lcl: p.lcl, z: p.z, cl: A.xs.cl })),
    s: A.xs.s.map((p) => ({ lab: p.lab, v: p.v, ucl: p.ucl, lcl: p.lcl, cl: p.cl })),
    pPrime: A.pc?.pts?.map((p) => ({ lab: p.lab, v: p.v, ucl: p.ucl, lcl: p.lcl, cl: A.pc.cl })),
    gMean: A.gMean,
    sB: A.xs.sB,
    pbar: A.pc?.cl,
  };
}

function titleMc(F, g, k) {
  const metricLabel = { volume: "體積", hpct: "高度%厚", area: "面積", offx: "X 偏移", offy: "Y 偏移" }[k];
  const x = F.find((c) => c.rule_id === "焊墊位置穩健 Cpk<1.00" && c.title.startsWith(`${g} ${metricLabel}`));
  if (!x) return null;
  const m = x.title.match(/（中位數）(-?\d+\.\d+)/);
  return m ? parseFloat(m[1]) : null;
}

function main() {
  const { st, F, A } = pipeline(120, "comp");
  const F90 = pipeline(90, "comp").F;
  const nonCpk = nonCpkCards(F);
  const padCards = F.filter((x) => x.rule_id === "焊墊位置長期偏離（穩健 Cpk<1.00 且 |z|≥4）");

  const quant90 = {
    R281: titleMc(F90, "R281", "hpct"),
    ED4: titleMc(F90, "R281", "hpct"),
  };
  quant90.R281 = titleMc(F90, "R281", "hpct");
  quant90.ED4 = titleMc(F90, "ED4", "hpct");
  quant90.L17 = titleMc(F90, "L17", "hpct");
  quant90.R281_120 = titleMc(F, "R281", "hpct");
  quant90.ED4_120 = titleMc(F, "ED4", "hpct");
  quant90.L17_120 = titleMc(F, "L17", "hpct");

  const d30 = F.filter((x) => x.rule_id === "孤立極端焊墊（D-30）");

  const out = {
    codexSuspects: {
      nelson4NaN: nelson4NaN(),
      poisson: poissonTests(),
      zeroVariance: zeroVarianceCard(),
    },
    uiReachability: {
      nelson4NaN: "analyzeBase 在 overallSd===0 時 nelsonZero；正常板數≥5 且有限值時 z 有限。全 NaN 序列需 chart 資料缺值或手工 hook，正常 SPI 匯入不產生 NaN 板平均 → NOT UI 預設路徑",
      zeroVariance: "detectIssues 可觸發（真實資料若全相同值）；邊界 USL 上可出現",
      poissonExtreme: "D-30 使用 poissonSf(oos.length, lam)；301 資料 lam 為有限小數，k≤69；k=1000/λ=1000 為合成邊界",
    },
    sixDiffQuantization: quant90,
    nonCpkCount: nonCpk.length,
    padLongTermCount: padCards.length,
    nonCpk,
    d30: d30.map((x) => ({ title: x.title, level: x.level, nRows: x.sig?.rows?.length, p: x.p })),
    chart301Volume: chartPoints(A),
    placementGuard7811: {
      condition: "PLACE.part===part && PLACE.rev===rev && side in PLACE.res.items",
      note: "新匯入阻擋跨料號/版次/面別座標；不驗證 D1 歷史錯歸檔是否仍可被舊回合引用",
    },
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ nonCpk: nonCpk.length, nelson4: out.codexSuspects.nelson4NaN, poisson: out.codexSuspects.poisson }, null, 2));
}

main();
