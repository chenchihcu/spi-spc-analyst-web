#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  fullPipeline,
  cardKey,
  countLevels,
  titleMc,
  loadCoreFromHtml,
  createHookFromHtml,
  UP,
} from "./html-core.mjs";

const HTML = {
  v1037: "/tmp/spi-v10.3.7.html",
  v1011: "/tmp/spi-v10.11.1.html",
  v1012: "/tmp/spi-v10.11.2.html",
};
const OUT = "/workspace/artifacts/round3-data.json";

function loadUserExportKeys() {
  const text = fs.readFileSync(`${UP}/user_input_9b4c.csv`, "utf8");
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(",");
  const keys = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const o = {};
    head.forEach((h, j) => {
      o[h] = cells[j] ?? "";
    });
    keys.push(`${o.level}\t${o.rule_id}\t${o.title}`);
  }
  return keys;
}

function runVariant(label, htmlPath, stencil) {
  const { F } = fullPipeline({ htmlPath, stencilUm: stencil, groupMode: "comp" });
  const keys = F.map(cardKey);
  return {
    label,
    stencil,
    counts: countLevels(F),
    keys,
    d30Hpct: F.find((x) => x.rule_id === "孤立極端焊墊（D-30）" && x.metric === "高度%厚")?.title,
    d30Rows: F.filter((x) => x.rule_id === "孤立極端焊墊（D-30）").map((x) => ({
      metric: x.metric,
      title: x.title,
      n: x.sig?.rows?.length,
      p: x.p,
    })),
    mc: {
      R281: titleMc(F, "R281", "hpct"),
      ED4: titleMc(F, "ED4", "hpct"),
      C94: titleMc(F, "C94", "hpct"),
      ED16: titleMc(F, "ED16", "hpct"),
      L17: titleMc(F, "L17", "hpct"),
    },
    transfer: F.filter((x) => x.rule_id?.includes("轉移") || x.title?.includes("轉移效率")).map((x) => ({
      title: x.title,
      rule_id: x.rule_id,
      facts: x.facts?.[0],
    })),
    nonCpk: F.filter((x) => x.rule_id !== "焊墊位置穩健 Cpk<1.00").length,
  };
}

