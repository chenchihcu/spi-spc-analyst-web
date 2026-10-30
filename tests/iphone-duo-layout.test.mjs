import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const htmlSource = fs.readFileSync(path.join(ROOT, 'spi-spc.html'), 'utf8');

let JSDOM;
try {
  ({ JSDOM } = (await import('jsdom')).default || (await import('jsdom')));
} catch {}

function extractSection(source, startStr, endStr) {
  const start = source.indexOf(startStr);
  assert.ok(start >= 0, `找不到 CSS 區塊起始：${startStr}`);
  const end = source.indexOf(endStr, start);
  assert.ok(end > start, `找不到 CSS 區塊結束：${endStr}`);
  return source.slice(start, end);
}

test('1. iPhone Duo 折疊屏 CSS Tokens 定義 (:root)', () => {
  // a. 鉸鏈寬度與單屏可用寬度變數
  assert.match(htmlSource, /--duo-hinge-width:\s*env\(viewport-segment-width 0 0,\s*20px\);/i, '需定義 --duo-hinge-width 並帶 20px fallback');
  assert.match(htmlSource, /--duo-pane-w:\s*calc\(\(100vw - var\(--duo-hinge-width\) - 32px\) \/ 2\);/i, '需定義 --duo-pane-w 單屏寬度計算變數');
});

test('2. DUO-GAP-01 & DUO-GAP-02: 展開書本姿態 (890x626) 與雙欄折痕避讓規則', () => {
  // a. 提取展開書本姿態專屬媒體查詢區塊
  const duoCss = extractSection(
    htmlSource,
    '@media (horizontal-viewport-segments: 2), (min-width: 800px) and (max-width: 960px) and (max-height: 720px){',
    '/* ---------- 資料庫選取中樞 Modal (跨裝置 Desktop & Mobile) ---------- */'
  );

  // b. DUO-GAP-01: .grid2 在 890px 下維持雙欄，不可塌陷為單欄
  assert.match(duoCss, /\.grid2\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)!important/i, '.grid2 需維持 minmax(0,1fr) 雙欄對稱柵格');

  // c. DUO-GAP-02: .grid2 間距強制等於 --duo-hinge-width (20px)，避開中央物理折痕
  assert.match(duoCss, /\.grid2\{[^}]*gap:var\(--duo-hinge-width,20px\)!important/i, '.grid2 間距需綁定 --duo-hinge-width 以避讓鉸鏈折痕');

  // d. 子項目 min-width: 0 防止內容撐開單欄
  assert.match(duoCss, /\.grid2>\*\{[^}]*min-width:\s*0!important/i, '.grid2 子項需強制 min-width: 0');
  assert.match(duoCss, /\.duo-hinge-clearance\{[^}]*column-gap:\s*var\(--duo-hinge-width,20px\)!important/i, '需提供 .duo-hinge-clearance 避讓類別');
});

test('3. DUO-GAP-03: 外螢幕姿態 (466x678) 緊湊頂欄與彈窗按鈕防截斷', () => {
  // a. 提取外螢幕 (466x678) 緊湊直向媒體查詢區塊
  const coverCss = extractSection(
    htmlSource,
    '@media (max-width:500px) and (max-height:700px){',
    '@media (horizontal-viewport-segments: 2),'
  );

  // b. 頂欄高度緊湊化為 56px，爭取垂直可用空間
  assert.match(coverCss, /--navbar-h:56px/i, '外螢幕需使用 56px 緊湊頂欄');
  assert.match(coverCss, /header\.top\{height:calc\(var\(--navbar-h\) \+ var\(--safe-t\)\)!important\}/i, '頂欄高度需跟隨 56px 變數');
  assert.match(coverCss, /\.brand h1\{line-height:32px!important\}/i, '標題行高需縮短為 32px');

  // c. 彈窗全屏 Inset 緊貼緊湊頂欄與底欄
  assert.match(coverCss, /\.db-modal\.open\{inset:calc\(var\(--navbar-h\) \+ var\(--safe-t\)\) 0 calc\(var\(--tabbar-h\) \+ var\(--safe-b\)\) 0!important;padding:0!important\}/i, 'db-modal 需配合緊湊頂欄');
  assert.match(coverCss, /\.sheet-modal\.open\{inset:calc\(var\(--navbar-h\) \+ var\(--safe-t\)\) 0 calc\(var\(--tabbar-h\) \+ var\(--safe-b\)\) 0!important\}/i, 'sheet-modal 需配合緊湊頂欄');

  // d. 彈窗本體滾動保護與底部按鈕防截斷 (通用 CSS)
  assert.match(htmlSource, /\.modal-body-stack\{[^}]*overflow-y:auto/i, '.modal-body-stack 需有 overflow-y: auto');
  assert.match(htmlSource, /\.modal-body-stack\{[^}]*-webkit-overflow-scrolling:touch/i, '.modal-body-stack 需有 -webkit-overflow-scrolling: touch');
  assert.match(htmlSource, /\.modal-body-stack\{[^}]*flex:1 1 auto/i, '.modal-body-stack 需彈性自適應');
  assert.match(htmlSource, /\.sheet-foot--db\{[^}]*flex-shrink:0/i, '.sheet-foot--db 需設定 flex-shrink: 0 確保操作按鈕不被壓縮截斷');
});

