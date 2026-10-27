// 單板異常嚴重度：偏離其他板但仍在規格內 → 最多「警示」；有超規焊墊才判「嚴重」
// 測試資料為自行組出的合成資料：10 片板 × 5 個元件群組 × 4 個焊墊，體積約 100%（規格 70–130%）
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadCore, baseState } = require('./_load.js');
const core = loadCore();

const GROUPS = ['C1', 'C2', 'C3', 'C4', 'C5'];
function rows(tweak = () => 0) {
  let s = 12345;
  const noise = () => { s = (s * 1103515245 + 12345) % 2147483648; return (s / 2147483648 - 0.5) * 2; };
  const out = [];
  for (let b = 1; b <= 10; b++) {
    const board = 'B' + String(b).padStart(2, '0');
    for (const g of GROUPS) for (let p = 1; p <= 4; p++) {
      out.push({ board, comp: g, pad: `${g}-${p}`, group: g, volume: 100 + noise() + tweak(board, g, p) });
    }
  }
  return out;
}
const detect = (rs) => core.detectIssues(baseState(core, { rows: rs, metrics: ['volume'], metric: 'volume', group: 'ALL' }));
const sb = (F) => F.filter((x) => x.cat === '單板異常');

test('板×群組：規格內大幅偏移（|z| ≥ 6、沒有不良焊墊）只判警示', () => {
  const F = sb(detect(rows((b, g) => (b === 'B05' && g === 'C1' ? 15 : 0))));
  const c = F.find((x) => x.sig.t === 'local' && x.sig.b === 'B05' && x.sig.g === 'C1');
  assert.ok(c, '應偵測到 B05 的 C1 偏高');
  assert.equal(c.sig.nd, 0, '該區沒有不良焊墊');
  assert.equal(c.lv, 'warn');
});

test('板×群組：同樣大幅偏移，但該區有 1 個超規焊墊 → 嚴重', () => {
  const F = sb(detect(rows((b, g, p) => (b === 'B05' && g === 'C1' ? (p === 1 ? 33 : 25) : 0))));
  const c = F.find((x) => x.sig.t === 'local' && x.sig.b === 'B05' && x.sig.g === 'C1');
  assert.ok(c, '應偵測到 B05 的 C1 偏高');
  assert.equal(c.sig.nd, 1, '該區 1 個焊墊超出 USL 130');
  assert.equal(c.lv, 'ng');
});

test('整板：所有群組同向偏移但都在規格內 → 整板卡只判警示', () => {
  const F = sb(detect(rows((b) => (b === 'B05' ? 15 : 0))));
  const c = F.find((x) => x.sig.t === 'board' && x.sig.b === 'B05');
  assert.ok(c, '應偵測到 B05 整片板偏移');
  assert.equal(c.sig.nd, 0, '本板沒有不良焊墊');
  assert.equal(c.lv, 'warn');
});

test('整板：同向偏移且本板有超規焊墊 → 嚴重', () => {
  const F = sb(detect(rows((b, g, p) => (b === 'B05' ? (g === 'C1' && p === 1 ? 33 : 15) : 0))));
  const c = F.find((x) => x.sig.t === 'board' && x.sig.b === 'B05');
  assert.ok(c, '應偵測到 B05 整片板偏移');
  assert.ok(c.sig.nd >= 1, '本板有不良焊墊');
  assert.equal(c.lv, 'ng');
});

test('範例資料：單板異常卡的嚴重度不受影響（範例的嚴重卡都有不良焊墊）', () => {
  const F = sb(core.detectIssues(baseState(core, { rows: core.sampleData(), metrics: ['volume', 'height', 'area', 'offx', 'offy'], metric: 'volume', group: 'ALL' })));
  // v10.3.5 校準門檻：25 板時 |z| 門檻 5.03（原固定 3.5）。B13 U2 體積 z = −3.63 不再單獨成立，面積 z = −13.3 仍判嚴重
  assert.deepEqual(JSON.parse(JSON.stringify(F.map((x) => [x.title, x.lv]))), [['B13 的 U2 BGA：面積偏低', 'ng']]);
});

// v10.3.5：嚴重度只看「偏移的量測項目」的超規焊墊；同板或同區其他量測項目的不良與這次偏移無關
function rows2(tweak) {
  let s = 777;
  const noise = () => { s = (s * 1103515245 + 12345) % 2147483648; return (s / 2147483648 - 0.5) * 2; };
  const out = [];
  for (let b = 1; b <= 10; b++) {
    const board = 'B' + String(b).padStart(2, '0');
    for (const g of GROUPS) for (let p = 1; p <= 4; p++) {
      const t = tweak(board, g, p);
      out.push({ board, comp: g, pad: `${g}-${p}`, group: g, volume: 100 + noise() + (t.volume || 0), height: t.height ?? 120 + noise() });
    }
  }
  return out;
}
const detect2 = (rs) => core.detectIssues(baseState(core, { rows: rs, metrics: ['volume', 'height'], metric: 'volume', group: 'ALL' }));

test('整板：體積在規格內偏移，另一群組有 1 個高度超規焊墊 → 整板卡仍只判警示', () => {
  const F = sb(detect2(rows2((b, g, p) => (b === 'B05' ? { volume: 15, height: g === 'C3' && p === 1 ? 151 : undefined } : {}))));
  const c = F.find((x) => x.sig.t === 'board' && x.sig.b === 'B05');
  assert.ok(c, '應偵測到 B05 整片板體積偏移');
  assert.equal(c.sig.nd, 1, '本板有 1 個不良焊墊（高度）');
  assert.equal(c.sig.noos, 0, '體積沒有超規焊墊');
  assert.equal(c.lv, 'warn');
});

test('板×群組：體積在規格內大幅偏移，同區 1 個高度超規焊墊 → 只判警示', () => {
  const F = sb(detect2(rows2((b, g, p) => (b === 'B05' && g === 'C1' ? { volume: 15, height: p === 2 ? 151 : undefined } : {}))));
  const c = F.find((x) => x.sig.t === 'local' && x.sig.b === 'B05' && x.sig.g === 'C1');
  assert.ok(c, '應偵測到 B05 的 C1 體積偏高');
  assert.deepEqual(JSON.parse(JSON.stringify(c.sig.ks)), ['volume'], '高度只有 1 顆超規，不構成單板異常');
  assert.equal(c.sig.nd, 1);
  assert.equal(c.sig.noos, 0);
  assert.equal(c.lv, 'warn');
});
