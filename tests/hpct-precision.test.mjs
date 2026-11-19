// 高度 % 不得四捨五入到 0.1：否則界限上的焊墊（例如 130.01–130.04%）在不良分類（µm 精確比較）算過高、
// 在能力頁（高度 %）算規格內，兩頁對同一焊墊判定不一致。
// 出處：2026-11-19 料號 301-000100120 TOP 回合（鋼板 80 µm、高度規格 70–130%），20 個焊墊兩頁判定不同。
// 測試資料為自行組出的合成資料。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadCore, baseState } = require('./_load.js');
const core = loadCore();

function state() {
  const rows = [];
  for (let b = 1; b <= 10; b++) for (let p = 1; p <= 4; p++) {
    const board = 'B' + String(b).padStart(2, '0');
    // 80 µm 鋼板：104.02 µm = 130.025%（四捨五入到 0.1 會變成 130.0，落回規格內）
    const height = b === 3 && p === 1 ? 104.02 : 88 + ((b * 7 + p * 3) % 9);
    rows.push({ board, comp: 'U1', pad: `U1-${p}`, group: 'G', volume: 100, area: 100, height });
  }
  const st = baseState(core, { rows, metrics: ['volume', 'height', 'area'], metric: 'hpct', group: 'ALL', stencil: 80, heightUnit: 'um' });
  st.specs.hpct = { lsl: 70, usl: 130, tgt: 100 };
  st.specs.height = { lsl: 56, usl: 104, tgt: 80 };
  return st;
}

test('高度 % 保留完整精度：界限上的焊墊在不良分類與能力頁判定一致', () => {
  const st = state();
  const A = core.analyze(st);
  const edge = st.rows.find((r) => r.board === 'B03' && r.pad === 'U1-1');
  assert.ok(edge.hpct > 130, `hpct 應 > 130，實際 ${edge.hpct}`);
  assert.ok(Math.abs(edge.hpct - 130.025) < 1e-9, `hpct 應為 130.025，實際 ${edge.hpct}`);
  assert.ok(core.specClassify(edge, st.specs, st).includes('HIH'), '不良分類應為高度過高');
  assert.equal(A.cap.ppmObs, 1e6 / 40, '能力頁超規 PPM 應計入這 1 個焊墊（40 個中 1 個）');
});

test('高度 % 界限換算 µm 不四捨五入到 0.1 µm', () => {
  const st = core.partSpecToState({ specs: { volume: { lsl: 70, usl: 130 }, hpct: { lsl: 75, usl: 125, tgt: 100 }, area: { lsl: 70, usl: 130 }, offx: {}, offy: {} }, groups: {} }, 75);
  assert.equal(st.specs.height.lsl, 56.25, '75 µm × 75% = 56.25 µm，不可變成 56.3');
});

test('高度 % 去除浮點誤差：剛好在界限上的值不因浮點雜訊跨過界限', () => {
  for (const [stencil, height, pct] of [[88, 89.76, 102], [80, 48.08, 60.1], [80, 81.6, 102], [80, 104, 130], [80, 56, 70], [120, 122.4, 102], [127, 165.1, 130]]) {
    const rows = [{ board: 'B01', comp: 'U1', pad: 'U1-1', group: 'G', volume: 100, area: 100, height }];
    for (let b = 2; b <= 6; b++) rows.push({ board: 'B0' + b, comp: 'U1', pad: 'U1-1', group: 'G', volume: 100, area: 100, height: stencil });
    const st = baseState(core, { rows, metrics: ['volume', 'height', 'area'], metric: 'hpct', group: 'ALL', stencil, heightUnit: 'um' });
    core.analyze(st);
    assert.equal(st.rows[0].hpct, pct, `${height} µm ÷ ${stencil} µm 應為 ${pct}%`);
  }
});
