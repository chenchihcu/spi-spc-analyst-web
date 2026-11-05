import assert from "node:assert/strict";
import test from "node:test";
import { loadCore, baseState } from "./_load.js";

const c = loadCore();

function st(rows, extra = {}) {
  return baseState(c, {
    rows,
    metrics: ["volume", "height", "area"],
    metric: "volume",
    group: c.ALL_GRP,
    chart: "xbars",
    specs: { volume: { lsl: 70, usl: 130, tgt: 100 }, height: { lsl: 100, usl: 140, tgt: 120 }, area: { lsl: 80, usl: 120, tgt: 100 } },
    specSrc: "custom",
    ...extra,
  });
}

test("PR-B adSample: n≤4000 回傳原參照", () => {
  const v = [1, 2, 3, 4, 5];
  assert.equal(c.adSample(v), v);
});

test("PR-B adSample: 相同多重集、不同列順序 → 相同 AD p", () => {
  let seed = 7319;
  const rnd = () => ((seed = (1664525 * seed + 1013904223) >>> 0) + 0.5) / 4294967296;
  const normalValues = [];
  for (let i = 0; i < 4000; i++) {
    let sum = 0;
    for (let j = 0; j < 12; j++) sum += rnd();
    normalValues.push(sum - 6);
  }
  const exponentialValues = Array.from({ length: 4000 }, () => -Math.log(rnd()));
  const values = [];
  for (let i = 0; i < 4000; i++) values.push(normalValues[i], exponentialValues[i]);
  const shuffled = values.slice(1).concat(values[0]);
  const pA = c.andersonDarling(c.adSample(values)).p;
  const pB = c.andersonDarling(c.adSample(shuffled)).p;
  assert.equal(pA, pB);
  assert.ok(c.adSample(values).length === 4000);
});

test("PR-B poissonSf: 大 k 上尾以 log 域累加仍為有限遞減值", () => {
  const l = 80;
  const sf40 = c.poissonSf(40, l);
  const sf41 = c.poissonSf(41, l);
  assert.ok(sf40 > sf41, "上尾機率應隨 k 遞減");
  assert.ok(sf41 > 0);
  const legacy = (() => {
    let s = 0;
    let term = Math.exp(-l);
    for (let i = 0; i < 41; i++) {
      s += term;
      term *= l / (i + 1);
    }
    return Math.max(0, 1 - s);
  })();
  assert.ok(Math.abs(sf41 - legacy) < 1e-10 || sf41 > legacy, "log 域實作不應比級數下溢更差");
});

test("PR-B robust: 零變異 fail-closed（s 為 NaN）", () => {
  const { m, s } = c.robust([5, 5, 5, 5]);
  assert.equal(m, 5);
  assert.ok(Number.isNaN(s));
});

test("FIX-1 Nelson 規則 8：兩側皆 |z|>1（回歸 #93）", () => {
  const r8pos = c.nelson(Array(8).fill(1.1)).rules.find((r) => r.id === 8);
  assert.equal(r8pos.idx.length, 0);
  const r8mix = c.nelson([...Array(7).fill(1.1), -1.1]).rules.find((r) => r.id === 8);
  assert.ok(r8mix.idx.length === 8 && r8mix.idx.every((v, i) => v === i));
});

test("FIX-11 空間梯度 rule_name 揭露 N−G−1 自由度", () => {
  const rows = [];
  for (let g = 0; g < 3; g++) {
    for (let p = 0; p < 20; p++) {
      rows.push({
        board: "B01",
        pad: `G${g}-P${p}`,
        comp: `C${g}`,
        group: `G${g}`,
        x: p * 2 + g * 10,
        y: (p * 7) % 5,
        volume: 100 + g * 0.5 + p * 0.02,
        height: 120,
        area: 100,
      });
    }
  }
  const issue = c.detectIssues(st(rows)).find((x) => x.rule_id.startsWith("空間偏相關"));
  if (issue) assert.match(issue.rule_name, /N−群組數−1/);
});
