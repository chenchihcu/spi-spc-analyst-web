import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { partSpecCheck, partSpecCanon } from '../lib/part-spec-core.mjs';

const html = readFileSync(new URL('../spi-spc.html', import.meta.url), 'utf8');
const section = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const digest = b => createHash('sha256').update(b).digest('hex');
const snapshot = { schema: 'spi-part-spec/1', part: 'SYNTHETIC', stencilRef: 100, note: '', groups: {},
  specs: Object.fromEntries(['volume', 'hpct', 'area', 'offx', 'offy'].map(k => [k, { lsl: 70, tgt: 100, usl: 130 }])) };

test('雲端 metadata 已存厚度可讀回，不借用規格的參考厚度', () => {
  const context = vm.createContext({});
  vm.runInContext(section('function recordView(', 'var RecDB='), context);
  assert.equal(context.recordView({ meta: JSON.stringify({ stencil: 88 }) }).stencil, 88);
  assert.equal(context.recordView({ stencil: 120, meta: { stencil: 88 } }).stencil, 120);
  assert.equal(context.recordView({ meta: {} }).stencil, 0);
});

test('歷史快照獨立於目前預設；缺失與未指定不查詢預設，損壞快照拒絕', async () => {
  const context = vm.createContext({ partSpecCanon, sha256Hex: async b => digest(b), partSpecEncode: value => {
    const checked = partSpecCheck(value);
    return checked.error ? checked : { spec: checked.spec, bytes: Buffer.from(partSpecCanon(checked.spec)) };
  } });
  vm.runInContext(section('async function savedSpecForRecord(', 'async function savePartSpec('), context);
  const ctx = { state: 'captured', id: 'A'.repeat(22), ver: 1, sha256: digest(partSpecCanon(snapshot)), snapshot };
  const result = await context.savedSpecForRecord({ part: 'SYNTHETIC', meta: { specContext: ctx } });
  assert.equal(result.ps.rec.ver, 1);
  assert.equal(result.ps.source, 'historical');
  assert.equal((await context.savedSpecForRecord({ part: 'SYNTHETIC' })).state, 'historical_missing');
  assert.equal((await context.savedSpecForRecord({ meta: { specContext: { state: 'unassigned' } } })).ps, null);
  await assert.rejects(context.savedSpecForRecord({ part: 'OTHER', specContext: ctx }), /不可驗證/);
  await assert.rejects(context.savedSpecForRecord({ part: 'SYNTHETIC', specContext: { ...ctx, sha256: '0'.repeat(64) } }), /指紋不符/);
});

test('歷史量測缺少厚度時不從目前預設預填；舊匯入的非同步回覆不污染新匯入', async () => {
  const field = { value: '' };
  let calls = 0, release;
  const context = vm.createContext({ IMP: { rec: { id: 'historical' } }, THK_SEQ: 0,
    $: id => id === '#inPart' ? { value: 'SYNTHETIC' } : field, safeId: x => x,
    RecDB: { specsFor: async () => { calls++; return new Promise(resolve => { release = resolve; }); } },
    loadSpecRec: async () => ({ stencilRef: 120 }), thkOk: n => n >= 30 && n <= 300, reconvertThk() {} });
  vm.runInContext(section('async function prefillImpThk(', 'function reconvertThk('), context);
  await context.prefillImpThk();
  assert.equal(calls, 0);
  assert.equal(field.value, '');
  context.IMP = {};
  const pending = context.prefillImpThk();
  context.IMP = { rec: { id: 'new-history' } };
  release([{ isDefault: true }]);
  await pending;
  assert.equal(field.value, '');
});
