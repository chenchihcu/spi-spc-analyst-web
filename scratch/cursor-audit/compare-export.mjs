#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const { HTML, loadCore } = require("../../tests/_load.js");

const UP = "/home/ubuntu/.cursor/projects/workspace/uploads";
const SPEC_PATH = path.join(UP, "spec_301-0011001123_v3_a3ca.json");
const core = loadCore();
const SIDE = "TOP";

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

function csvToRows(text) {
  const tab = core.csvTable(text);
  return tab.data.map((cells) => Object.fromEntries(tab.head.map((h, i) => [h, cells[i] ?? ""])));
}

function loadSpec() {
  const raw = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  const canon = core.partSpecCanon(raw);
  const sha = createHash("sha256").update(canon, "utf8").digest("hex");
  return { raw, canon, sha };
}

function pipeline(hook, stencilUm) {
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
  for (const r of built.rows) if (r.comp) r.group = r.comp;

  const { raw: specObj, sha } = loadSpec();
  const pst = core.partSpecToState(specObj, stencilUm);
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
    partSpec: { part: specObj.part, ver: 3, sha, stencilRef: specObj.stencilRef ?? 120 },
  };
  const F = core.detectIssues(st);
  Object.assign(core.S, st);
  const csvRows = csvToRows(core.issuesCsv(F));

  const sample = built.rows.find((r) => r.comp === "J2" && r.board === "B01");
  let hpctCheck = null;
  if (sample && sample.height != null) {
    const thk = stencilUm;
    const hpctFromHeight = Math.round((sample.height / thk) * 1000) / 10;
    hpctCheck = { comp: "J2", board: "B01", height_um: sample.height, stencil_um: thk, hpct_recomputed: hpctFromHeight, row_hpct: sample.hpct };
  }

  return { F, csvRows, built, hpctCheck };
}

function compare(userRows, csvRows) {
  const key = (r) => `${r.level}\t${r.rule_id}\t${r.title}`;
  const userMap = new Map(userRows.map((r) => [key(r), r]));
  const genMap = new Map(csvRows.map((r) => [key(r), r]));

  const onlyUser = [];
  const onlyGen = [];
  for (const k of userMap.keys()) if (!genMap.has(k)) onlyUser.push(userMap.get(k));
  for (const k of genMap.keys()) if (!userMap.has(k)) onlyGen.push(genMap.get(k));

  let exactMatch = 0;
  for (const k of userMap.keys()) if (genMap.has(k)) exactMatch++;

  const fieldDiffs = [];
  for (const k of userMap.keys()) {
    if (!genMap.has(k)) continue;
    const u = userMap.get(k);
    const g = genMap.get(k);
    for (const f of ["level", "observed", "z", "p", "metric"]) {
      if (String(u[f] ?? "").trim() !== String(g[f] ?? "").trim()) {
        fieldDiffs.push({ title: u.title, rule_id: u.rule_id, field: f, user: u[f], gen: g[f] });
      }
    }
  }

  const byRuleOnlyUser = {};
  for (const r of onlyUser) byRuleOnlyUser[r.rule_id] = (byRuleOnlyUser[r.rule_id] || 0) + 1;
  const byRuleOnlyGen = {};
  for (const r of onlyGen) byRuleOnlyGen[r.rule_id] = (byRuleOnlyGen[r.rule_id] || 0) + 1;

  return {
    exactMatch,
    exactMatchPct: +((100 * exactMatch) / userRows.length).toFixed(1),
    onlyUserCount: onlyUser.length,
    onlyGenCount: onlyGen.length,
    onlyUser: onlyUser.map((r) => ({ no: r.no, level: r.level, title: r.title, rule_id: r.rule_id })),
    onlyGen: onlyGen.map((r) => ({ no: r.no, level: r.level, title: r.title, rule_id: r.rule_id })),
    byRuleOnlyUser,
    byRuleOnlyGen,
    fieldDiffsTotal: fieldDiffs.length,
    fieldDiffsSample: fieldDiffs.slice(0, 50),
    levelDiffs: {
      onlyUser_severity: onlyUser.reduce((a, r) => ((a[r.level] = (a[r.level] || 0) + 1), a), {}),
      onlyGen_severity: onlyGen.reduce((a, r) => ((a[r.level] = (a[r.level] || 0) + 1), a), {}),
    },
  };
}

function main() {
  const { sha, canon } = loadSpec();
  const userRows = csvToRows(fs.readFileSync(path.join(UP, "user_input_9b4c.csv"), "utf8"));
  const userLevels = userRows.reduce((a, r) => ((a[r.level] = (a[r.level] || 0) + 1), a), {});

  const hook = createHook();
  const stencils = [90, 120];
  const runs = {};

  for (const st of stencils) {
    const { csvRows, hpctCheck, built } = pipeline(hook, st);
    const genLevels = csvRows.reduce((a, r) => ((a[r.level] = (a[r.level] || 0) + 1), a), {});
    runs[st] = {
      stencil_um: st,
      totals: { total: csvRows.length, ...genLevels },
      deltaVsExport: {
        嚴重: (genLevels.嚴重 || 0) - (userLevels.嚴重 || 0),
        警示: (genLevels.警示 || 0) - (userLevels.警示 || 0),
        資訊: (genLevels.資訊 || 0) - (userLevels.資訊 || 0),
        total: csvRows.length - userRows.length,
      },
      compare: compare(userRows, csvRows),
      hpctCheck,
      sampleHeight: built.rows.find((r) => r.comp === "J2" && r.board === "B01")?.height,
    };
  }

  const out = {
    specFile: SPEC_PATH,
    specSha256: sha,
    specSha256_prefix: sha.slice(0, 12),
    specMatchesExportPrefix: sha.startsWith("87eec342530a"),
    exportBaseline: { total: userRows.length, ...userLevels },
    stencilRef_inSpecFile: 120,
    note_stencilRef:
      "stencilRef 僅寫入規格存檔與 spec_source 文案；量測換算與 hpct 使用回合 st.stencil（與 unpivotWide 的 thk 一致）",
    runs,
    recommendedStencil_um: (() => {
      const a = runs[90].compare.exactMatch;
      const b = runs[120].compare.exactMatch;
      return a >= b ? 90 : 120;
    })(),
  };

  fs.writeFileSync("/workspace/artifacts/replay-301-diff-summary.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ specSha256: sha.slice(0, 16) + "…", exportBaseline: out.exportBaseline, run90: runs[90].totals, run120: runs[120].totals, exact90: runs[90].compare.exactMatch, exact120: runs[120].compare.exactMatch }, null, 2));
}

main();
