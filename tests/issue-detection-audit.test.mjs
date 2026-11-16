import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadCore, baseState } = require('./_load.js');

const core = loadCore();

function makeBoardPadRows({
  boards = 20,
  groups = [{ g: 'G1', nPads: 20 }],
  fn
}) {
  const rows = [];
  for (let bi = 0; bi < boards; bi++) {
    const b = `B${String(bi + 1).padStart(2, '0')}`;
    for (const { g, nPads } of groups) {
      for (let pi = 0; pi < nPads; pi++) {
        const pad = `${g.replace(/[^A-Za-z0-9]/g, '')}-${pi + 1}`;
        const comp = pad.split('-')[0];
        const base = {
          board: b, pad, comp, group: g, figure: null,
          volume: 100, height: 100, area: 100, offx: 0, offy: 0,
          x: pi * 2, y: 0, gridPos: false, stroke: null
        };
        const ov = fn ? fn({ bi, b, g, pi, pad, base }) : null;
        rows.push(ov ? { ...base, ...ov } : base);
      }
    }
  }
  return rows;
}

test('AUDIT-1: filterFalseNelsonR2 消除極端離群板或尾段漂移引發的假性 Nelson 規則 2（含 sampleData）', () => {
  // 1a. sampleData 原本在 offx / hpct 因中心線偏移誤報 Nelson 規則 2，修正後不應再出現
  const samp = core.sampleData();
  const stS = baseState(core, {
    rows: samp,
    metrics: ['volume', 'height', 'hpct', 'area', 'offx', 'offy'],
    metric: 'offx',
    group: 'ALL',
    chart: 'xbars'
  });
  const fSamp = core.detectIssues(stS);
  const r2Samp = fSamp.filter(x => x.sig?.t === 'nelson' && x.sig.ruleId === 2 && (x.sig.k === 'offx' || x.sig.k === 'hpct'));
  assert.equal(r2Samp.length, 0, 'sampleData 的 offx/hpct 不應再誤報 Nelson 規則 2');

  // 1b. 合成極端離群板 B09 (+60 µm) 拉偏 grandMean，其餘板圍繞 0 µm 波動
  const rows = makeBoardPadRows({
    boards: 20,
    groups: [{ g: 'QFP', nPads: 30 }],
    fn: ({ bi, pi }) => {
      const noise = ((bi * 7 + pi * 13) % 5 - 2) * 0.6;
      const bWave = (bi % 2 === 0 ? 0.5 : -0.5);
      const val = bi === 8 ? 60 + noise : bWave + noise;
      return { volume: 100 + (pi % 3) - 1, height: 100, area: 100, offx: val, offy: ((bi + pi) % 3 - 1) * 0.4 };
    }
  });
  const st = baseState(core, { rows, metrics: ['volume', 'height', 'hpct', 'area', 'offx', 'offy'], metric: 'offx', group: 'ALL' });
  const A = core.analyze(st);
  const nelR2Chart = A.nelX.rules.find(r => r.id === 2);
  assert.equal(nelR2Chart.idx.length, 0, 'analyze().nelX 應與問題偵測同步過濾極端離群引起的假性規則 2');
  const F = core.detectIssues(st);
  const r2Card = F.find(x => x.sig?.t === 'nelson' && x.sig.ruleId === 2 && x.sig.k === 'offx');
  assert.equal(r2Card, undefined, '極端單板離群拉偏 mu 時不應發出 offx Nelson 規則 2 卡');

  // 1c. 尾段 CUSUM 漂移拉偏 mu 時，前段正常基準板不應誤觸發規則 2
  const rowsDrift = makeBoardPadRows({
    boards: 22,
    groups: [{ g: 'QFP', nPads: 25 }],
    fn: ({ bi, pi }) => {
      const noise = ((bi * 11 + pi * 3) % 5 - 2) * 0.4;
      const bAlt = (bi % 2 === 0 ? 0.5 : -0.5);
      const baseV = bi >= 17 ? 112 : 95 + bAlt;
      return { volume: baseV + noise, height: 100, area: 100 };
    }
  });
  const stD = baseState(core, { rows: rowsDrift, metrics: ['volume', 'height', 'hpct', 'area'], metric: 'volume', group: 'ALL' });
  const fD = core.detectIssues(stD);
  const r2D = fD.find(x => x.sig?.t === 'nelson' && x.sig.ruleId === 2 && x.sig.k === 'volume');
  assert.equal(r2D, undefined, '尾段漂移拉偏 CL 時，前段圍繞自身基準波動的板不應觸發 Nelson 規則 2');
});

