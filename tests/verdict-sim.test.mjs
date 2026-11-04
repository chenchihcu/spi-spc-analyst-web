import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { generateStableData, makeNormal, mulberry32, rowsToCsv } from '../tools/gen-stable.mjs';

const require = createRequire(import.meta.url);
const { loadCore, baseState } = require('./_load.js');

const core = loadCore();

// X̄ 誤報模擬使用列級 i.i.d. 常態值；generateStableData 含有同板共變的隨機效應，
// 適合舊的整體判定基準，但不符合 Phase I t(df) 參考的獨立樣本假設。
function generateIidStableData({ nb = 25, shift = 0, seed = 1 } = {}) {
  const normal = makeNormal(mulberry32((seed ^ 0x51A7E) >>> 0));
  return generateStableData({ nb, shift, stroke: true, seed }).map((r) => {
    const b = Number(r.board.slice(1));
    const shiftB = b > nb - 8 ? shift : 0;
    r.height = +(120 + 3.5 * normal()).toFixed(1);
    r.area = +(100 + shiftB + 4 * normal()).toFixed(1);
    r.volume = +(r.height / 120 * r.area * (1 + 0.025 * normal())).toFixed(1);
    r.offx = +(10 * normal()).toFixed(1);
    r.offy = +(10 * normal()).toFixed(1);
    return r;
  });
}

const CMP_FIELDS = ['board', 'pad', 'comp', 'group', 'x', 'y', 'w', 'd', 'stroke', 'height', 'area', 'volume', 'offx', 'offy'];

test('6.1 stable-25.csv 驗證：seed 1 CSV 往返一致；含同板效應的舊資料依新 X̄ 界限發出警示', () => {
  const csvPath = path.join(import.meta.dirname, 'fixtures', 'stable-25.csv');
  assert.ok(fs.existsSync(csvPath), 'stable-25.csv 應存在');
  const txt = fs.readFileSync(csvPath, 'utf8');
  const parsed = core.parseCSV(txt);
  const direct = generateStableData({ nb: 25, shift: 0, stroke: true, seed: 1 });
  assert.equal(parsed.rows.length, direct.length, '25 板 × 116 焊墊 = 2900 列');

  for (let i = 0; i < direct.length; i++) {
    for (const f of CMP_FIELDS) {
      assert.ok(parsed.rows[i][f] === direct[i][f], `row ${i} field ${f} 應完全一致（容差 0）: ${parsed.rows[i][f]} vs ${direct[i][f]}`);
    }
  }

  const st = baseState(core, {
    rows: parsed.rows,
    metrics: ['volume', 'hpct', 'area', 'offx', 'offy'],
    metric: 'volume',
    group: 'ALL',
    chart: 'xbars'
  });
  const iss = core.detectIssues(st);
  const vd = iss.meta.verdict;

  assert.equal(vd.level, 'warn', '同板共變造成的板平均變異應反映為警示');
  assert.equal(vd.label, '警示', '整體判定標籤應為警示');
  assert.ok(iss.some(x => x.cat === '管制圖規則' && (x.level === '警示' || x.lv === 'warn')), '警示應由新 X̄ 界限觸發的 Nelson 規則說明');
});