test('4. JSDOM: 彈窗結構與多工雙欄容器完整性', { skip: !JSDOM && '未安裝 jsdom' }, async () => {
  const dom = new JSDOM(htmlSource.replace(/<script src=[^>]+><\/script>/g, ''), {
    runScripts: 'outside-only',
    url: 'https://example.test/',
  });

  const d = dom.window.document;
  const $ = (s) => d.querySelector(s);
  const $$ = (s) => [...d.querySelectorAll(s)];

  // a. 驗證工單/備註修改彈窗結構
  const recEditModal = $('#recEditModal');
  assert.ok(recEditModal, '需存在 #recEditModal');
  assert.ok(recEditModal.querySelector('.modal-body-stack'), 'recEditModal 需包含 .modal-body-stack 滾動容器');
  assert.ok(recEditModal.querySelector('.sheet-foot--db'), 'recEditModal 需包含 .sheet-foot--db 底部按鈕區');

  // b. 驗證儲存與取消按鈕順序（Institution 對話框規範：儲存在取消左側）
  const saveBtn = $('#recEditSave');
  const cancelBtn = $('#recEditCancel');
  assert.ok(saveBtn && cancelBtn, '需存在儲存與取消按鈕');
  assert.equal(saveBtn.nextElementSibling, cancelBtn, '儲存按鈕需位於取消按鈕左側');

  // c. 驗證主要頁籤內皆包含 .grid2 容器
  const grid2Containers = $$('.grid2');
  assert.ok(grid2Containers.length >= 8, `需存在足夠的 .grid2 容器（目前發現 ${grid2Containers.length} 個）`);
  for (const g of grid2Containers) {
    assert.ok(g.closest('.panel, #p-overview, #p-control, #p-cross, #p-adv, #p-ai, #p-capability, .card'), '.grid2 需存在於合法的頁籤或卡片容器內');
  }
});

test('5. S.duo 狀態機拓撲結構驗證', () => {
  assert.match(htmlSource, /duo:\s*\{active:false,posture:"folded",mode:"master-detail",leftTab:"issues",rightTab:"sim3d",thumbSide:"right",pinnedPad:null,dockOpen:false\}/, 'S.duo 需定義標準初始狀態機');
});

test('6. PR 2 DOM 元件：#duoToggleBtn 與 #duoThumbDock 向量圖示與無障礙規格', { skip: !JSDOM && '未安裝 jsdom' }, async () => {
  const dom = new JSDOM(htmlSource.replace(/<script src=[^>]+><\/script>/g, ''), {
    runScripts: 'outside-only',
    url: 'https://example.test/',
  });
  const d = dom.window.document;
  const $ = (s) => d.querySelector(s);

  // a. 頂部 Duo 切換按鈕
  const toggleBtn = $('#duoToggleBtn');
  assert.ok(toggleBtn, '需存在 #duoToggleBtn');
  assert.equal(toggleBtn.getAttribute('aria-label'), '切換雙欄模式', '需有 aria-label="切換雙欄模式"');
  assert.equal(toggleBtn.getAttribute('aria-pressed'), 'false', '預設 aria-pressed="false"');
  assert.ok(toggleBtn.querySelector('svg'), '需包含向量 SVG 圖示');
  assert.doesNotMatch(toggleBtn.innerHTML, /📱|💻|✨/, '不可包含 emoji 圖示');

  // b. 底部拇指微型操作 Dock
  const dock = $('#duoThumbDock');
  assert.ok(dock, '需存在 #duoThumbDock');
  assert.equal(dock.getAttribute('aria-label'), '拇指快速操作列');
  assert.ok($('#duoPrevBoardBtn'), '需有上一板按鈕 #duoPrevBoardBtn');
  assert.ok($('#duoNextBoardBtn'), '需有下一板按鈕 #duoNextBoardBtn');
  assert.ok($('#duoRightTabBtn'), '需有副欄切換按鈕 #duoRightTabBtn');
  assert.ok($('#duoSwapPaneBtn'), '需有左右欄互換按鈕 #duoSwapPaneBtn');
  assert.ok($('#duoCurBoard'), '需有目前板號 #duoCurBoard');
  assert.ok($('#duoTotBoards'), '需有總板數 #duoTotBoards');
});

