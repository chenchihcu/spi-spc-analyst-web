#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const { HTML, loadCore } = require("../../tests/_load.js");
const UP = "/home/ubuntu/.cursor/projects/workspace/uploads";
const core = loadCore();
const html = fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "https://x/",
  beforeParse(w) {
    w.scrollTo = () => {};
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
    w.SPI_TEST_HOOK = {};
  },
});
const hook = dom.window.SPI_TEST_HOOK;

function titles(stencil) {
  const place = hook.parsePlacement(hook.csvTable(fs.readFileSync(path.join(UP, "placement_cad_8eab.csv"), "utf8")), "mm", "BOTH");
  const raw = hook.csvTable(fs.readFileSync(path.join(UP, "spi_raw_B_2384rows_d310.csv"), "utf8"));
  const conv = hook.unpivotWide(raw, { side: "TOP", place, stencil });
  const map = core.autoMap(conv.tab.head);
  const built = core.buildRows(conv.tab, map, { ...core.guessOpts(conv.tab.head, map), side: "TOP", place, groupFallback: "comp" }, 5);
  for (const r of built.rows) if (r.comp) r.group = r.comp;
  const spec = JSON.parse(fs.readFileSync(path.join(UP, "spec_301-0011001123_v3_a3ca.json"), "utf8"));
  const pst = core.partSpecToState(spec, stencil);
  const st = { ...core.S, rows: built.rows, metrics: built.metrics, metric: "volume", group: core.ALL_GRP, stencil, specSrc: "part", specs: pst.specs, specsG: pst.specsG, htol: pst.htol, partSpec: { part: spec.part, ver: 3, sha: "x", stencilRef: 120 } };
  for (const r of st.rows) if (r.height != null) r.hpct = Math.round((r.height / stencil) * 1000) / 10;
  const F = core.detectIssues(st);
  const pick = (g) => {
    const c = F.find((x) => x.rule_id === "焊墊位置穩健 Cpk<1.00" && x.title.startsWith(`${g} 高度%厚`));
    if (!c) return null;
    const m = c.title.match(/（中位數）(-?\d+\.\d+)/);
    return m ? parseFloat(m[1]) : null;
  };
  const d30 = F.find((x) => x.rule_id === "孤立極端焊墊（D-30）" && x.metric === "高度%厚");
  return { stencil, R281: pick("R281"), ED4: pick("ED4"), L17: pick("L17"), C94: pick("C94"), ED16: pick("ED16"), d30n: d30?.sig?.rows?.length ?? null };
}

const out = { um90: titles(90), um120: titles(120) };
fs.writeFileSync("/workspace/artifacts/round2-precision.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
