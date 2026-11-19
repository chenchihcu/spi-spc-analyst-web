// 整板一致偏移：大群組各自達門檻、小群組雜訊大單獨未達門檻，但幾乎所有焊墊同向偏移時，
// 應判為一張「整片板偏移」卡，而不是拆成多張「板 × 元件群組」卡。
// 出處：2026-11-19 料號 301-000100120 TOP 50 板回合，B03 面積 58 群組 57 個同向偏低，只有 15 個單獨達門檻，被拆成 15 張卡。
// 測試資料為自行組出的合成資料（不含使用者原始檔）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadCore, baseState } = require('./_load.js');
const core = loadCore();

const BIG = ['G1', 'G2', 'G3', 'G4'];
const SMALL = Array.from({ length: 26 }, (_, i) => `S${i + 1}`);
function rows(shift) {
  let s = 20261119;
  const u = () => { s = (s * 1103515245 + 12345) % 2147483648; return (s + 0.5) / 2147483648; };
  const gauss = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  const out = [];
  for (let b = 1; b <= 20; b++) {
    const board = 'B' + String(b).padStart(2, '0');
    for (const g of BIG) for (let p = 1; p <= 40; p++) out.push({ board, comp: `${g}R${p}`, pad: `${g}R${p}-1`, group: g, volume: 100 + 3 * gauss() + shift(board, g) });
    for (const g of SMALL) for (let p = 1; p <= 2; p++) out.push({ board, comp: `${g}R1`, pad: `${g}R1-${p}`, group: g, volume: 100 + 6 * gauss() + shift(board, g) });
  }
  return out;
}
const detect = (rs) => core.detectIssues(baseState(core, { rows: rs, metrics: ['volume'], metric: 'volume', group: 'ALL' }));
const onB03 = (F) => F.filter((x) => x.cat === '單板異常' && x.sig.b === 'B03');

test('整板同向偏移、只有少數大群組單獨達門檻 → 一張整板卡，不拆成多張板×群組卡', () => {
  const F = onB03(detect(rows((b) => (b === 'B03' ? -8 : 0))));
  const board = F.filter((x) => x.sig.t === 'board');
  assert.equal(board.length, 1, `應有 1 張 B03 整板卡，實際：${F.map((x) => x.title).join('、')}`);
  assert.deepEqual(Array.from(board[0].sig.ks), ['volume']);
  assert.ok(board[0].sig.d.volume < 0, '方向為偏低');
  assert.equal(F.filter((x) => x.sig.t === 'local').length, 0, 'B03 體積不應再另出板×群組卡');
});

test('只有部分群組偏移、其餘不動（同向焊墊 < 80%）→ 仍為板×群組卡，不升為整板', () => {
  const F = onB03(detect(rows((b, g) => (b === 'B03' && (g === 'G1' || g === 'G2') ? -8 : 0))));
  assert.equal(F.filter((x) => x.sig.t === 'board').length, 0, `不應有整板卡，實際：${F.map((x) => x.title).join('、')}`);
  assert.ok(F.some((x) => x.sig.t === 'local' && x.sig.g === 'G1'), '偏移的群組仍應各自成卡');
});

// 出處：2026-11-19 debug-loop 巡檢。整板卡的 group 欄直接 join 全部群組，違反 AGENTS.md 字串膨脹守則。
test('整板卡的群組清單經 topList 截斷（超過 10 個群組顯示「另 N 個」）', () => {
  let s = 7;
  const u = () => { s = (s * 1103515245 + 12345) % 2147483648; return (s + 0.5) / 2147483648; };
  const gauss = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  const GS = Array.from({ length: 30 }, (_, i) => `K${String(i + 1).padStart(2, '0')}`), out = [];
  for (let b = 1; b <= 20; b++) {
    const board = 'B' + String(b).padStart(2, '0');
    for (const g of GS) for (let p = 1; p <= 30; p++) out.push({ board, comp: `${g}R${p}`, pad: `${g}R${p}-1`, group: g, volume: 100 + 2 * gauss() + (board === 'B03' ? -10 : 0) });
  }
  const card = onB03(detect(out)).find((x) => x.sig.t === 'board');
  assert.ok(card, '應有 B03 整板卡');
  const n = card.group.split('; ').length;
  assert.ok(/另 \d+ 個$/.test(card.group), `超過 10 個群組應截斷，實際 ${card.group}`);
  assert.equal(n, 11, `應列 10 個群組加「另 N 個」，實際 ${n} 段`);
});
