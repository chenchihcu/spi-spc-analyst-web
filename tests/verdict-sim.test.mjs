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

test('6.1 stable-25.csv 驗證：seed 1 CSV 往返一致；同板共變屬正常板間變異，三向法 X̄ 界限不因此警示', () => {
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

  // v10.22.0 起 X̄ 界限採板平均移動全距（三向法）：generateStableData 的同板隨機效應是穩定的板間變異，
  // 舊的組內標準誤界限把它判為警示；三向法不再因此警示（Nelson 卡最多為資訊等級）
  assert.equal(vd.level, 'ok', '同板共變不應單獨造成警示');
  assert.equal(vd.label, '正常', '整體判定標籤應為正常');
  assert.ok(!iss.some(x => x.cat === '管制圖規則' && (x.lv === 'warn' || x.lv === 'ng')), '三向法 X̄ 界限不應把正常板間變異列為警示或嚴重');
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

test('M-18 回歸：25 板 seed 3 不出現多變量離群卡，同板效應也不觸發 X̄ 警示', () => {
  const rows = generateStableData({ nb: 25, shift: 0, stroke: true, seed: 3 });
  const st = baseState(core, { rows, metrics: ['volume', 'hpct', 'area', 'offx', 'offy'], metric: 'volume', group: 'ALL', chart: 'xbars' });
  const iss = core.detectIssues(st);
  assert.equal(iss.filter(x => x.cat === '多變量離群').length, 0);
  assert.ok(!iss.some(x => x.cat === '管制圖規則' && (x.lv === 'warn' || x.lv === 'ng')), '三向法 X̄ 界限不應把同板效應列為警示');
});

test('空間群聚回歸：穩定製程不出現空間群聚卡（Moran 標準誤校正前 25 板 seed 23/72/76/182、50 板 seed 141 的 Z 為 2.66–4.08 誤報）', () => {
  for (const [nb, seed] of [[25, 23], [25, 72], [25, 76], [25, 182], [50, 141]]) {
    const rows = generateStableData({ nb, shift: 0, stroke: true, seed });
    const st = baseState(core, { rows, metrics: ['volume', 'hpct', 'area', 'offx', 'offy'], metric: 'volume', group: 'ALL', chart: 'xbars' });
    const iss = core.detectIssues(st);
    assert.equal(iss.filter(x => x.cat === '空間群聚').length, 0, `${nb} 板 seed ${seed} 不應出現空間群聚卡`);
    assert.ok(!iss.some(x => x.cat === '管制圖規則' && (x.lv === 'warn' || x.lv === 'ng')), `${nb} 板 seed ${seed} 的 X̄ 三向界限不應把同板效應列為警示`);
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

test('[slow] X̄ 三向界限：穩定製程 10／15／25 板、每板 30–100 焊墊、有無板間變異，每點誤報接近名目', () => {
  // 每板平均 σ = 板平均 MR̄/1.128（三向法）。i.i.d. 列級常態，板間隨機效應 σB ∈ {0, 1, 3}×(σW/√n)；另含各板 n 不等的情形。
  // 規則 1 每點名目 0.27%；規則 1–6、8 合併旗標率與「真 σ 已知」時的同一模擬比較。
  // 舊的 σ̂組內/√nᵢ 界限在 σB = 3·SE 時規則 1 每點約 32%（此處不重跑，見 CHANGELOG v10.22.0）。
  const T = isSlow ? 300 : 4, nominal = 0.0027;
  let a = 20261112;
  const rnd = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const nrm = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const sizes = [[30], [60], [100], [30, 45, 60, 80, 100]];
  for (const m of [10, 15, 25]) {
    let r1 = 0, flag = 0, flagKnown = 0, tot = 0;
    for (const ns of sizes) for (const bf of [0, 1, 3]) for (let t = 0; t < T; t++) {
      const rows = [], trueSe = [], effects = [];
      for (let b = 0; b < m; b++) {
        const n = ns[b % ns.length], sb = bf / Math.sqrt(60), e = sb * nrm();
        effects.push(e); trueSe.push(Math.sqrt(sb * sb + 1 / n));
        for (let i = 0; i < n; i++) rows.push({ board: `B${String(b + 1).padStart(2, '0')}`, pad: `P${i}`, comp: `P${i}`, group: 'G', volume: 100 + e + nrm(), height: 120, area: 100 });
      }
      const A = core.analyze(baseState(core, { rows, metrics: ['volume'], metric: 'volume', group: 'ALL', chart: 'xbars' }));
      assert.equal(A.xs.rejected, false);
      r1 += A.nelX.rules.find((r) => r.id === 1).idx.length; flag += A.nelX.flag.size; tot += m;
      flagKnown += core.nelson(A.xs.pts.map((p, i) => (p.v - 100) / trueSe[i])).flag.size;
    }
    if (!isSlow) continue;
    const rate = r1 / tot, se = Math.sqrt(nominal * (1 - nominal) / tot);
    assert.ok(rate <= 1.5 * nominal + 3 * se && rate >= 0.5 * nominal - 3 * se, `${m} 板：規則 1 每點誤報 ${(rate * 100).toFixed(3)}%（名目 0.27%）`);
    assert.ok(flag <= 1.5 * flagKnown, `${m} 板：規則 1–6、8 合併每點旗標 ${(flag / tot * 100).toFixed(2)}%，真 σ 已知時 ${(flagKnown / tot * 100).toFixed(2)}%`);
    console.log(`# 三向界限 ${m} 板：規則 1 每點 ${(rate * 100).toFixed(3)}%；合併 ${(flag / tot * 100).toFixed(2)}%（真 σ 已知 ${(flagKnown / tot * 100).toFixed(2)}%）`);
  }
});
