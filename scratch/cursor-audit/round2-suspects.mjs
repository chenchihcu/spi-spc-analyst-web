#!/usr/bin/env node
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { loadCore } = require("../../tests/_load.js");
const core = loadCore();

const out = {};

// S01 / CX-R1-006 Nelson 8
const zSame = [1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1];
out.nelson8 = {
  app: core.nelson(zSame).rules.find((r) => r.id === 8).idx.length > 0,
};

// CX-R1-007 Nelson 4 NaN
const zNan = Array(14).fill(NaN);
out.nelson4NaN = core.nelson(zNan).rules.find((r) => r.id === 4).idx;

// S02 rule 7 excluded from flag and stable
const zRule7 = Array(15).fill(0);
for (let i = 7; i < 15; i++) zRule7[i] = 1.5;
const n7 = core.nelson(zRule7);
out.s02 = {
  rule7Hits: n7.rules.find((r) => r.id === 7).idx.length,
  flagIncludesRule7: [...n7.flag].some((i) => i >= 7),
  stableWouldIgnoreRule7: !n7.rules.some((r) => r.idx.length && r.id !== 7),
};

// CX-R1-009 / S09 Poisson
out.poisson = [
  { k: 5, l: 1, app: core.poissonSf(5, 1) },
  { k: 20, l: 1, app: core.poissonSf(20, 1) },
  { k: 1000, l: 1000, app: core.poissonSf(1000, 1000) },
];

// CX-R1-008 zero variance
const rows = [];
for (let b = 1; b <= 5; b++)
  for (const pad of ["P1", "P2"])
    rows.push({ board: `B0${b}`, pad, comp: "U1", group: "U1", volume: 130, height: 120, hpct: 100, area: 100, offx: 0, offy: 0 });
const st = {
  ...core.S,
  rows,
  metrics: ["volume"],
  metric: "volume",
  group: core.ALL_GRP,
  stencil: 120,
  specSrc: "part",
  specs: { ...core.DEF_SPECS, volume: { lsl: 70, usl: 130, tgt: 100 } },
  partSpec: { part: "T", ver: 1, sha: "0", stencilRef: 120 },
};
const F = core.detectIssues(st);
out.zeroVar = { robust: core.robust([130, 130, 130, 130, 130]), card: F.find((x) => x.rule_id === "焊墊位置穩健 Cpk<1.00")?.level };

// S11: board z uses robust(bm) including self - synthetic
const boards = ["B01", "B02", "B03", "B04", "B05", "B06"];
const bm = [100, 100, 100, 100, 100, 130]; // B06 spike
const { m, s } = core.robust(bm);
const zB06 = (130 - m) / s;
out.s11 = { m, s, zB06, note: "robust(bm) includes all boards in cell" };

// M-09 on 301: count offenders >=3 boards
const data = JSON.parse(fs.readFileSync("/workspace/artifacts/round2-data.json", "utf8"));
out.m09Card = data.nonCpk.find((x) => x.rule_id.includes("M-09"));

fs.writeFileSync("/workspace/artifacts/round2-suspects.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
