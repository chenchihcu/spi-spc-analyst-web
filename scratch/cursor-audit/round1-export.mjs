#!/usr/bin/env node
/**
 * Round 1 audit exports (scratch only). Writes artifacts/round1-data.json
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const { HTML, loadCore } = require("../../tests/_load.js");
const { generateStableData } = require("../../tools/gen-stable.mjs");

const UP = "/home/ubuntu/.cursor/projects/workspace/uploads";
const SPEC_PATH = path.join(UP, "spec_301-0011001123_v3_a3ca.json");
const OUT = "/workspace/artifacts/round1-data.json";
const core = loadCore();
const SIDE = "TOP";
const STENCIL = 120;

function shaFile(p) {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

const html = () => fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");

function createHook() {
  const dom = new JSDOM(html(), {
    runScripts: "dangerously",
    url: "https://spi.example/#data",
    beforeParse(w) {
      w.scrollTo = () => {};
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
      w.SPI_TEST_HOOK = {};
    },
  });
  return dom.window.SPI_TEST_HOOK;
}

function loadSpec(stencilUm) {
  const raw = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  const canon = core.partSpecCanon(raw);
  const sha = createHash("sha256").update(canon, "utf8").digest("hex");
  const pst = core.partSpecToState(raw, stencilUm);
  return { raw, sha, pst };
}

function pipeline(hook, { stencilUm, groupMode }) {
  const placeRes = hook.parsePlacement(
    hook.csvTable(fs.readFileSync(path.join(UP, "placement_cad_8eab.csv"), "utf8")),
    "mm",
    "BOTH",
  );
  const raw = hook.csvTable(fs.readFileSync(path.join(UP, "spi_raw_B_2384rows_d310.csv"), "utf8"));
  const conv = hook.unpivotWide(raw, { side: SIDE, place: placeRes, stencil: stencilUm });
  const map = core.autoMap(conv.tab.head);
  const built = core.buildRows(
    conv.tab,
    map,
    { ...core.guessOpts(conv.tab.head, map), side: SIDE, place: placeRes, groupFallback: "comp" },
    5,
  );
  if (groupMode === "comp") {
    for (const r of built.rows) if (r.comp) r.group = r.comp;
  }
  // pkg: default buildRows already sets group from pkg when placement present

  const { raw: specObj, sha, pst } = loadSpec(stencilUm);
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
    partSpec: { part: specObj.part, ver: 3, sha, stencilRef: specObj.stencilRef ?? 120 },
  };
  const F = core.detectIssues(st);
  const A = core.analyze({ ...st, metric: "hpct" });
  return { st, F, A, built, placeRes };
}

function countLevels(F) {
  return F.reduce((a, x) => ((a[x.level] = (a[x.level] || 0) + 1), a), {});
}

function medArr(a) {
  const s = [...a].filter((v) => v != null && isFinite(v)).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const i = (s.length - 1) / 2;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[Math.floor(i)] + s[Math.ceil(i)]) / 2;
}

function ruleCounts(F) {
  const m = {};
  for (const x of F) m[x.rule_id] = (m[x.rule_id] || 0) + 1;
  return m;
}

/** Replicate detectIssues robust pad Cpk index (app reference for export). */
function recomputeRobustCpkCards(st) {
  const MS = ["volume", "hpct", "area", "offx", "offy"];
  const R = st.rows;
  const groups = [...new Set(R.map((r) => r.group))];
  const gIdx = {};
  for (const g of groups) gIdx[g] = R.filter((r) => r.group === g);
  const gPads = {};
  for (const g of groups) {
    const pads = {};
    for (const r of gIdx[g]) {
      const p = pads[r.pad] || (pads[r.pad] = { r, rows: [] });
      p.rows.push(r);
    }
    gPads[g] = Object.values(pads).filter((p) => p.rows.length >= 5);
  }
  const cards = [];
  for (const k of MS) {
    for (const g of groups) {
      const sp = core.specOfGroup(st, g, k);
      if (!sp || !isFinite(sp.lsl) || !isFinite(sp.usl) || !(sp.usl > sp.lsl)) continue;
      const P = gPads[g]
        .map((p) => {
          const spP = core.specOfGroup(st, g, k);
          const vals = p.rows.map((r) => r[k]).filter((v) => v != null && isFinite(v));
          if (vals.length < 5) return null;
          const { m, s } = core.robust(vals);
          const cpk = Math.min(spP.usl - m, m - spP.lsl) / (3 * s);
          return { pad: p.r.pad, n: vals.length, m, s, cpk };
        })
        .filter((p) => p && isFinite(p.cpk));
      if (P.length < 2) continue;
      const mc = medArr(P.map((p) => p.cpk));
      if (mc < 1) {
        cards.push({
          g,
          k,
          mc,
          lv: mc < 0.67 ? "ng" : "warn",
          nPads: P.length,
          nBoards: P[0]?.n,
        });
      }
    }
  }
  return cards;
}

function stableFalseAlarms(nb = 25, nSeeds = 200) {
  const ruleHit = {};
  let anyNgWarn = 0;
  for (let seed = 1; seed <= nSeeds; seed++) {
    const rows = generateStableData({ nb, shift: 0, stroke: true, seed });
    const st = {
      ...core.S,
      rows,
      metrics: ["volume", "hpct", "area", "offx", "offy"],
      metric: "volume",
      group: core.ALL_GRP,
      stencil: 120,
      specSrc: "sample",
      specs: JSON.parse(JSON.stringify(core.DEF_SPECS)),
      specsG: null,
    };
    const F = core.detectIssues(st);
    const bad = F.filter((x) => x.lv === "ng" || x.lv === "warn");
    if (bad.length) anyNgWarn++;
    for (const x of bad) ruleHit[x.rule_id] = (ruleHit[x.rule_id] || 0) + 1;
  }
  return { nb, nSeeds, anyNgWarnRate: anyNgWarn / nSeeds, ruleHitRates: Object.fromEntries(Object.entries(ruleHit).map(([k, v]) => [k, v / nSeeds])) };
}