test('6.1 verdict-sim-expected.json 期望檔與附錄 C 稽核參考判定比對（一致率 ≥85%）', () => {
  const expPath = path.join(import.meta.dirname, 'fixtures', 'verdict-sim-expected.json');
  assert.ok(fs.existsSync(expPath), 'verdict-sim-expected.json 應存在');
  const expected = JSON.parse(fs.readFileSync(expPath, 'utf8'));
  const runs = expected.runs || expected;

  const configs = [
    { key: '25_shift0', data: runs['nb25_s0'] || runs['25_shift0'], refFile: 'perseed_25_1_200_0.txt', minOk: 0.77, maxOk: 1.0 },
    { key: '50_shift0', data: runs['nb50_s0'] || runs['50_shift0'], refFile: 'perseed_50_1_200_0.txt', minOk: 0.78, maxOk: 1.0 },
    { key: '25_shift3', data: runs['nb25_s3'] || runs['25_shift3'], refFile: 'perseed_25_1_200_3.txt', minOk: 0.0, maxOk: 0.05 },
    { key: '50_shift3', data: runs['nb50_s3'] || runs['50_shift3'], refFile: 'perseed_50_1_200_3.txt', minOk: 0.0, maxOk: 0.05 }
  ];

  for (const cfg of configs) {
    assert.ok(cfg.data, `應包含 ${cfg.key} 設定`);
    const seeds = Array.isArray(cfg.data) ? cfg.data : cfg.data.seeds;
    assert.equal(seeds.length, 200, `${cfg.key} 應有 200 個 seed`);
    const okCount = seeds.filter(x => x.level === 'ok').length;
    const okRate = okCount / 200;
    assert.ok(okRate >= cfg.minOk && okRate <= cfg.maxOk, `${cfg.key} 正常率 ${okRate} 應在 [${cfg.minOk}, ${cfg.maxOk}]`);

    const refPath = path.join(import.meta.dirname, 'fixtures', 'audit', 'r6merge', cfg.refFile);
    if (fs.existsSync(refPath)) {
      const refChars = [...fs.readFileSync(refPath, 'utf8').trim()];
      assert.equal(refChars.length, 200);
      let agree = 0;
      for (let i = 0; i < 200; i++) {
        const refOk = refChars[i] === '正';
        const ourOk = seeds[i].level === 'ok';
        if (refOk === ourOk) agree++;
      }
      assert.ok(agree / 200 >= 0.85, `${cfg.key} 與附錄 C 正常／非正常一致率 ${agree / 200} 應 >= 85%`);
    }
  }
});

test('M-18 回歸：25 板 seed 3 不出現多變量離群卡（X̄ 規則另列同板效應警示）', () => {
  const rows = generateStableData({ nb: 25, shift: 0, stroke: true, seed: 3 });
  const st = baseState(core, { rows, metrics: ['volume', 'hpct', 'area', 'offx', 'offy'], metric: 'volume', group: 'ALL', chart: 'xbars' });
  const iss = core.detectIssues(st);
  assert.equal(iss.filter(x => x.cat === '多變量離群').length, 0);
  assert.ok(iss.some(x => x.cat === '管制圖規則' && (x.level === '警示' || x.lv === 'warn')));
});

test('空間群聚回歸：穩定製程不出現空間群聚卡（Moran 標準誤校正前 25 板 seed 23/72/76/182、50 板 seed 141 的 Z 為 2.66–4.08 誤報）', () => {
  for (const [nb, seed] of [[25, 23], [25, 72], [25, 76], [25, 182], [50, 141]]) {
    const rows = generateStableData({ nb, shift: 0, stroke: true, seed });
    const st = baseState(core, { rows, metrics: ['volume', 'hpct', 'area', 'offx', 'offy'], metric: 'volume', group: 'ALL', chart: 'xbars' });
    const iss = core.detectIssues(st);
    assert.equal(iss.filter(x => x.cat === '空間群聚').length, 0, `${nb} 板 seed ${seed} 不應出現空間群聚卡`);
    assert.ok(iss.some(x => x.cat === '管制圖規則'), `${nb} 板 seed ${seed} 的新 X̄ 界限卡應獨立於空間群聚判讀`);
  }
});

const isSlow = process.env.RUN_SLOW === '1';

