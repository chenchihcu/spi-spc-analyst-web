import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  crossEvidenceKind,
  scatterDisplayDisclosure,
  computePadCoverage,
  parseGeometryPadListCsv,
  paretoGroupKey,
  aggregateParetoByVendor,
  computeSidedPpmBlock,
  formatSidedPpmBlock,
  relChartDuplicateReason,
  validateKbRulesPayload,
  spatialChartUnavailableText,
  hasValidSpatialXY,
  overviewCpkSnapshotKey,
} from "../lib/windows-parity.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("FR-1 spatial unavailable text", () => {
  const t = spatialChartUnavailableText();
  assert.match(t.short, /缺座標/);
  assert.equal(hasValidSpatialXY([{ x: 1, y: 2, gridPos: true }], (r) => !r.gridPos && Number.isFinite(r.x)), false);
  assert.equal(hasValidSpatialXY([{ x: 1, y: 2 }], (r) => Number.isFinite(r.x) && Number.isFinite(r.y)), true);
});

test("FR-2 evidence kinds", () => {
  assert.equal(crossEvidenceKind({ st: "na", ev: "不適用（無座標）", src: "熱圖" }), "未納入");
  assert.equal(crossEvidenceKind({ st: "ok", src: "Cpk / Ppk", ev: "Cpk 1.2" }), "統計計算");
});

test("FR-4 scatter disclosure", () => {
  assert.equal(scatterDisplayDisclosure(100, 100), null);
  const d = scatterDisplayDisclosure(5000, 1500);
  assert.ok(d.text.includes("分析筆數"));
  assert.ok(d.text.includes("已抽樣"));
  assert.ok(d.analysisCount > d.displayCount);
});

test("FR-6 KB JSON validate", () => {
  const raw = JSON.parse(readFileSync(join(root, "vendor/spi-process-kb-rules.json"), "utf8"));
  const v = validateKbRulesPayload(raw, raw.fingerprint);
  assert.equal(v.ok, true);
  assert.equal(v.rules.length, 30);
  const bad = validateKbRulesPayload(raw, "deadbeef");
  assert.equal(bad.ok, false);
});

test("FR-9 pad coverage", () => {
  const c = computePadCoverage(["P1", "P2", "P3"], ["P1", "P2"]);
  assert.equal(c.pendingVerify, true);
  assert.deepEqual(c.uncovered, ["P3"]);
  const full = computePadCoverage(["A", "B"], ["A", "B"]);
  assert.equal(full.pendingVerify, false);
  const csv = parseGeometryPadListCsv("pad\nU1-1\nU1-2\n");
  assert.equal(csv.ok, true);
  assert.deepEqual(csv.pads, ["U1-1", "U1-2"]);
});

test("FR-10 vendor pareto grouping", () => {
  assert.equal(paretoGroupKey("R101_2", "lirong").subpanel, "2");
  assert.equal(paretoGroupKey("R101_2", "generic").subpanel, null);
  const rows = [{ comp: "R101_2", codes: ["a"] }, { comp: "R101_2", codes: ["b"] }, { comp: "C1", codes: ["a"] }];
  const P = aggregateParetoByVendor(rows, "lirong");
  assert.ok(P.some(([k]) => k.includes("_2")));
});

test("FR-11 sided PPM block", () => {
  const spec = { lsl: 70, usl: 130, tgt: 100 };
  const rows = [
    { volume: 60, board: "B01" },
    { volume: 140, board: "B01" },
    { volume: 100, board: "B02" },
  ];
  const b = computeSidedPpmBlock(rows, spec, "volume", { boards: ["B01", "B02"] });
  assert.equal(b.ok, true);
  assert.ok(b.belowLslPpm > 0);
  assert.ok(b.aboveUslPpm > 0);
  const fmt = formatSidedPpmBlock(computeSidedPpmBlock(rows, { lsl: NaN, usl: 10, tgt: 5 }, "volume"));
  assert.match(fmt.belowLslPpm, /不可算/);
});

test("FR-8 rel chart duplicate guard", () => {
  assert.ok(relChartDuplicateReason("quad"));
  assert.ok(relChartDuplicateReason("corr"));
  assert.equal(relChartDuplicateReason("specScatter", { x: "volume", y: "height" }), null);
});

test("FR-5 overview CPK snapshot key stable on tab-only context", () => {
  const st = { metric: "volume", group: "ALL", specs: { volume: { lsl: 1, usl: 2, tgt: 1.5 } }, specSrc: "sample", specsG: null, stencil: 120, htol: { lo: 75, hi: 125 }, step: { on: false }, rows: [{ pad: "a" }], pendingVerify: false };
  const k1 = overviewCpkSnapshotKey(st);
  const k2 = overviewCpkSnapshotKey({ ...st, tab: "control" });
  assert.equal(k1, k2);
});
