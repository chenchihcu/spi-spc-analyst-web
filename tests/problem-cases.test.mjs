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

test('問題定義：漂移與 Nelson 5/6 同項目併案', () => {
  const st = baseState(core, {
    rows: core.sampleData(),
    metrics: ['volume', 'height', 'hpct', 'area', 'offx', 'offy'],
    metric: 'volume',
    group: 'ALL',
    chart: 'xbars'
  });
  const F = core.detectIssues(st);
  const drift = F.find(x => x.sig && x.sig.t === 'drift' && x.sig.k === 'volume');
  const nel5 = F.find(x => x.sig && x.sig.t === 'nelson' && x.sig.k === 'volume' && x.sig.ruleId === 5);
  assert.ok(drift && nel5, '範例應有體積漂移與 Nelson 規則 5');
  assert.equal(drift.case_id, nel5.case_id, '同項目漂移與 Nelson 5 應同案');
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
