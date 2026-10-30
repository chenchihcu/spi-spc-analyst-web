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