test('AUDIT-2: 單板異常複核顯著刮刀行程差（過濾奇偶混淆，保留同行程真突發）', () => {
  // 20 板，奇偶行程差 +9%（Welch p < 0.01），奇數板內部有穩定漸變使混合 MAD 偏窄，但 B09 在奇數板內 zSame ≈ 1.1
  const oddArea = [120, 121, 122, 124, 125.2, 123.5, 121.5, 120.5, 122.5, 123];
  const evenArea = [115, 114.8, 115.2, 114.9, 115.1, 115, 114.7, 115.3, 115, 114.8];
  const rows = makeBoardPadRows({
    boards: 20,
    groups: [{ g: 'SBC', nPads: 30 }, { g: 'PASS', nPads: 30 }],
    fn: ({ bi, g, pi }) => {
      const n = ((pi % 5) - 2) * 0.4;
      if (g === 'SBC') {
        const half = Math.floor(bi / 2);
        const a = (bi % 2 === 0 ? oddArea[half] : evenArea[half]) + n;
        return { volume: 100 + n, height: 100 + n, area: a };
      }
      return { volume: 100 + n, height: 100 + n, area: 100 + n };
    }
  });
  const st = baseState(core, { rows, metrics: ['volume', 'height', 'hpct', 'area'], stencil: 100 });
  const F = core.detectIssues(st);
  const falseLocal = F.find(x => (x.sig?.t === 'local' || x.sig?.t === 'board') && x.sig.g === 'SBC' && x.sig.b === 'B09');
  assert.equal(falseLocal, undefined, '受刮刀奇偶行程差混淆且同行程 |zSame|<3.5 的單板不應誤報為單板異常');

  // 若 B09 在同一行程內真正突發飆升至 145%（|zSame| >> 3.5），仍須保留單板異常卡
  for (const r of rows) if (r.board === 'B09' && r.group === 'SBC') r.area += 22;
  const F2 = core.detectIssues(baseState(core, { rows, metrics: ['volume', 'height', 'hpct', 'area'], stencil: 100 }));
  const trueLocal = F2.find(x => x.sig?.t === 'local' && x.sig.g === 'SBC' && x.sig.b === 'B09');
  assert.ok(trueLocal, '同行程內真正突發高出同行程基準的異常單板必須保留檢出');
});

