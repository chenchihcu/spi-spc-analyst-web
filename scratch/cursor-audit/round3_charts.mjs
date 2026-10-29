#!/usr/bin/env node
import fs from "node:fs";
import { loadCoreFromHtml } from "./html-core.mjs";

const HTML = "/tmp/spi-v10.11.2.html";
const OUT = "/workspace/artifacts/round3-charts.json";

function s03Series(core) {
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
  return core.analyze(st);
}

function laneyEwmaCusum(core, A) {
  const xs = A.xs;
  const pc = A.pc;
  const cus = A.cusum;
  return {
    xbar_cl: xs?.cl,
    xbar_pts: xs?.pts?.length,
    pPrime: pc?.pts?.map((p) => ({ lab: p.lab, v: p.v, ucl: p.ucl, lcl: p.lcl, z: p.z })),
    ewma: A.ewma?.pts?.map((p) => ({ lab: p.lab, v: p.v, ucl: p.ucl, lcl: p.lcl })),
    cusum: cus?.pts?.map((p) => ({ lab: p.lab, cp: p.cp, cm: p.cm, u: p.u })),
  };
}

function welchProbe(core) {
  const cases = [
    { a: [1, 2, 3, 4, 5, 6, 7, 8, 9], b: [2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { a: [1, 1, 1, 1, 1], b: [3, 3, 3, 3, 3] },
  ];
  return cases.map((c) => {
    const t = core.welch(c.a, c.b);
    return { t: t.t, df: t.df, p: t.p };
  });
}

function d4Table(core) {
  const row = core.AIAG_CONSTANTS?.D4 || core.GEN_TABLE?.D4;
  const n3 = Array.isArray(row) ? row[3] : core.AIAG_CONSTANTS?.D4?.[1];
  return { D4_n3_from_constants: core.AIAG_CONSTANTS?.D4?.[1] ?? n3 };
}

const { core } = loadCoreFromHtml(HTML);
const A = s03Series(core);
const charts = laneyEwmaCusum(core, A);
const welch = welchProbe(core);
const d4 = d4Table(core);
const welchCodex = [
  { t: -1, df: 8, p: core.tP(-1, 8) },
  { t: -1.9090281293, df: 7.1645537171, p: core.tP(-1.9090281293, 7.1645537171) },
  { t: -23.2701525564, df: 4, p: core.tP(-23.2701525564, 4) },
];

const D4_n3 = core.AIAG_CONSTANTS[3].D4;
fs.writeFileSync(OUT, JSON.stringify({ charts, welch, welchCodex, d4, AIAG_D4_n3: D4_n3 }, null, 2));
console.log(JSON.stringify({ welchCodex, D4_n3 }, null, 2));