function t1Confirmed(htmlPath) {
  const { core } = loadCoreFromHtml(htmlPath);
  const nelsonNaN = core.nelson(Array(14).fill(NaN));
  const r4 = nelsonNaN.rules.find((r) => r.id === 4);
  const nelson8 = core.nelson(Array(8).fill(1.1));
  const r8 = nelson8.rules.find((r) => r.id === 8);
  const poisson = [
    [20, 1],
    [1000, 1000],
    [5, 1],
  ].map(([k, l]) => ({ k, l, app: core.poissonSf(k, l) }));
  const zeroRows = [];
  for (let b = 1; b <= 5; b++) {
    for (const pad of ["P1", "P2"]) {
      zeroRows.push({
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
    rows: zeroRows,
    metrics: ["volume", "hpct", "area", "offx", "offy"],
    metric: "volume",
    group: core.ALL_GRP,
    stencil: 120,
    specSrc: "part",
    specs: { ...core.DEF_SPECS, volume: { lsl: 70, usl: 130, tgt: 100 } },
    specsG: null,
    partSpec: { part: "T", ver: 1, sha: "0", stencilRef: 120 },
    step: { on: false, zones: [] },
  };
  const zv = core.detectIssues(st).filter((x) => x.rule_id === "焊墊位置穩健 Cpk<1.00");
  const html = fs.readFileSync(htmlPath, "utf8");
  const lineOf = (pat) => {
    const lines = html.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) if (pat.test(lines[i])) return i + 1;
    return null;
  };
  return {
    nelson4NaN: { idx: r4.idx, line: lineOf(/if\(i>=13\).*alt/) },
    nelson8SameSide: { idx: r8.idx, hits: r8.idx.length > 0, line: lineOf(/if\(i>=7\).*every\(v=>Math\.abs\(v\)>1\)/) },
    poisson,
    zeroVar: { cards: zv.map((x) => x.level), robust: core.robust(zeroRows.map((r) => r.volume)) },
    s11Lines: { vals: lineOf(/const vals=bm\.filter\(isFinite\)/), rule: lineOf(/其他板中位數/) },
    ux: {
      buildRows: lineOf(/groupFallback/),
      vundefined: lineOf(/vundefined|rec\.ver/),
      stencilHeader: lineOf(/S\.stencil/),
      place7811: lineOf(/PLACE\.part.*inPart|part===.*part/),
      usePlaceRec: lineOf(/usePlaceRec|rec\.placeId/),
    },
  };
}

function s03Probe(htmlPath) {
  const { core, hook } = (() => {
    const { core } = loadCoreFromHtml(htmlPath);
    const { hook } = createHookFromHtml(htmlPath);
    return { core, hook };
  })();
  const boards = ["B01", "B02", "B03", "B04", "B05", "B06"];
  const ns = [2, 10, 2, 10, 2, 10];
  const avgs = [98, 102, 99, 103, 100, 104];
  const rows = [];
  let pid = 0;
  for (let bi = 0; bi < boards.length; bi++) {
    for (let j = 0; j < ns[bi]; j++) {
      rows.push({
        board: boards[bi],
        pad: `P${pid++}`,
        comp: "U1",
        group: "U1",
        volume: avgs[bi] + (j % 2 ? 1 : -1),
        height: 100,
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
    metrics: ["volume"],
    metric: "volume",
    group: core.ALL_GRP,
    stencil: 120,
    specSrc: "sample",
    specs: core.DEF_SPECS,
    step: { on: false, zones: [] },
  };
  const A = core.analyze(st);
  const boardMeans = boards.map((b) => {
    const v = rows.filter((r) => r.board === b).map((r) => r.volume);
    return v.reduce((a, x) => a + x, 0) / v.length;
  });
  const gMeanPads = rows.reduce((a, r) => a + r.volume, 0) / rows.length;
  const gMeanBoards = boardMeans.reduce((a, x) => a + x, 0) / boardMeans.length;
  return {
    appCenter: A.xs?.cl ?? A.gMean,
    gMeanPads,
    gMeanBoards,
    pts: A.xs?.pts?.map((p, i) => ({ lab: p.lab, zApp: p.z, zBoardMean: (boardMeans[i] - gMeanBoards) / (A.xs.sB || 1) })),
  };
}

function main() {
  const userKeys = loadUserExportKeys();
  const variants = [
    runVariant("v10.3.7@90", HTML.v1037, 90),
    runVariant("v10.3.7@120", HTML.v1037, 120),
    runVariant("v10.11.1@90", HTML.v1011, 90),
    runVariant("v10.11.1@120", HTML.v1011, 120),
    runVariant("v10.11.2@90", HTML.v1012, 90),
    runVariant("v10.11.2@120", HTML.v1012, 120),
  ];
  const matchUser = (keys) => {
    const set = new Set(keys);
    let n = 0;
    for (const k of userKeys) if (set.has(k)) n++;
    return n;
  };
  const six = {
    export: { D30: 70, R281: 0.46, ED4: 0.64, C94: 0.80, ED16: 0.81, L17: 0.92 },
    v1037_120: variants.find((v) => v.label === "v10.3.7@120").mc,
    v1012_120: variants.find((v) => v.label === "v10.11.2@120").mc,
    d30Title1037: variants.find((v) => v.label === "v10.3.7@120").d30Hpct,
    d30Title1012: variants.find((v) => v.label === "v10.11.2@120").d30Hpct,
  };
  const full301 = fullPipeline({ htmlPath: HTML.v1012, stencilUm: 120, groupMode: "comp" });
  const F = full301.F;
  const d30cards = F.filter((x) => x.rule_id === "孤立極端焊墊（D-30）");
  const out = {
    mainSha: "db17c7bae687ec141511ee52828b2ad61fd50606",
    fetchedMainAt: new Date().toISOString(),
    fourWay: variants.map((v) => ({
      ...v,
      matchUser: matchUser(v.keys),
      keys: undefined,
    })),
    sixDiff: six,
    t1: t1Confirmed(HTML.v1012),
    t1Old4534: t1Confirmed(HTML.v1011),
    s03: s03Probe(HTML.v1012),
    d30Full: d30cards.map((c) => ({
      metric: c.metric,
      title: c.title,
      level: c.level,
      rows: c.sig?.rows?.map((r) => ({
        board: r.r?.board,
        pad: r.r?.pad,
        g: r.g,
        x: r.x,
        z: r.z,
        over: r.over,
        lv: r.lv,
      })),
      p: c.p,
    })),
    nonCpkCards: F.filter((x) => x.rule_id !== "焊墊位置穩健 Cpk<1.00").map((x) => ({
      no: x.no,
      level: x.level,
      rule_id: x.rule_id,
      title: x.title,
      metric: x.metric,
    })),
    codex12: {
      padLong: F.filter((x) => x.rule_id === "焊墊位置長期偏離（穩健 Cpk<1.00 且 |z|≥4）").map((x) => x.title),
      transfer: F.filter((x) => x.title?.includes("轉移效率") || x.rule_id?.includes("轉移")),
      nelson: F.filter((x) => x.rule_id?.startsWith("Nelson")),
    },
    transferJ2B1: variants.find((v) => v.label === "v10.3.7@120").transfer,
    transferNew: variants.find((v) => v.label === "v10.11.2@120").transfer,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        fourWay: out.fourWay.map((v) => ({ label: v.label, counts: v.counts, match: v.matchUser })),
        sixDiff: out.sixDiff,
      },
      null,
      2,
    ),
  );
}

main();
