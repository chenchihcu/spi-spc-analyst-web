#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const { HTML, loadCore } = require("../../tests/_load.js");

const UP = "/home/ubuntu/.cursor/projects/workspace/uploads";
const core = loadCore();
const html = () => fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");

function createHook() {
  const dom = new JSDOM(html(), {
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

function main() {
  const hook = createHook();
  const placeRes = hook.parsePlacement(
    hook.csvTable(fs.readFileSync(path.join(UP, "placement_cad_8eab.csv"), "utf8")),
    "mm",
    "BOTH",
  );
  const raw = hook.csvTable(fs.readFileSync(path.join(UP, "spi_raw_B_2384rows_d310.csv"), "utf8"));
  const conv = hook.unpivotWide(raw, { side: "TOP", place: placeRes, stencil: 120 });
  const map = core.autoMap(conv.tab.head);
  const built = core.buildRows(
    conv.tab,
    map,
    { ...core.guessOpts(conv.tab.head, map), side: "TOP", place: placeRes, groupFallback: "comp" },
    5,
  );
  for (const r of built.rows) if (r.comp) r.group = r.comp;

  const baseThk = 120;
  for (const r of built.rows) {
    if (r.height != null)
      r.hpct = Math.round((r.height / baseThk) * 1000) / 10;
  }

  const slim = built.rows.map((r) => ({
    board: r.board,
    pad: r.pad,
    comp: r.comp,
    group: r.group,
    pkg: r.pkg,
    volume: r.volume,
    hpct: r.hpct,
    area: r.area,
    offx: r.offx,
    offy: r.offy,
  }));
  fs.writeFileSync("/workspace/artifacts/round1-rows.json", JSON.stringify(slim));

  const spec = JSON.parse(fs.readFileSync(path.join(UP, "spec_301-0011001123_v3_a3ca.json"), "utf8"));
  const pst = core.partSpecToState(spec, 120);
  const st = {
    ...core.S,
    rows: built.rows,
    metrics: built.metrics,
    metric: "volume",
    group: core.ALL_GRP,
    stencil: 120,
    specSrc: "part",
    specs: pst.specs,
    specsG: pst.specsG,
    htol: pst.htol,
    partSpec: { part: spec.part, ver: 3, sha: "87eec342530a", stencilRef: 120 },
  };
  const F = core.detectIssues(st);
  const list = [];
  for (const x of F.filter((c) => c.rule_id === "焊墊位置穩健 Cpk<1.00")) {
    const m = x.title.match(/^(.+?) (體積|高度%厚|面積|X 偏移|Y 偏移)焊墊位置穩健 Cpk（中位數）(-?\d+\.\d+)/);
    if (!m) continue;
    const metricMap = { 體積: "volume", "高度%厚": "hpct", 面積: "area", "X 偏移": "offx", "Y 偏移": "offy" };
    list.push({
      g: m[1],
      k: metricMap[m[2]],
      mc: parseFloat(m[3]),
      lv: x.lv,
      level: x.level,
    });
  }
  fs.writeFileSync("/workspace/artifacts/round1-robust-app.json", JSON.stringify(list));
  console.log("rows", slim.length, "robust cards", list.length);
}

main();