test('[slow] 6.1 整體判定模擬：seed 1–200 蒙地卡羅驗收（25/50 板、SHIFT 0/3）', () => {
  const expPath = path.join(import.meta.dirname, 'fixtures', 'verdict-sim-expected.json');
  const expected = JSON.parse(fs.readFileSync(expPath, 'utf8'));
  const runs = expected.iidRuns || expected.runs || expected;
  const maxSeed = isSlow ? 200 : 2;

  const configs = [
    { nb: 25, shift: 0, key: '25_shift0', expKey: 'nb25_s0', minOkRate: 0.77, maxOkRate: 1.0 },
    { nb: 50, shift: 0, key: '50_shift0', expKey: 'nb50_s0', minOkRate: 0.78, maxOkRate: 1.0 },
    { nb: 25, shift: 3, key: '25_shift3', expKey: 'nb25_s3', minOkRate: 0.0, maxOkRate: 0.05 },
    { nb: 50, shift: 3, key: '50_shift3', expKey: 'nb50_s3', minOkRate: 0.0, maxOkRate: 0.05 }
  ];

  for (const cfg of configs) {
    let okCount = 0;
    const rawExp = runs[cfg.expKey] || runs[cfg.key];
    const expSeeds = Array.isArray(rawExp) ? rawExp : rawExp.seeds;
    for (let s = 1; s <= maxSeed; s++) {
      const directRows = generateIidStableData({ nb: cfg.nb, shift: cfg.shift, seed: s });
      const rows = s === 1 ? core.parseCSV(rowsToCsv(directRows)).rows : directRows;
      const st = baseState(core, {
        rows,
        metrics: ['volume', 'hpct', 'area', 'offx', 'offy'],
        metric: 'volume',
        group: 'ALL',
        chart: 'xbars'
      });
      const iss = core.detectIssues(st);
      const vd = iss.meta.verdict;
      if (vd.level === 'ok') okCount++;

      const expSeed = expSeeds[s - 1];
      assert.equal(vd.level, expSeed.level, `seed ${s} 在 ${cfg.key} 的判定等級應與期望檔完全一致`);
      const cats = [...new Set(iss.map(x => x.cat))].sort();
      assert.deepEqual(cats, expSeed.cats, `seed ${s} 在 ${cfg.key} 的卡片類別應與期望檔完全一致`);
    }

    if (isSlow) {
      const rate = okCount / 200;
      assert.ok(rate >= cfg.minOkRate, `${cfg.key} 正常率 ${rate} 應 >= ${cfg.minOkRate}`);
      assert.ok(rate <= cfg.maxOkRate, `${cfg.key} 正常率 ${rate} 應 <= ${cfg.maxOkRate}`);
    }
  }
});

test('[slow] M-19 單板異常：穩定製程 10／25 板、實際群組大小下，每次檢定誤報不超過名目 2(1−Φ(3.5))', () => {
  const A1 = 2 * (1 - 0.99976737), maxSeed = isSlow ? 40 : 2;
  for (const nb of [10, 25]) {
    let T = 0, H = 0;
    for (let s = 1; s <= maxSeed; s++) {
      const iss = core.detectIssues(baseState(core, { rows: generateStableData({ nb, seed: s }), metrics: ['volume', 'hpct', 'area', 'offx', 'offy'], metric: 'volume', group: 'ALL' }));
      T += iss.meta.tests; H += iss.meta.hits;
    }
    const exp = T * A1;
    assert.ok(H <= Math.ceil(exp + 3 * Math.sqrt(exp)), `${nb} 板 ${maxSeed} 個 seed：命中 ${H} / ${T} 次檢定（名目上限約 ${exp.toFixed(1)}）`);
  }
});

test('[slow] LISA 局部標示：全虛無資料在實際群組大小 30／60／100 焊墊下，每焊墊標示率為名目 5%（雙尾、未校正）', () => {
  // 方案 B：地圖只標位置、不做多重比較校正，個別焊墊的誤標率必須是名目 α；v10.4.0 單尾未乘 2 時約為 2 倍
  const c = loadCore(), T = isSlow ? 1000 : 60, alpha = 0.05;
  let a = 20261028;
  const rnd = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const nrm = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  for (const n of [30, 60, 100]) {
    let sig = 0, tot = 0;
    for (let t = 0; t < T; t++) {
      const sa = c.calcMoranAndLISA(Array.from({ length: n }, (_, i) => ({ pad: 'p' + i, x: rnd() * 100, y: rnd() * 60, val: nrm() })), 6);
      sig += sa.lisa.filter((x) => x.isSig).length; tot += sa.n;
    }
    // 同一資料集內各焊墊相關，標準誤放寬 3 倍
    const lim = alpha + 9 * Math.sqrt(alpha * (1 - alpha) / tot);
    assert.ok(sig / tot <= lim, `${n} 焊墊：每焊墊標示率 ${(sig / tot * 100).toFixed(2)}%（上限 ${(lim * 100).toFixed(2)}%）`);
  }
});
