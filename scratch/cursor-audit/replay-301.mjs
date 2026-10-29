#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { JSDOM } = (() => { try { return require("jsdom"); } catch { return {}; } })();
const { HTML, loadCore, baseState } = require("../../tests/_load.js");

if (!JSDOM) {
  console.error("jsdom required");
  process.exit(2);
}

const UP = "/home/ubuntu/.cursor/projects/workspace/uploads";
const PATHS = {
  userCsv: path.join(UP, "user_input_9b4c.csv"),
  spiA: path.join(UP, "spi_raw_A_958rows_e1f0.csv"),
  spiB: path.join(UP, "spi_raw_B_2384rows_d310.csv"),
  place: path.join(UP, "placement_cad_8eab.csv"),
};
const STENCIL = 90;
const SIDE = "TOP";

const html = () => fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");

function createHook() {
  const dom = new JSDOM(html(), {
    runScripts: "dangerously",
    url: "https://spi.example/#data",
    beforeParse(w) {
      w.scrollTo = () => {};
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
      w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,mock";
      w.SPI_TEST_HOOK = {};
    },
  });
  return dom.window.SPI_TEST_HOOK;
}

function csvToRows(text) {
  const tab = loadCore().csvTable(text);
  const cols = tab.head;
  return tab.data.map((cells) => {
    const o = {};
    cols.forEach((h, i) => {
      o[h] = cells[i] ?? "";
    });
    return o;
  });
}

function countLevelsFromCards(F) {
  const c = { 嚴重: 0, 警示: 0, 資訊: 0 };
  for (const x of F) {
    const lv = x.level || { ng: "嚴重", warn: "警示", info: "資訊" }[x.lv];
    if (c[lv] !== undefined) c[lv]++;
  }
  return c;
}

function fingerprint(rows, keys) {
  return rows.map((r) => keys.map((k) => String(r[k] ?? "").trim()).join("\t")).sort().join("\n");
}

const core = loadCore();

function importPipeline(hook, spiPath, placeRes, groupBy = "pkg") {
  const raw = hook.csvTable(fs.readFileSync(spiPath, "utf8"));
  const conv = hook.unpivotWide(raw, { side: SIDE, place: placeRes, stencil: STENCIL });
  const tab = conv.tab;
  const map = core.autoMap(tab.head);
  const opts = {
    ...core.guessOpts(tab.head, map),
    side: SIDE,
    place: placeRes,
    groupFallback: "comp",
    groupBy,
    dupMode: "last",
  };
  const built = core.buildRows(tab, map, opts, 5);
  // 使用者匯出標題多為位號（J2、R71），非 PartType；與 pkg 覆写 group 的現行 buildRows 不同，稽核時對照兩種
  if (opts.groupBy === "comp") {
    for (const r of built.rows) if (r.comp) r.group = r.comp;
  }
  return { built, conv };
}

function applySpec(hook, specMode) {
  const S = hook.S;
  S.stencil = STENCIL;
  S.htol = { lo: 75, hi: 125 };
  if (specMode === "part-default") {
    const spec = {
      schema: "spi-part-spec/1",
      part: "301-0011001123",
      stencilRef: 120,
      specs: {
        volume: { lsl: 70, tgt: 100, usl: 130 },
        hpct: { lsl: 75, tgt: 100, usl: 125 },
        area: { lsl: 70, tgt: 100, usl: 130 },
        offx: { lsl: -75, tgt: 0, usl: 75 },
        offy: { lsl: -75, tgt: 0, usl: 75 },
      },
      groups: {},
      note: "稽核重現（無 v3 原檔，僅全域窗）",
    };
    const st = core.partSpecToState(spec, STENCIL);
    S.specSrc = "part";
    S.specs = st.specs;
    S.specsG = st.specsG;
    S.partSpec = { part: spec.part, ver: 3, sha: "87eec342530a0000000000000000000000000000000000000000000000000000", stencilRef: 120 };
  } else {
    S.specSrc = "sample";
    S.specs = JSON.parse(JSON.stringify(core.DEF_SPECS));
    S.specsG = null;
    S.partSpec = null;
  }
}

function runScenario(hook, spiPath, placeRes, specMode, groupBy) {
  const { built, conv } = importPipeline(hook, spiPath, placeRes, groupBy);
  hook.S.rows = built.rows;
  hook.S.metrics = built.metrics;
  hook.S.metric = "volume";
  hook.S.group = core.ALL_GRP;
  applySpec(hook, specMode);
  const st = { ...hook.S, rows: built.rows, metrics: built.metrics };
  const F = core.detectIssues(st);
  hook.S.F = F;
  Object.assign(core.S, hook.S);
  const csv = core.issuesCsv(F);
  const genRows = csvToRows(csv);
  return { built, conv, F, genRows, counts: countLevelsFromCards(F), verdict: F.meta?.verdict };
}

function main() {
  const hook = createHook();
  const placeTab = hook.csvTable(fs.readFileSync(PATHS.place, "utf8"));
  const placeRes = hook.parsePlacement(placeTab, "mm", "BOTH");

  const userRows = csvToRows(fs.readFileSync(PATHS.userCsv, "utf8"));
  const userCounts = countLevelsFromCards(userRows.map((r) => ({ level: r.level })));

  const keys = ["level", "category", "title", "rule_id", "metric"];
  const fpUser = fingerprint(userRows, keys);

  const out = { userRows: userRows.length, userCounts, placeItems: placeRes.items.length, scenarios: [] };

  for (const spi of [
    { label: "B_2384", path: PATHS.spiB },
    { label: "A_958", path: PATHS.spiA },
  ]) {
    for (const groupBy of ["pkg", "comp"]) {
      for (const specMode of ["part-default", "sample"]) {
      try {
        const r = runScenario(hook, spi.path, placeRes, specMode, groupBy);
        const boards = new Set(r.built.rows.map((x) => x.board)).size;
        const pads = new Set(r.built.rows.map((x) => x.pad)).size;
        const groups = new Set(r.built.rows.map((x) => x.group)).size;
        const fpGen = fingerprint(r.genRows, keys);
        const titleSet = new Set(userRows.map((x) => x.title));
        let titleHit = 0;
        for (const x of r.F) if (titleSet.has(x.title)) titleHit++;
        out.scenarios.push({
          spi: spi.label,
          groupBy,
          specMode,
          boards,
          pads,
          groups,
          measureRows: r.built.rows.length,
          conv: r.conv.info,
          issueTotal: r.F.length,
          counts: r.counts,
          verdict: r.verdict?.label,
          titleHit,
          titleHitPct: +((100 * titleHit) / userRows.length).toFixed(1),
          fpMatch: fpUser === fpGen,
          countDelta: {
            嚴重: r.counts.嚴重 - userCounts.嚴重,
            警示: r.counts.警示 - userCounts.警示,
            資訊: r.counts.資訊 - userCounts.資訊,
            total: r.F.length - userRows.length,
          },
          topRules: [...new Set(r.F.map((x) => x.rule_id))].slice(0, 8),
          first3: r.F.slice(0, 3).map((x) => ({ title: x.title, rule_id: x.rule_id, lv: x.lv })),
        });
      } catch (e) {
        out.scenarios.push({ spi: spi.label, groupBy, specMode, error: String(e.message || e) });
      }
      }
    }
  }

  console.log(JSON.stringify(out, null, 2));
}

main();