test('AUDIT-3: D-30 跨板自身基準複核、跨項目 pad 排除與重複焊墊去重', () => {
  const rows = makeBoardPadRows({
    boards: 20,
    groups: [{ g: 'U1', nPads: 25 }],
    fn: ({ bi, pi }) => {
      const jitter = ((bi * 3 + pi) % 5 - 2) * 0.25;
      // U1-1: 常態偏低但從未超規（每板約 86±1.5），相對於群組 100 可能 |z|>5，但自身 |zSelf|<1.5
      if (pi === 0) return { volume: 86 + ((bi % 3) - 1) * 1.2, height: 100, area: 100 + jitter };
      // U1-2: 長期偏高（每板 122~125.5，跨 ≥2 板超 USL 130? 設 131,132 且 zSelf<2.5）
      if (pi === 1) return { volume: 129 + (bi === 2 ? 2.5 : bi === 7 ? 2.2 : ((bi % 3) - 1) * 1.5), height: 100, area: 100 + jitter };
      // U1-3: 真正的單板突發孤立異常（B10 體積驟降為 55，其他板皆 100±0.5）
      if (pi === 2) return { volume: bi === 9 ? 55 : 100 + jitter, height: 100, area: 100 + jitter };
      // U1-4: volume 長期偏離（觸發 pad 卡），同時 B05 的 area 輕微超規（zSelf = -3.0，未達 5σ），應被跨項目 pad 卡排除
      if (pi === 3) return { volume: 65 + (bi % 3) * 2, height: 100, area: bi === 4 ? 69 : 88 + (bi % 3) * 3 };
      return { volume: 100 + jitter, height: 100 + jitter * 0.5, area: 100 + jitter };
    }
  });
  // 於 B10 再加入一筆同焊墊 U1-3（例如雙子板掃描情景測試去重）
  rows.push({
    board: 'B10', pad: 'U1-3', comp: 'U1', group: 'U1', figure: 2,
    volume: 54, height: 100, area: 100, offx: 0, offy: 0, x: 4, y: 0, gridPos: false, stroke: null
  });
  const st = baseState(core, { rows, metrics: ['volume', 'height', 'hpct', 'area'], stencil: 100 });
  const F = core.detectIssues(st);
  const isoVol = F.find(x => x.sig?.t === 'iso' && x.sig.k === 'volume');
  const isoArea = F.find(x => x.sig?.t === 'iso' && x.sig.k === 'area');
  assert.ok(isoVol, '真正單板突發的 U1-3 應產生體積孤立極端卡');
  assert.ok(!isoVol.sig.pads.includes('U1-1'), '規格內常態穩定焊墊 U1-1（|zSelf|<3）不得誤列 D-30');
  assert.ok(!isoVol.sig.pads.includes('U1-2'), '長期擦邊超規焊墊 U1-2（|zSelf|<2.5）不得誤列 D-30');
  assert.equal(isoVol.pads.split('; ').filter(p => p === 'U1-3').length, 1, 'D-30 卡片 pads 清單應去重');
  assert.equal(isoArea, undefined, '已被 volume pad 卡點名且面積僅 |zSelf|<5 的 U1-4 應被跨項目排除');
});

test('AUDIT-4: M-09 修正子板欄位、區分過高 vs 少錫原因，並將純局部焊墊排於系統群組之前', () => {
  const rows = makeBoardPadRows({
    boards: 10,
    groups: [{ g: 'SYS_HI', nPads: 15 }, { g: 'LOCAL_OK', nPads: 25 }],
    fn: ({ bi, g, pi }) => {
      // SYS_HI 整體體積與高度系統性偏高（會先觸發 sys 卡）
      if (g === 'SYS_HI') return { volume: 136 + (bi % 2), height: 136 + (bi % 2), area: 105 };
      // LOCAL_OK 大多數焊墊正常，唯獨 LOCALOK-5 在 4 片板過高超規（純局部重複異常）
      if (g === 'LOCAL_OK' && pi === 4 && bi < 4) return { volume: 145, height: 145, area: 120 };
      return { volume: 100 + ((pi + bi) % 3 - 1) * 0.5, height: 100, area: 100 };
    }
  });
  const st = baseState(core, { rows, metrics: ['volume', 'height', 'hpct', 'area'], stencil: 100 });
  const F = core.detectIssues(st);
  const rep = F.find(x => x.sig?.t === 'repeated');
  assert.ok(rep, '應產生 M-09 重複犯焊墊卡');
  assert.equal(rep.subboard, '不適用（單板或無子板欄）', '無子板欄時 subboard 不應寫全部子板');
  assert.match(rep.title, /重複出現異常/, '標題保留既有契約片段');
  assert.match(rep.title, /過高／溢錫/, '以超上限為主時標題應指出過高／溢錫');
  assert.match(rep.cause, /非開孔堵塞所致/, '超上限為主時原因不得錯寫為開孔堵塞');
  assert.ok(rep.pads.startsWith('LOCALOK-5'), '純局部重複不良焊墊應優先顯示於系統性群組焊墊之前');
});