test('7. PR 2 CSS 樣式：拇指 Dock 觸控熱區與雙欄佈局規則', () => {
  // a. 觸控熱區 >= 44px
  assert.match(htmlSource, /\.thumb-btn\{[^}]*min-width:\s*44px;min-height:\s*44px/i, '.thumb-btn 觸控熱區需 >= 44x44px');

  // b. Duo 模式下拇指 Dock 顯示與底欄隱藏
  assert.match(htmlSource, /body\.duo-mode\s+\.duo-thumb-dock\{display:flex!important\}/, 'Duo 模式下需顯示拇指 Dock');
  assert.match(htmlSource, /body\.duo-mode\s+nav\.mtab\{display:none!important\}/, 'Duo 模式下需隱藏單欄底欄');

  // c. 雙欄浮動並排與左右折痕間距
  assert.match(htmlSource, /body\.duo-mode\s+\.panel\.duo-pane-left\{[^}]*float:left!important/, '左欄需向左浮動');
  assert.match(htmlSource, /body\.duo-mode\s+\.panel\.duo-pane-right\{[^}]*float:right!important/, '右欄需向右浮動');
  assert.match(htmlSource, /body\.duo-mode::after\{[^}]*clear:both/, '需包含清除浮動偽元素');
});

test('8. Duo 雙欄 Panel 顯示調度邏輯與切換', { skip: !JSDOM && '未安裝 jsdom' }, async () => {
  const dom = new JSDOM(htmlSource.replace(/<script src=[^>]+><\/script>/g, ''), {
    runScripts: 'dangerously',
    url: 'https://example.test/',
    beforeParse(w) {
      w.SPI_TEST_HOOK = {};
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
      w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      w.matchMedia = (query) => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} };
      w.scrollTo = () => {};
      w.Chart = class { constructor() {} destroy() {} static register() {} static defaults = { font: {} }; };
    },
  });

  const hook = dom.window.SPI_TEST_HOOK;
  assert.ok(hook, '需存在 SPI_TEST_HOOK');
  const { S, toggleDuoMode, setDuoTab, swapDuoPanes } = hook;

  // a. 初始狀態：非 Duo 模式
  assert.equal(S.duo.active, false, '初始 active 應為 false');
  assert.equal(dom.window.document.body.classList.contains('duo-mode'), false, 'body 不應含 duo-mode');

  // b. 開啟 Duo 模式
  toggleDuoMode(true);
  assert.equal(S.duo.active, true, '切換後 active 應為 true');
  assert.equal(dom.window.document.body.classList.contains('duo-mode'), true, 'body 應含 duo-mode');

  const pIssues = dom.window.document.querySelector('#p-issues');
  const pSim3d = dom.window.document.querySelector('#p-sim3d');
  const pOverview = dom.window.document.querySelector('#p-overview');

  assert.equal(pIssues.hidden, false, '主欄 #p-issues 應顯示');
  assert.equal(pIssues.classList.contains('duo-pane-left'), true, '#p-issues 應具有 duo-pane-left 類別');
  assert.equal(pSim3d.hidden, false, '副欄 #p-sim3d 應顯示');
  assert.equal(pSim3d.classList.contains('duo-pane-right'), true, '#p-sim3d 應具有 duo-pane-right 類別');
  assert.equal(pOverview.hidden, true, '非當前左右欄之 #p-overview 應隱藏');

  // c. 左右欄互換測試 (swapDuoPanes)
  swapDuoPanes();
  assert.equal(S.duo.leftTab, 'sim3d', '互換後 leftTab 應為 sim3d');
  assert.equal(S.duo.rightTab, 'issues', '互換後 rightTab 應為 issues');
  assert.equal(pSim3d.classList.contains('duo-pane-left'), true, '互換後 #p-sim3d 應為 duo-pane-left');
  assert.equal(pIssues.classList.contains('duo-pane-right'), true, '互換後 #p-issues 應為 duo-pane-right');

  // d. 關閉 Duo 模式，復原單欄
  toggleDuoMode(false);
  assert.equal(S.duo.active, false, '關閉後 active 應為 false');
  assert.equal(dom.window.document.body.classList.contains('duo-mode'), false, 'body 應移除 duo-mode');
  assert.equal(pSim3d.classList.contains('duo-pane-left'), false, '應清除 duo-pane-left');
  assert.equal(pIssues.classList.contains('duo-pane-right'), false, '應清除 duo-pane-right');
});