function nelsonRule8BothSidesTest() {
  // Sequence: 8 points all |z|>1 but all same sign — app fires rule 8
  const zSame = [1.2, 1.3, 1.1, 1.4, 1.2, 1.5, 1.1, 1.3];
  const r1 = core.nelson(zSame);
  const rule8Same = r1.rules.find((r) => r.id === 8);
  // Nelson (1984): 8 in row beyond 1σ from center, with points on both sides of center line
  const zBoth = [1.2, -1.1, 1.3, -1.2, 1.1, -1.3, 1.2, -1.1];
  const r2 = core.nelson(zBoth);
  const rule8Both = r2.rules.find((r) => r.id === 8);
  return {
    sameSignOnly: { z: zSame, triggered: rule8Same.idx.length > 0, idx: rule8Same.idx },
    bothSides: { z: zBoth, triggered: rule8Both.idx.length > 0, idx: rule8Both.idx },
  };
}

function main() {
  const hook = createHook();
  const hashes = {
    rawB: shaFile(path.join(UP, "spi_raw_B_2384rows_d310.csv")),
    placement: shaFile(path.join(UP, "placement_cad_8eab.csv")),
    spec: shaFile(SPEC_PATH),
    userExport: shaFile(path.join(UP, "user_input_9b4c.csv")),
  };

  const comp120 = pipeline(hook, { stencilUm: 120, groupMode: "comp" });
  const comp90 = pipeline(hook, { stencilUm: 90, groupMode: "comp" });
  const pkg120 = pipeline(hook, { stencilUm: 120, groupMode: "pkg" });

  const robustCards = recomputeRobustCpkCards(comp120.st);
  const F = comp120.F;
  const robustFromF = F.filter((x) => x.rule_id === "焊墊位置穩健 Cpk<1.00");
  const robustLevels = countLevels(robustFromF);

  const d30 = F.filter((x) => x.rule_id === "孤立極端焊墊（D-30）" && x.metric === "高度%厚");
  const sixDiffTitles = [
    { user: "高度%厚有 70 處孤立極端焊墊", gen69: "高度%厚有 69 處孤立極端焊墊", gen71: "高度%厚有 71 處孤立極端焊墊" },
    { user: "R281", userVal: "0.46", gen120: "0.47" },
    { user: "ED4", userVal: "0.64", gen120: "0.62" },
  ];

  const cap = comp120.A?.cap;
  const nb = comp120.A?.boards?.length;

  const out = {
    appVersion: JSON.parse(fs.readFileSync("/workspace/package.json", "utf8")).version,
    gitHead: "4534aa26e22dc67e3583ebc4b04d826b2de4e376",
    hashes,
    baseline: {
      stencil_um: 120,
      groupMode: "comp",
      totals: countLevels(F),
      ruleCounts: ruleCounts(F),
      robustCpkCardCount: robustFromF.length,
      robustCpkLevels: robustLevels,
      recomputeRobustCount: robustCards.length,
      d30Hpct: d30.map((x) => ({ title: x.title, level: x.level, n: x.sig?.rows?.length ?? null })),
    },
    comparison90: { totals: countLevels(comp90.F), robustCpkLevels: countLevels(comp90.F.filter((x) => x.rule_id === "焊墊位置穩健 Cpk<1.00")) },
    pkg120: { totals: countLevels(pkg120.F), ruleCounts: ruleCounts(pkg120.F), groupCount: new Set(pkg120.st.rows.map((r) => r.group)).size },
    robustCpkSample: robustCards.slice(0, 5),
    robustMismatchCheck: (() => {
      let mismatch = 0;
      const samples = [];
      for (const card of robustFromF.slice(0, 20)) {
        const m = card.title.match(/^(.+?) (體積|高度%厚|面積|X 偏移|Y 偏移)焊墊位置穩健 Cpk（中位數）(-?\d+\.\d+)/);
        if (!m) continue;
        const g = m[1];
        const metricMap = { 體積: "volume", "高度%厚": "hpct", 面積: "area", "X 偏移": "offx", "Y 偏移": "offy" };
        const k = metricMap[m[2]];
        const rc = robustCards.find((c) => c.g === g && c.k === k);
        if (!rc) continue;
        const titleMc = parseFloat(m[3]);
        if (Math.abs(rc.mc - titleMc) > 0.011) {
          mismatch++;
          samples.push({ g, k, rc_mc: rc.mc, title_mc: titleMc });
        }
      }
      return { checked: 20, mismatch, samples };
    })(),
    capHpct: cap
      ? {
          cpk: cap.cpk,
          ci: cap.ci,
          nb: cap.nb,
          n: cap.n,
        }
      : null,
    nelsonRule8Probe: nelsonRule8BothSidesTest(),
    stableSim: stableFalseAlarms(25, 200),
    specDownloadLine: "spi-spc.html ~9104: fn=`料號規格_${safeFn(rec.part)}_v${rec.ver}.json`",
    reportStencilLine: "renderReport #repSec1 / reportMd 使用 S.stencil",
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        robust: out.baseline.robustCpkCardCount,
        levels: out.baseline.robustCpkLevels,
        pkgCards: out.pkg120.totals,
        d30: out.baseline.d30Hpct,
      },
      null,
      2,
    ),
  );
}

main();
