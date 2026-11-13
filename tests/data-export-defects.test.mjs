import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { loadCore, baseState, HTML, withIdb } = require('./_load.js');
const { JSDOM } = (() => { try { return require('jsdom'); } catch { return {}; } })();
const c = loadCore();

function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const normal = (r) => () => {
  let u = 0; while (!u) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
};

test('issuesMd, fmMd 已匯出於核心模組，可在無 DOM 環境下直接呼叫', () => {
  assert.equal(typeof c.issuesMd, 'function', 'issuesMd 應匯出於 loadCore()');
  assert.equal(typeof c.fmMd, 'function', 'fmMd 應匯出於 loadCore()');

  const F = [
    {
      no: 1, id: 1, level: '嚴重', lv: 'ng', category: '系統性能力', cat: '系統性能力',
      title: '測試問題標題', rule_id: 'R001', rule_name: '能力不足', metric: '體積',
      boards: '全部板', subboard: '—', group: '0402', refdes: 'R1', pads: 'R1-1',
      observed: 'Cpk 0.5', limit: '70–130 %', z: '等效 1.5σ', p: '不適用',
      facts: ['事實 1', '事實 2'], inference: '推論原因', cause: '推論原因',
      confidence: '高', conf: '高', action: '建議動作', corroborated_by: [], corrob: [],
      same_phenomenon: [], explained_pads: [], spec_source: '測試規格'
    }
  ];
  const md = c.issuesMd(F, { source: '單元測試', stencil: 120 });
  assert.match(md, /# SPI 問題偵測清單/);
  assert.match(md, /## #1［嚴重］測試問題標題/);
  assert.match(md, /面向：系統性能力｜規則：R001（能力不足）/);
  assert.match(md, /建議動作：建議動作/);
});

test('buildStatsData 納入 Nelson Rule 1（超出 3σ 點），與 Rule 2、3 齊全', () => {
  const rows = [];
  // 10 boards × 10 pads; small within-board spread keeps σ̂組內 estimable while B09 remains >3σ
  for (let b = 1; b <= 10; b++) {
    const val = b === 9 ? 180 : 100;
    for (let p = 1; p <= 10; p++) {
      rows.push({
        board: 'B0' + b, comp: 'R' + p, refdes: 'R' + p, pad: 'P' + p,
        group: '0402', volume: val + (p % 2 ? -0.1 : 0.1), height: 120, area: 100
      });
    }
  }
  const st = baseState(c, {
    rows, metric: 'volume', group: 'ALL', chart: 'xbars',
    specs: { volume: { lsl: 70, usl: 130, tgt: 100 } }
  });
  st.A = c.analyze(st);
  assert.ok(st.A.nelX.rules[0].idx.includes(8), 'B09 (index 8) 應觸發 Nelson Rule 1');

  const stats = c.buildStatsData(st);
  const rule1Item = stats.find(s => s.board === 'B09' && s.refdes === '全部' && /Nelson 規則 1/.test(s.rule));
  assert.ok(rule1Item, 'buildStatsData 應包含 B09 之 Nelson Rule 1 異常點');
  assert.match(rule1Item.rule, /超限 \(Nelson 規則 1: 1 點超出 3σ 管制界限\)/);
});

test('statsDataCsv 採用 toCSV 安全轉義，防止試算表公式注入', () => {
  const rows = [
    { board: '=CMD|"/C calc"!A0', comp: '+DDE', refdes: '-123', pad: '@EVIL', group: '0402', volume: 250, height: 120, area: 100 }
  ];
  const st = baseState(c, {
    rows, metric: 'volume', group: 'ALL', chart: 'xbars',
    specs: { volume: { lsl: 70, usl: 130, tgt: 100 } }
  });
  st.A = c.analyze(st);
  const csv = c.statsDataCsv(st);
  assert.match(csv, /^Board,RefDes,Pad,Group,Metric,Value,Mean,SD,Z_Score,Rule,Spec_Source/);
  // Formula characters should be prefixed with single quote in CSV
  assert.ok(!csv.includes('\n=CMD'), '公式開頭不應原樣輸出為未轉義公式');
  assert.ok(csv.includes("'=CMD") || csv.includes('"\'=CMD'), '公式開頭應加上單引號防護');
});

test('detectIssues 孤立極端焊墊中 Poisson 門檻小於 0.0001 時採用科學記號，不輸出 0.0000', () => {
  const rnd = mulberry32(12345);
  const nrm = normal(rnd);
  const rows = [];
  // 20 boards × 50 pads
  for (let b = 1; b <= 20; b++) {
    const bName = 'B' + (b < 10 ? '0' + b : b);
    for (let p = 1; p <= 50; p++) {
      let v = 100 + nrm() * 2;
      // Single extreme pad on B01 with z > 6
      if (b === 1 && p === 1) v = 160;
      rows.push({
        board: bName, comp: 'R' + p, refdes: 'R' + p, pad: 'P' + p,
        group: '0402', volume: v, height: 120, area: 100, offx: 0, offy: 0
      });
    }
  }
  const st = baseState(c, {
    rows, metric: 'volume', group: 'ALL', chart: 'xbars',
    specs: { volume: { lsl: 70, usl: 130, tgt: 100 } }
  });
  const F = c.detectIssues(st);
  const isoCards = F.filter(x => x.cat === '孤立極端焊墊');
  for (const card of isoCards) {
    if (card.p && card.p.includes('Poisson p=')) {
      assert.doesNotMatch(card.p, /門檻 0\.0000/, 'Poisson 門檻不得顯示為 0.0000');
    }
  }
});

test('reportMd 包含一至九完整標準章節，且與 renderReport 標題完全對齊', { skip: !JSDOM && '未安裝 jsdom' }, async () => {
  const html = fs.readFileSync(HTML, 'utf8').replace(/<script src=[^>]+><\/script>/g, '');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.test/',
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
        get: (t, k) => (k === 'measureText' ? () => ({ width: 1 }) : t[k] ?? (() => {})),
        set: (t, k, v) => { t[k] = v; return true; }
      });
      Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', {
        get() { let e = this; while (e) { if (e.hidden) return null; e = e.parentElement; } return w.document.body; }
      });
      w.Element.prototype.scrollIntoView = () => {};
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} };
      w.scrollTo = () => {};
      w.Chart = class { constructor() {} destroy() {} static register() {} };
      Object.assign(w, { Response, DecompressionStream, TextDecoder });
      w.SPI_TEST_HOOK = { bootSample: true };
      withIdb(w);
    }
  });

  const w = dom.window;
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 200; i++) {
    if (w.eval('S.F&&S.F.meta&&S.F.meta.modes')) break;
    await tick(20);
  }

  const md = w.eval('SPI_TEST_HOOK.reportMd()');
  // Check that all 9 chapters are present in exact order
  const chapters = [
    '## 一、執行摘要',
    '## 二、問題偵測清單',
    '## 三、統計製程管制圖',
    '## 四、製程能力分析',
    '## 五、不良類型柏拉圖',
    '## 六、交叉驗證與失效模式比對',
    '## 七、DFM 開孔建議',
    '## 八、資料範圍揭露與未納入證據',
    '## 九、方法附錄與統計檢驗說明'
  ];

  let lastIdx = -1;
  for (const ch of chapters) {
    const idx = md.indexOf(ch);
    assert.ok(idx >= 0, `報告缺少章節：${ch}`);
    assert.ok(idx > lastIdx, `章節順序錯亂：${ch} 應在上一章之後`);
    lastIdx = idx;
  }

  // Check required contents
  assert.match(md, /### 優先處理問題摘要（前 5 項）/);
  assert.match(md, /Nelson 規則（X̄ 圖/);
  assert.match(md, /Cpk 95% 信賴區間/);
  assert.match(md, /## 失效模式交叉比對/);
  assert.match(md, /IPC-7525 判定/);
});