test('9. PR 3 主從事件匯流排 spc:duo-pad-select 與跨欄聯動', { skip: !JSDOM && '未安裝 jsdom' }, async () => {
  const dom = new JSDOM(htmlSource.replace(/<script src=[^>]+><\/script>/g, ''), {
    runScripts: 'dangerously',
    url: 'https://example.test/',
    beforeParse(w) {
      w.SPI_TEST_HOOK = {};
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
      w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      w.matchMedia = (query) => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} };
      w.scrollTo = () => {};
      w.Chart = class { constructor() {} destroy() {} static register() {} static defaults = { font: {} }; };
    },
  });

  const hook = dom.window.SPI_TEST_HOOK;
  const { S, toggleDuoMode } = hook;
  toggleDuoMode(true);

  let eventFired = false;
  let receivedDetail = null;
  dom.window.addEventListener('spc:duo-pad-select', (e) => {
    eventFired = true;
    receivedDetail = e.detail;
  });

  // 分發事件模擬點選焊墊
  dom.window.dispatchEvent(new dom.window.CustomEvent('spc:duo-pad-select', {
    detail: { pad: 'U2_A1', board: 3, tab: 'sim3d', issue: { id: 101, title: '連錫風險' } }
  }));

  assert.equal(eventFired, true, '需成功監聽到 spc:duo-pad-select 事件');
  assert.equal(receivedDetail.pad, 'U2_A1', '事件資料需包含 pad');
  assert.equal(receivedDetail.board, 3, '事件資料需包含 board');
  assert.equal(receivedDetail.issue.id, 101, '事件資料需包含 issue');
});

test('10. PR 3 WebGL 資源防護與 Web-Perf 記憶體凍結守衛', { skip: !JSDOM && '未安裝 jsdom' }, async () => {
  const dom = new JSDOM(htmlSource.replace(/<script src=[^>]+><\/script>/g, ''), {
    runScripts: 'dangerously',
    url: 'https://example.test/',
    beforeParse(w) {
      w.SPI_TEST_HOOK = {};
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
      w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      w.matchMedia = (query) => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} };
      w.scrollTo = () => {};
      w.Chart = class { constructor() {} destroy() {} static register() {} static defaults = { font: {} }; };
    },
  });

  const hook = dom.window.SPI_TEST_HOOK;
  const { suspendDuoSim3D, T } = hook;
  assert.equal(typeof suspendDuoSim3D, 'function', '需導出 suspendDuoSim3D 函式');

  // 模擬 raf 動畫排程並執行凍結
  if (T) {
    T.raf = 999;
    suspendDuoSim3D();
    assert.equal(T.raf, 0, 'suspendDuoSim3D 需將 T.raf 重置為 0 停止動畫循環');
  }

  // 檢查選取卡片高亮樣式
  assert.match(htmlSource, /\.iss-card\.duo-selected\{[^}]*outline:\s*2px solid var\(--accent\)!important/i, '需定義 .iss-card.duo-selected 高亮外框');
});