test('AUDIT-5: M-18 排除 pad 卡焊墊、優先配對 hpct，且超規離群焊墊不宣稱均在規格內', () => {
  const rows = makeBoardPadRows({
    boards: 12,
    groups: [{ g: 'BGA_M', nPads: 36 }],
    fn: ({ bi, pi }) => {
      // 正常焊墊沿 area ≈ height 對角線分佈（寬度足夠使 |z|<3、穩健 Cpk≥1.0，但兩者高度正相關）
      const diag = ((pi % 9) - 4) * 2.2;
      const bJit = Math.sin(bi * 1.7 + pi * 0.9) * 0.8;
      const orth = Math.cos(bi * 1.3 + pi * 1.1) * 0.35;
      // BGAM-1: volume 長期偏移形成 pad 卡，同時也在 (area, hpct) 反相關偏離，應被 M-18 isoPadSet 排除
      if (pi === 0) return { volume: 58 + bJit, area: 112 + bJit, height: 105 + orth };
      // BGAM-2: 長期在 area 102 與 hpct 123.5% (height ~148.2µm @120µm) 違反對角線共變，且 B01/B02 height=152µm (126.7%) 輕微超上限（|zSelf|<2.5 不入 D-30，2 板 < M-09 3 板門檻，無 pad 卡）
      if (pi === 1) return { volume: 100 + bJit, area: 102 + bJit * 0.3, height: bi < 2 ? 152 : 148.0 + (bi % 2) * 1.4 - 0.7 };
      return { volume: 100 + diag * 0.5 + bJit, area: 100 + diag + bJit, height: (100 + diag + bJit) * 1.2 + orth, offx: bJit * 0.4, offy: orth * 0.4 };
    }
  });
  const st = baseState(core, { rows, metrics: ['volume', 'height', 'hpct', 'area', 'offx', 'offy'], stencil: 120, heightUnit: 'um' });
  const F = core.detectIssues(st);
  const padCard = F.find(x => x.sig?.t === 'pad' && x.sig.pads.includes('BGAM-1'));
  assert.ok(padCard, '前置驗證：BGAM-1 應有 pad 卡');
  const mcdCards = F.filter(x => x.sig?.t === 'mcd' && x.sig.g === 'BGA_M');
  assert.ok(mcdCards.length >= 1, '應檢出 M-18 多變量離群卡');
  assert.ok(mcdCards.some(c => c.sig.pair[1] === 'hpct'), 'heightUnit 已知時 M-18 應優先配對 hpct（%）');
  for (const mc of mcdCards) {
    assert.ok(!mc.sig.pads.includes('BGAM-1'), 'M-18 應排除已被 pad 卡點名的焊墊');
    if (mc.sig.pads.includes('BGAM-2')) {
      assert.doesNotMatch(mc.cause, /焊墊各單項測量值均在規格內/, '含曾超規離群焊墊的 M-18 原因不可誤宣稱各單項均在規格內');
    }
  }
});

