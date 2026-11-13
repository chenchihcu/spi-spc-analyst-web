import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadCore, baseState } = require('./_load.js');
const core = loadCore();

test('問題定義：每張卡有 case_id，與 meta.cases 一致', () => {
  const st = baseState(core, { rows: core.sampleData() });
  const F = core.detectIssues(st);
  assert.ok(F.meta && F.meta.cases && F.meta.cases.length, '應有問題定義案');
  for (const x of F) {
    assert.ok(x.case_id != null && x.case_title, `卡片 #${x.id} 應有 case_id／case_title`);
    const c = F.meta.cases.find(z => z.id === x.case_id);
    assert.ok(c, `卡片 #${x.id} 的 case_id 應存在於 meta.cases`);
    assert.ok(c.card_ids.includes(x.id), `案 ${c.id} 應含卡片 #${x.id}`);
  }
});

test('問題定義：同群組 sys 與 pad 併為一案', () => {
  const st = baseState(core, { rows: core.sampleData() });
  const F = core.detectIssues(st);
  for (const s of F.filter(x => x.sig && x.sig.t === 'sys')) {
    const pads = F.filter(x => x.sig && x.sig.t === 'pad' && x.sig.g === s.sig.g);
    if (!pads.length) continue;
    assert.equal(s.case_id, pads[0].case_id, `${s.sig.g} 系統性卡與焊墊位置卡應同案`);
    break;
  }
});

test('問題定義：同向錫量漂移併成一案，且每張卡只屬於一案', () => {
  const st = baseState(core, {
    rows: core.sampleData(),
    metrics: ['volume', 'height', 'hpct', 'area', 'offx', 'offy'],
    metric: 'volume',
    group: 'ALL',
    chart: 'xbars'
  });
  const F = core.detectIssues(st);
  const vol = F.find(x => x.sig && x.sig.t === 'drift' && x.sig.k === 'volume');
  const hp = F.find(x => x.sig && x.sig.t === 'drift' && x.sig.k === 'hpct');
  const nel5 = F.find(x => x.sig && x.sig.t === 'nelson' && x.sig.k === 'volume' && x.sig.ruleId === 5);
  assert.ok(vol && hp && nel5, '範例應有體積、高度漂移與 Nelson 規則 5');
  assert.equal(vol.case_id, hp.case_id, '同向體積與高度漂移應同案');
  assert.equal(vol.case_id, nel5.case_id, '同案應含該項目的 Nelson 規則 5');
  const owner = new Map();
  for (const c of F.meta.cases) for (const id of c.card_ids) {
    assert.equal(owner.has(id), false, `卡片 #${id} 不得同時屬於案 ${owner.get(id)} 與案 ${c.id}`);
    owner.set(id, c.id);
    assert.equal(F.find(x => x.id === id).case_id, c.id);
  }
  assert.equal(owner.size, F.length, '每張卡都應屬於恰好一案');
});

test('問題定義：卡片 id 與 title 順序不因分組改變', () => {
  const st = baseState(core, { rows: core.sampleData() });
  const F1 = core.detectIssues(structuredClone(st));
  const titles1 = F1.map(x => x.title);
  const ids1 = F1.map(x => x.id);
  const F2 = core.detectIssues(st);
  assert.deepEqual(F2.map(x => x.title), titles1);
  assert.deepEqual(F2.map(x => x.id), ids1);
});

test('問題定義：CSV 末欄含 case_id／case_title', () => {
  const st = baseState(core, { rows: core.sampleData() });
  const F = core.detectIssues(st);
  const csv = core.issuesCsv(F);
  const header = csv.split(/\r?\n/)[0].split(',');
  assert.deepEqual(header.slice(-2), ['case_id', 'case_title']);
  const row = csv.split(/\r?\n/)[1].split(',');
  assert.equal(row[row.length - 2], String(F[0].case_id));
});

test('問題定義：依案計數與依卡計數各自加總一致，案的嚴重度篩選不漏卡', () => {
  const st = baseState(core, { rows: core.sampleData() });
  const F = core.detectIssues(st);
  const { cards, cases } = core.issueCaseCounts(F);
  const sum = o => o.ng + o.warn + o.info;
  assert.equal(sum(cards), F.length, '卡片嚴重度加總應等於統計發現數');
  assert.equal(sum(cases), F.meta.cases.length, '案嚴重度加總應等於問題定義數');
  for (const lv of ['ng', 'warn', 'info']) {
    const sel = F.meta.cases.filter(c => c.lv === lv);
    assert.equal(sel.length, cases[lv], `${lv} 案數應等於篩選後顯示的案數`);
    for (const c of sel) {
      const lvs = c.card_ids.map(id => F.find(x => x.id === id).lv);
      const rank = { ng: 0, warn: 1, info: 2 };
      assert.equal(Math.min(...lvs.map(v => rank[v])), rank[lv], `案 ${c.id} 的嚴重度應等於成員最高嚴重度`);
    }
  }
});