test('11. PR 4 Tabletop 筆電懸停姿態 (DUO-GAP-08)', { skip: !JSDOM && '未安裝 jsdom' }, async () => {
  // a. CSS 規則檢驗
  assert.match(htmlSource, /body\.duo-mode\.duo-tabletop\s+\.panel\.duo-pane-left\{[^}]*width:100%!important/, 'Tabletop 模式下左欄需寬度 100%');
  assert.match(htmlSource, /body\.duo-mode\.duo-tabletop\s+\.panel\.duo-pane-right\{[^}]*margin-top:var\(--duo-hinge-width,20px\)!important/, 'Tabletop 模式下右欄需有 20px 鉸鏈間隔');
  assert.match(htmlSource, /body\.duo-mode\.duo-tabletop\s+\.thumb-btn\{[^}]*min-height:48px!important/, 'Tabletop 姿態下觸控按鈕需擴大至 48px');

  // b. JSDOM 姿態調度檢驗
  const dom = new JSDOM(htmlSource.replace(/<script src=[^>]+><\/script>/g, ''), {
    runScripts: 'dangerously',
    url: 'https://example.test/',
    beforeParse(w) {
      w.SPI_TEST_HOOK = {};
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
      w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} };
      w.scrollTo = () => {};
      w.Chart = class { constructor() {} destroy() {} static register() {} static defaults = { font: {} }; };
    },
  });

  const hook = dom.window.SPI_TEST_HOOK;
  const { S, toggleDuoMode, setDuoPosture } = hook;
  toggleDuoMode(true);

  // 切換為 tabletop 姿態
  setDuoPosture('tabletop');
  assert.equal(S.duo.posture, 'tabletop', 'S.duo.posture 應為 tabletop');
  assert.equal(dom.window.document.body.classList.contains('duo-tabletop'), true, 'body 需帶有 duo-tabletop 類別');

  // 切換回 book 姿態
  setDuoPosture('book');
  assert.equal(S.duo.posture, 'book', 'S.duo.posture 應為 book');
  assert.equal(dom.window.document.body.classList.contains('duo-tabletop'), false, 'body 需移除 duo-tabletop 類別');
});

test('12. PR 4 雙頁對開書本報表排版 (Two-Page Spread, DUO-GAP-09)', { skip: !JSDOM && '未安裝 jsdom' }, async () => {
  // a. CSS 雙頁排版規則檢驗
  assert.match(htmlSource, /body\.duo-mode\s+\.rep-book-spread\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)!important/i, '雙欄模式下報表需為雙頁對開網格');
  assert.match(htmlSource, /body\.duo-mode\s+\.rep-book-spread\{[^}]*gap:var\(--duo-hinge-width,20px\)!important/i, '雙頁報表需在中縫留有 20px 鉸鏈間距');
  assert.match(htmlSource, /body\.duo-mode\s+\.panel\.duo-pane-full\{display:block!important;width:100%!important/i, '需支援滿版跨屏 .duo-pane-full');

  // b. JSDOM 報表左右對開結構檢驗
  const dom = new JSDOM(htmlSource.replace(/<script src=[^>]+><\/script>/g, ''), {
    runScripts: 'dangerously',
    url: 'https://example.test/',
    beforeParse(w) {
      w.SPI_TEST_HOOK = {};
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
      w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} };
      w.scrollTo = () => {};
      w.Chart = class { constructor() {} destroy() {} static register() {} static defaults = { font: {} }; };
    },
  });

  const hook = dom.window.SPI_TEST_HOOK;
  const { S, toggleDuoMode, setTab } = hook;
  toggleDuoMode(true);
  setTab('report');

  const d = dom.window.document;
  const pReport = d.querySelector('#p-report');
  assert.equal(pReport.hidden, false, '#p-report 應顯示');
  assert.equal(pReport.classList.contains('duo-pane-full'), true, '#p-report 於 Duo 模式下應具有 duo-pane-full 滿版類別');

  const spread = d.querySelector('#repBookSpread');
  assert.ok(spread, '需存在 #repBookSpread 雙頁展開容器');
  const leftPage = d.querySelector('#repPageLeft');
  const rightPage = d.querySelector('#repPageRight');
  assert.ok(leftPage, '需存在左頁容器 #repPageLeft');
  assert.ok(rightPage, '需存在右頁容器 #repPageRight');
});

test('13. PR 4 觸覺回饋微動效與左欄緊湊表格 (DUO-GAP-11, DUO-GAP-13)', () => {
  // a. DUO-GAP-11 按鈕按壓微動效
  assert.match(htmlSource, /\.duo-toggle-btn:active\{transform:scale\(0\.96\)!important\}/i, '頂部按鈕需有 scale(0.96) 動效');
  assert.match(htmlSource, /\.thumb-btn:active\{[^}]*transform:scale\(0\.96\)!important/i, '拇指按鈕需有 scale(0.96) 動效');

  // b. DUO-GAP-13 緊湊表格內距
  assert.match(htmlSource, /body\.duo-mode\s+\.duo-pane-left\s+\.tbl\s+td\{[^}]*padding:5px 6px!important/i, '左欄表格單元格內距需緊湊化至 5px 6px');
});