test('AUDIT-6 & AUDIT-7: buildProblemCases 案號重編與錯併修復，以及 D-29 規則 4／低轉移同源關係', () => {
  // 構造含：sys(hpct) + sys(volume) + lowte(ar=NaN)、不同項目 opposite sys(hpct high)+pad(volume low)、奇偶行程 stroke + Nelson 4
  const rows = makeBoardPadRows({
    boards: 18,
    groups: [{ g: 'G_DFM', nPads: 30 }, { g: 'G_MIX', nPads: 30 }],
    fn: ({ bi, g, pi }) => {
      const skDelta = bi % 2 === 0 ? 4.0 : -4.0;
      const jit = ((pi * 7 + bi * 3) % 5 - 2) * 0.4;
      const bSpread = ((bi % 5) - 2) * 2.0;
      if (g === 'G_DFM') {
        // volume 與 hpct 皆系統性偏低 (Cpk < 1.0)，volume 嚴格奇偶交替確保 Nelson 4 與 stroke 同時檢出，且無尺寸 w/d => ar=NaN
        return { volume: 74 + skDelta + jit, height: 74 + bSpread + jit, area: 95 + jit };
      }
      // G_MIX: height 系統性偏高 (118 ± 4 -> Cpk < 1.0 觸發 sys)，同時個別焊墊 GMIX-1 的 volume 長期偏低 (65 -> pad 卡)
      if (pi === 0) return { volume: 65 + jit, height: 118 + bSpread + jit, area: 100 + jit };
      return { volume: 100 + skDelta * 0.25 + jit, height: 118 + bSpread + jit, area: 100 + jit };
    }
  });
  const st = baseState(core, { rows, metrics: ['volume', 'height', 'hpct', 'area'], stencil: 100, heightUnit: 'um' });
  const F = core.detectIssues(st);
  const cases = F.meta.cases;

  // 1. 排序後案號嚴格為 1..N
  assert.deepEqual(cases.map(c => c.id), cases.map((_, i) => i + 1), '問題定義案號應於排序後嚴格重編為 1..N');
  for (const x of F) assert.equal(x.case_title, cases.find(c => c.id === x.case_id).title, '卡片與 case 標題須一致');

  // 2. lowte(G_DFM, ar=NaN) 與 sys(volume, G_DFM)：併入同案、互為 same_phenomenon 且不互相 corrob
  const sysVol = F.find(x => x.sig?.t === 'sys' && x.sig.g === 'G_DFM' && x.sig.k === 'volume');
  const sysHpct = F.find(x => x.sig?.t === 'sys' && x.sig.g === 'G_DFM' && x.sig.k === 'hpct');
  const lowte = F.find(x => x.sig?.t === 'lowte' && x.sig.g === 'G_DFM');
  assert.ok(sysVol && sysHpct && lowte, '應檢出 G_DFM sys(volume)、sys(hpct) 與 lowte');
  assert.equal(lowte.case_id, sysVol.case_id, 'lowte（體積轉移效率）應優先與同群組 sys(volume) 併案');
  assert.ok(!lowte.corrob.includes(sysVol.id) && !sysVol.corrob.includes(lowte.id), '同源 volume 資料之 sys(volume) 與 lowte(ar=NaN) 不得互相標為獨立佐證');
  assert.ok(lowte.same_phenomenon.includes(sysVol.id) && sysVol.same_phenomenon.includes(lowte.id), 'sys(volume) 與 lowte(ar=NaN) 應列為同一現象');
  assert.ok(lowte.corrob.includes(sysHpct.id), '跨高度量測維度的 sys(hpct) 仍應與 lowte 互相佐證');

  // 3. G_MIX 跨項目併案標題精確反映高度偏高暨體積偏離
  const sysMixH = F.find(x => x.sig?.t === 'sys' && x.sig.g === 'G_MIX' && x.sig.k === 'hpct');
  const padMixV = F.find(x => x.sig?.t === 'pad' && x.sig.g === 'G_MIX' && x.sig.k === 'volume');
  assert.ok(sysMixH && padMixV);
  assert.equal(sysMixH.case_id, padMixV.case_id, '既有契約：同群組 sys 與 pad 維持同案');
  assert.match(sysMixH.case_title, /體積偏離/, '跨項目併用時案標題須涵蓋個別焊墊偏離項目');

  // 4. stroke 與 Nelson 規則 4 併案並互相標為 same_phenomenon
  const strokeV = F.find(x => x.sig?.t === 'stroke' && x.sig.k === 'volume');
  const nel4V = F.find(x => x.sig?.t === 'nelson' && x.sig.ruleId === 4 && x.sig.k === 'volume');
  assert.ok(strokeV && nel4V, '應同時檢出 volume 刮刀行程卡與 Nelson 規則 4');
  assert.equal(nel4V.case_id, strokeV.case_id, '同指標之 Nelson 規則 4 與 stroke 應併為同一案');
  assert.ok(nel4V.same_phenomenon.includes(strokeV.id) && strokeV.same_phenomenon.includes(nel4V.id), 'stroke 與同指標 Nelson 規則 4 應互為 same_phenomenon');
});