test('260 項歷史問題資料在 issuesCsv、issuesXlsx、issuesMd 匯出皆順暢且資料完整', () => {
  const csvPath = 'C:/Users/user/.gemini/antigravity/brain/e15e505d-5a29-4bba-beca-0d407eb91961/.user_uploaded/media_1793283978729_c775a8be.csv';
  if (!fs.existsSync(csvPath)) return;

  const content = fs.readFileSync(csvPath, 'utf8');
  // Simple CSV parser for user issues
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '"') {
      if (inQuotes && content[i + 1] === '"') { cell += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) {
      row.push(cell); cell = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && content[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }

  const header = rows[0];
  const data = rows.slice(1);
  assert.equal(data.length, 260, '使用者問題檔應為 260 筆');

  const F = data.map(r => ({
    no: +r[0], id: +r[0], level: r[1],
    lv: r[1] === '嚴重' ? 'ng' : r[1] === '警示' ? 'warn' : 'info',
    category: r[2], cat: r[2], title: r[3], rule_id: r[4], rule_name: r[5],
    metric: r[6], boards: r[7], subboard: r[8], group: r[9], refdes: r[10],
    pads: r[11], observed: r[12], limit: r[13], z: r[14], p: r[15],
    facts: r[16].split('; ').map(s => s.trim()), inference: r[17], cause: r[17],
    confidence: r[18], conf: r[18], action: r[19],
    corroborated_by: r[20] ? r[20].split(';').map(s => s.trim()).filter(Boolean) : [],
    corrob: r[20] ? r[20].split(';').map(s => s.trim()).filter(Boolean) : [],
    same_phenomenon: r[21] ? r[21].split(';').map(s => s.trim()).filter(Boolean) : [],
    explained_pads: r[22] ? r[22].split(';').map(s => s.trim()).filter(Boolean) : [],
    spec_source: r[23]
  }));

  // 1. issuesCsv
  const csvOut = c.issuesCsv(F);
  const csvLines = csvOut.split(/\r?\n/).filter(Boolean);
  assert.equal(csvLines.length, 261, 'CSV 輸出應為 1 列標題 + 260 列資料');

  // 2. issuesXlsx
  const xlsxOut = c.issuesXlsx(F);
  assert.ok(xlsxOut instanceof Uint8Array, 'Excel 輸出應為 Uint8Array');
  assert.ok(xlsxOut.length > 10000, 'Excel 大小應大於 10 KB');

  // 3. issuesMd
  const mdOut = c.issuesMd(F, { source: '歷史紀錄', stencil: 90 });
  assert.ok(mdOut.includes('# SPI 問題偵測清單'), 'Markdown 應含主標題');
  assert.ok(mdOut.includes('## #260'), 'Markdown 應含第 260 項問題');
});
