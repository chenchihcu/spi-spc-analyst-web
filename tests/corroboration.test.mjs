// 互相佐證只成立於同一（或衍生關係的）量測項目：offx 的整段 Nelson／漂移卡不可替無關的體積單板卡「佐證」
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadCore, baseState } = require('./_load.js');
const core = loadCore();

function rows() {
  let s = 4242;
  const noise = () => { s = (s * 1103515245 + 12345) % 2147483648; return (s / 2147483648 - 0.5) * 2; };
  const out = [];
  for (let b = 1; b <= 20; b++) {
    const board = 'B' + String(b).padStart(2, '0'), bo = noise();
    for (const g of ['C1', 'C2', 'C3', 'C4', 'C5']) for (let p = 1; p <= 4; p++) {
      out.push({ board, comp: g, pad: `${g}-${p}`, group: g,
        volume: 100 + noise() + (board === 'B14' && g === 'C1' ? -15 : 0),
        offx: bo + 0.5 * noise() + (b >= 6 ? 8 : 0) });
    }
  }
  return out;
}

test('B14 體積局部卡不被 offx 整段 Nelson 卡佐證；同項目的 Nelson 卡仍列為同一現象', () => {
  const F = core.detectIssues(baseState(core, { rows: rows(), metrics: ['volume', 'offx'], metric: 'volume', group: 'ALL' }));
  const loc = F.find((x) => x.sig.t === 'local' && x.sig.b === 'B14' && x.sig.g === 'C1');
  assert.ok(loc, '應偵測到 B14 的 C1 體積偏低');
  const offxWide = F.filter((x) => x.sig.t === 'nelson' && x.sig.k === 'offx' && x.sig.boards.includes('B14'));
  assert.ok(offxWide.length, 'offx 應有涵蓋 B14 的 Nelson 卡（否則本測試沒有測到修正的路徑）');
  assert.deepEqual([...loc.corrob], [], '無關項目的卡不可互相佐證');
  const volNel = F.find((x) => x.sig.t === 'nelson' && x.sig.k === 'volume' && x.sig.boards.includes('B14'));
  assert.ok(volNel && loc.same_phenomenon.includes(volNel.id), '同項目、同板的 Nelson 卡列為同一現象');
});
