import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const { JSDOM } = require("jsdom");

export function loadCoreFromHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const m = html.match(/<script id="core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`no core script in ${htmlPath}`);
  const sandbox = {
    module: { exports: {} },
    Math,
    Date,
    JSON,
    console,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    DataView,
    ArrayBuffer,
  };
  vm.runInNewContext(m[1], sandbox, { filename: "core.js" });
  return { core: sandbox.module.exports, html };
}

export function createHookFromHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8").replace(/<script src=[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://spi.example/",
    beforeParse(w) {
      w.scrollTo = () => {};
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
      w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,mock";
      w.SPI_TEST_HOOK = {};
    },
  });
  return { hook: dom.window.SPI_TEST_HOOK, win: dom.window };
}

export const UP = "/home/ubuntu/.cursor/projects/workspace/uploads";
export const PATHS = {
  spiB: `${UP}/spi_raw_B_2384rows_d310.csv`,
  place: `${UP}/placement_cad_8eab.csv`,
  spec: `${UP}/spec_301-0011001123_v3_a3ca.json`,
  userExport: `${UP}/user_input_9b4c.csv`,
};

let _sharedPlace = null;
export function sharedPlacementRes(htmlPathForPlace = "/tmp/spi-v10.11.2.html") {
  if (_sharedPlace) return _sharedPlace;
  const { hook } = createHookFromHtml(htmlPathForPlace);
  if (!hook.parsePlacement) throw new Error("parsePlacement missing on hook");
  _sharedPlace = hook.parsePlacement(hook.csvTable(fs.readFileSync(PATHS.place, "utf8")), "mm", "BOTH");
  return _sharedPlace;
}

export function fullPipeline({ htmlPath, stencilUm, groupMode = "comp", placeRes: placeIn }) {
  const { core } = loadCoreFromHtml(htmlPath);
  const { hook } = createHookFromHtml(htmlPath);
  const placeRes =
    placeIn ||
    (hook.parsePlacement
      ? hook.parsePlacement(hook.csvTable(fs.readFileSync(PATHS.place, "utf8")), "mm", "BOTH")
      : sharedPlacementRes());
  if (!hook.unpivotWide) throw new Error(`unpivotWide missing on hook for ${htmlPath}`);
  const raw = hook.csvTable(fs.readFileSync(PATHS.spiB, "utf8"));
  const conv = hook.unpivotWide(raw, { side: "TOP", place: placeRes, stencil: stencilUm });
  const map = core.autoMap(conv.tab.head);
  const built = core.buildRows(
    conv.tab,
    map,
    { ...core.guessOpts(conv.tab.head, map), side: "TOP", place: placeRes, groupFallback: "comp" },
    5,
  );
  if (groupMode === "comp") for (const r of built.rows) if (r.comp) r.group = r.comp;
  const spec = JSON.parse(fs.readFileSync(PATHS.spec, "utf8"));
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
    step: { on: false, zones: [] },
  };
  for (const r of st.rows) {
    if (r.height != null) r.hpct = Math.round((r.height / stencilUm) * 1000) / 10;
  }
  const F = core.detectIssues(st);
  const A = core.analyze({ ...st, metric: "volume" });
  return { core, hook, st, F, A, placeRes };
}

export function cardKey(c) {
  return `${c.level || { ng: "嚴重", warn: "警示", info: "資訊" }[c.lv]}\t${c.rule_id}\t${c.title}`;
}

export function countLevels(F) {
  const c = { 嚴重: 0, 警示: 0, 資訊: 0 };
  for (const x of F) {
    const lv = x.level || { ng: "嚴重", warn: "警示", info: "資訊" }[x.lv];
    if (c[lv] !== undefined) c[lv]++;
  }
  return c;
}

export function titleMc(F, g, k) {
  const metricLabel = { volume: "體積", hpct: "高度%厚", area: "面積", offx: "X 偏移", offy: "Y 偏移" }[k];
  const x = F.find((c) => c.rule_id === "焊墊位置穩健 Cpk<1.00" && c.title.startsWith(`${g} ${metricLabel}`));
  if (!x) return null;
  const m = x.title.match(/（中位數）(-?\d+\.\d+)/);
  return m ? parseFloat(m[1]) : null;
}
