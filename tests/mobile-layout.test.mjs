import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION, APP_BUILT } from '../lib/version.mjs';
import { loginPage } from '../lib/auth-handler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const htmlSource = fs.readFileSync(path.join(ROOT, 'spi-spc.html'), 'utf8');

test('明亮狀態文字在介面與報告白紙底色上的對比至少 4.5', () => {
  function luminance(hex) {
    const channels = hex.match(/\w{2}/g).map(value => parseInt(value, 16) / 255);
    const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return linear.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  }
  for (const selector of [':root', '.report-preview']) {
    const start = htmlSource.indexOf(selector === ':root' ? ':root{' : '.report-preview{--');
    assert.ok(start >= 0, `${selector} 需宣告明亮色彩 token`);
    const rule = htmlSource.slice(start).split('}')[0];
    for (const name of ['ok', 'warn', 'ng']) {
      const foreground = luminance(rule.match(new RegExp(`--${name}:#([0-9a-f]{6})`, 'i'))[1]);
      const background = luminance(rule.match(new RegExp(`--${name}-soft:#([0-9a-f]{6})`, 'i'))[1]);
      const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      assert.ok(contrast >= 4.5, `${selector} ${name} 對比 ${contrast}`);
    }
  }
});

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = (await import('jsdom')).default || (await import('jsdom')));
} catch {}

test('1. 版本與更新時間三方一致性 (version.mjs, CHANGELOG.md, spi-spc.html)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(APP_VERSION, `v${pkg.version}`, 'APP_VERSION 應與 package.json 一致');
  
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const clMatch = changelog.match(/^##\s+(v[0-9.]+)\s+—\s+([0-9-]{10}(?:\s+[0-9:]{8})?)/m);
  assert.ok(clMatch, 'CHANGELOG 應有最新版條目');
  assert.equal(clMatch[1], APP_VERSION, 'CHANGELOG 最新版號應與 APP_VERSION 一致');
  
  const appVerMatch = htmlSource.match(/id="appVer">([^<]+)</);
  const appBuiltMatch = htmlSource.match(/id="appBuilt">([^<]+)</);
  assert.ok(appVerMatch, 'spi-spc.html 應有 #appVer');
  assert.equal(appVerMatch[1], APP_VERSION, '#appVer 應與 APP_VERSION 一致');
  assert.ok(appBuiltMatch, 'spi-spc.html 應有 #appBuilt');
  assert.equal(appBuiltMatch[1], APP_BUILT, '#appBuilt 應與 APP_BUILT 一致');
});

test('2. 登入頁行動版規格 (lib/auth-handler.mjs loginPage)', () => {
  const resp = loginPage('/?test=1');
  assert.equal(resp.status, 200);
  
  // 檢查 HTML 內容
  return resp.text().then(html => {
    // a. color-scheme 與 theme-color 及預設明亮主題
    assert.match(html, /<html[^>]*data-theme="light"/i, '登入頁需預設 data-theme="light"');
    assert.match(html, /<meta\s+name="color-scheme"\s+content="light dark">/i, '需有 color-scheme meta');
    assert.match(html, /<meta\s+name="theme-color"[^>]*content="#F2F4F0"/i, '需有淺色 theme-color');
    assert.match(html, /<meta\s+name="theme-color"[^>]*content="#0F1311"/i, '需有深色 theme-color');

    // b. viewport
    assert.match(html, /viewport-fit=cover/i, 'viewport 需包含 viewport-fit=cover');
    assert.doesNotMatch(html, /user-scalable\s*=\s*no/i, '不可包含 user-scalable=no');
    assert.doesNotMatch(html, /maximum-scale/i, '不可包含 maximum-scale');

    // c. 移除 autofocus 防止行動版鍵盤彈出遮擋
    assert.doesNotMatch(html, /<input[^>]+id="user"[^>]+autofocus/i, '帳號欄位不可含 autofocus');

    // d. CSS 規則：input 17px, label 15px, toggle min 44x44, brand max-height <= 160px
    assert.match(html, /input\{[^}]*font-size:\s*17px/i, 'input 需設定 17px 字級防止 iOS Safari 放大');
    assert.match(html, /label\{[^}]*font-size:\s*15px/i, 'label 需設定 15px 字級');
    assert.match(html, /\.toggle\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/i, '.toggle 觸控區域至少 44×44');
    assert.match(html, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.brand\{[^}]*max-height:\s*160px/i, '手機寬度品牌區高度需限制在 160px 以內');
    assert.match(html, /--logo-ink:\s*#04273F/i, '登入頁需定義 --logo-ink:#04273F');
    assert.match(html, /<svg\s+class="mitcorp-logo"\s+viewBox="0 0 248 45"/i, '登入頁需包含 Mitcorp 向量商標');
  });
});

test('3. 主頁 Head Meta 與 CSS Tokens (spi-spc.html)', () => {
  // a. Head meta 與預設明亮主題
  assert.match(htmlSource, /<html[^>]*data-theme="light"/i, '主頁需預設 data-theme="light"');
  assert.match(htmlSource, /<meta\s+name="color-scheme"\s+content="light dark">/i, '需有 color-scheme');
  assert.match(htmlSource, /<meta\s+name="theme-color"[^>]*content="#F2F4F0"/i, '需有淺色 theme-color');
  assert.match(htmlSource, /<meta\s+name="theme-color"[^>]*content="#0F1311"/i, '需有深色 theme-color');
  assert.match(htmlSource, /<meta\s+name="viewport"[^>]*content="[^"]*viewport-fit=cover[^"]*"/i, 'viewport 需包含 viewport-fit=cover');
  assert.doesNotMatch(htmlSource, /user-scalable\s*=\s*no/i, '主頁不可包含 user-scalable=no');
  assert.doesNotMatch(htmlSource, /maximum-scale\s*=\s*1/i, '主頁不可包含 maximum-scale=1');
  assert.doesNotMatch(htmlSource, /📂|💡/, '記錄庫與提示不可使用 emoji 圖示（RFC UI-GAP-01）');
  assert.match(htmlSource, /id="recEditSave"[\s\S]{0,120}id="recEditCancel"/, '#recEditModal 儲存須在取消左側（Institution 對話框順序）');

  // b. Tokens in :root
  assert.match(htmlSource, /--tap-min:\s*44px;/i, '需定義 --tap-min');
  assert.match(htmlSource, /--logo-ink:\s*#04273F;/i, '需定義 --logo-ink:#04273F');
  assert.match(htmlSource, /<svg\s+class="mitcorp-logo"\s+viewBox="0 0 248 45"/i, '主頁需包含 Mitcorp 向量商標');
  assert.match(htmlSource, /--tabbar-h:\s*49px;/i, '需定義 --tabbar-h');
  assert.match(htmlSource, /--navbar-h:\s*44px;/i, '需定義 --navbar-h');
  assert.match(htmlSource, /--r-card:\s*16px;/i, '需定義 --r-card');
  assert.match(htmlSource, /--r-sheet:\s*20px;/i, '需定義 --r-sheet');
  assert.match(htmlSource, /--safe-t:\s*env\(safe-area-inset-top,\s*0px\);/i, '需定義 --safe-t');
  assert.match(htmlSource, /--safe-b:\s*env\(safe-area-inset-bottom,\s*0px\);/i, '需定義 --safe-b');
  assert.match(htmlSource, /--c-bar:/i, '需定義 --c-bar');

  // c. 禁止以 overflow-x:hidden 掩蓋溢出
  assert.doesNotMatch(htmlSource, /body\s*\{[^}]*overflow-x:\s*hidden/i, '不可在 body 使用 overflow-x:hidden');
  assert.doesNotMatch(htmlSource, /html\s*\{[^}]*overflow-x:\s*hidden/i, '不可在 html 使用 overflow-x:hidden');
});

test('問題地圖的手機網格依列自動排版，避免多板格形成隱式欄而撐寬頁面', () => {
  assert.match(htmlSource, /\.pmap-cells\.pmap-boards\{[^}]*grid-auto-flow:\s*row/i);
});

test('4. 行動版 DOM 結構與分頁控制 (JSDOM 驗證)', { skip: !JSDOM && '未安裝 jsdom' }, async () => {
  const dom = new JSDOM(htmlSource.replace(/<script src=[^>]+><\/script>/g, ''), {
    runScripts: 'dangerously',
    url: 'https://example.test/',
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
      Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', { get() { return w.document.body; } });
      w.Element.prototype.scrollIntoView = () => {};
      w.matchMedia = (query) => ({ matches: query.includes('max-width: 767px'), addEventListener() {} });
      w.ResizeObserver = class { observe() {} };
      w.scrollTo = () => {};
      w.Chart = class { constructor() {} destroy() {} static register() {} static defaults = { font: {} }; };
    },
  });

  const d = dom.window.document;
  const $ = (s) => d.querySelector(s);
  const $$ = (s) => [...d.querySelectorAll(s)];

  // a. 底部分頁列 (<nav class="mtab">) 結構與項目
  const mtab = $('nav.mtab');
  assert.ok(mtab, '需存在 nav.mtab 底部分頁列');
  assert.equal(mtab.getAttribute('aria-label'), '主要分頁', 'nav.mtab 需有 aria-label="主要分頁"');
  
  const mtabButtons = $$('nav.mtab button.mtab-btn');
  assert.equal(mtabButtons.length, 5, '底部分頁列需恰好 5 個項目');
  
  const tabKeys = mtabButtons.map(b => b.dataset.tab || b.id);
  assert.deepEqual(tabKeys, ['issues', 'overview', 'control', 'capability', 'mtabMore'], '底部分頁列 5 項定義需正確');

  // b. 更多 Sheet (role="dialog" aria-modal="true")
  const moreSheet = $('#moreSheet');
  assert.ok(moreSheet, '需存在 #moreSheet');
  assert.equal(moreSheet.getAttribute('role'), 'dialog', 'moreSheet 需有 role="dialog"');
  assert.equal(moreSheet.getAttribute('aria-modal'), 'true', 'moreSheet 需有 aria-modal="true"');
  assert.ok($('#moreBackdrop'), '需有 #moreBackdrop 遮罩');
  assert.ok($('#moreSheetClose'), '需有 #moreSheetClose 關閉鈕');
  assert.ok(moreSheet.querySelector('.sheet-handle'), '需有拖曳把手 .sheet-handle');

  // c. 更多 Sheet 內涵蓋全部次要分頁（共 4+9=13 個分頁）
  const subTabs = $$('#moreSheet [data-mtab]').map(b => b.dataset.mtab);
  assert.deepEqual(subTabs, ['sim3d', 'cross', 'adv', 'stats', 'compare', 'dfm', 'lab', 'ai', 'report', 'data'], '需涵蓋其餘 10 個分頁');

  // d. 更多 Sheet 內涵蓋操作與帳號
  assert.ok($('#mBtnTheme'), '需有行動版主題切換鈕');
  assert.ok($('#btnTheme'), '需有桌機版主題切換鈕');
  assert.ok($('#mBtnPrint'), '需有行動版列印鈕');
  assert.ok($('#mBtnShare'), '需有行動版分享鈕');
  assert.ok($('#mBtnMyShares'), '需有行動版我的分享鈕');
  assert.ok($('#mLogoutLink'), '需有行動版登出連結');

  // e. 頂部 Sticky Chip 摘要列 (#btnRailChip & #railSheet)
  const chip = $('#btnRailChip');
  assert.ok(chip, '需存在 #btnRailChip 摘要晶片');
  assert.equal(chip.getAttribute('aria-haspopup'), 'dialog', 'chip 需有 aria-haspopup="dialog"');
  assert.ok($('#railSheet'), '需存在 #railSheet');

  // f. 點擊測試：點擊底欄項目應切換分頁
  const btnOverview = $('nav.mtab [data-tab="overview"]');
  btnOverview.click();
  assert.equal(btnOverview.getAttribute('aria-selected'), 'true', '切換至 overview 時 aria-selected 應為 true');
  assert.equal($('nav.mtab [data-tab="issues"]').getAttribute('aria-selected'), 'false', '原 issues aria-selected 應為 false');

  // g. 點擊更多 sheet 內的次要分頁（例如 dfm）
  const btnDfm = $('#moreSheet [data-mtab="dfm"]');
  btnDfm.click();
  // 當前分頁不在前四項時，mtabMore 應標記為 selected
  const mtabMore = $('#mtabMore');
  assert.equal(mtabMore.getAttribute('aria-selected'), 'true', '在次級分頁時更多按鈕需顯示 active/selected');
  assert.ok($('#cWipe'), '需存在 #cWipe 畫布');
  assert.equal($('#cardMorph')?.parentElement?.id, 'p-adv', '#cardMorph 的直接父層必須是 #p-adv');
  assert.equal($$('#p-adv .card .card').length, 0, '#p-adv 內不可有 .card 巢狀包覆 .card');
  for (const id of ['aiSettingsCard', 'inAiKey', 'btnAiKeyToggle', 'inAiDailyLim', 'inAiTokenLim', 'inAiUsdLim', 'btnAiSaveCfg', 'btnAiClearKey', 'aiDailyBar', 'aiMonthlyBar', 'btnAICopy', 'btnAIMd']) {
    assert.ok($(`#${id}`), `AI 分析頁需存在 #${id}`);
  }
});

test('5. 觸控修正與無障礙樣式規範 (CSS 規則檢驗)', () => {
  // a. .card .cbtn, .toc button, .how summary min-height >= 44px
  assert.match(htmlSource, /\.how summary\{[^}]*min-height:\s*44px/i, '.how summary 需有 min-height: 44px');
  assert.match(htmlSource, /\.card \.cbtn[^}]*\{[^}]*min-height:\s*44px/i, '.card .cbtn 需有 min-height: 44px');
  assert.match(htmlSource, /\.toc button[^}]*\{[^}]*min-height:\s*44px/i, '.toc button 需有 min-height: 44px');

  // b. .subtab segmented 樣式 (44px)
  assert.match(htmlSource, /\.subtab\{[^}]*min-height:\s*44px/i, '.subtab 需有 min-height: 44px');

  // c. 問題地圖：群組格高 44（橫捲）；板號格在觸控與 ≤720px 時為 44×44 並自動換行（v10.4.2 由 28×44 放大，IOS-04）
  assert.match(htmlSource, /\.pmap-cells\s+button\{[^}]*min-height:\s*44px/i, '問題地圖格子高度需 ≥ 44px');
  assert.match(htmlSource, /class="pmap-cells pmap-boards"/, '板號列需有 pmap-boards');
  const boardRules = htmlSource.match(/\.pmap-boards button\{[^}]*\}/g) || [];
  assert.ok(boardRules.length >= 2 && boardRules.every((r) => /min-width:\s*44px/.test(r)), '板號格在觸控與 ≤720px 需 min-width 44px');
  assert.match(htmlSource, /\.pmap-cells\.pmap-boards\{[^}]*grid-template-columns:repeat\(auto-fill,minmax\(44px,1fr\)\)/, '板號格需自動換行');

  // d. 表格與浮動元件避讓
  assert.match(htmlSource, /#toTop,#toast\{[^}]*bottom:\s*calc\(var\(--tabbar-h\)\s*\+\s*var\(--safe-b\)\s*\+\s*12px\)/i, '#toTop 與 #toast 需避讓底欄');

  // e. Sticky 表頭在手機下頂部避讓 44px + safe-top
  assert.match(htmlSource, /\.tbl\.sticky-head\s+thead\s+th\{[^}]*top:\s*calc\(44px\s*\+\s*env\(safe-area-inset-top,\s*0px\)\)/i, '表格 sticky 表頭需配合 44px 頂欄避讓');
});

test('6. PWA 與進階無障礙 (Apple Touch Icon, scroll-margin, 44px 報告標籤, WCAG --warn 對比度)', () => {
  // a. PWA 與 Apple Touch Icon
  assert.match(htmlSource, /<meta\s+name="apple-mobile-web-app-capable"\s+content="yes">/i, '需有 apple-mobile-web-app-capable');
  assert.match(htmlSource, /<link\s+rel="apple-touch-icon"/i, '需有 apple-touch-icon');
  assert.match(htmlSource, /<meta\s+name="apple-mobile-web-app-title"\s+content="SPI·SPC">/i, '需有 apple-mobile-web-app-title');

  // b. 明亮警示色在淡色警示底上的對比約 5.14；數值門檻由上方色彩測試驗證。
  assert.match(htmlSource, /--warn:\s*#87570B/i, '--warn 需使用已驗證對比的明亮警示色');

  // c. 表單 scroll-margin 防固定頂底欄遮擋
  assert.match(htmlSource, /scroll-margin-bottom:\s*calc\(var\(--tabbar-h\)\s*\+\s*var\(--safe-b\)\s*\+\s*16px\)/i, '表單輸入需配置 scroll-margin-bottom');

  // d. 報告與郵件章節標籤 44px 觸控熱區
  assert.match(htmlSource, /#p-report label,\s*#p-mail label\{[^}]*min-height:\s*44px/i, '報告與郵件標籤需有 min-height: 44px');

  // e. 登入頁包含橫向 safe-area 避讓
  const resp = loginPage('/?test=1');
  return resp.text().then(html => {
    assert.match(html, /env\(safe-area-inset-left/i, '登入頁需支援 safe-area-inset-left 避讓');
    assert.match(html, /env\(safe-area-inset-right/i, '登入頁需支援 safe-area-inset-right 避讓');
  });
});

test('7. 版面回歸：同權重 CSS 的先後順序、flex 壓縮與行內高度 (Playwright 稽核找到的問題)', () => {
  const at = (s) => { const i = htmlSource.indexOf(s); assert.ok(i >= 0, `找不到 CSS：${s}`); return i; };

  // a. 手機頁首隱藏 chip 的選擇器權重須高於後面的 .chip.chipBtn{display:inline-flex!important}，否則頁首按鈕會蓋住設定鈕與子分頁
  assert.match(htmlSource, /header\.top \.toprow \.chip\{display:none!important\}/, '手機頁首 chip 隱藏規則需提高權重');
  assert.doesNotMatch(htmlSource, /\n\s*\.toprow \.chip\{display:none!important\}/, '不可退回與 .chip.chipBtn 同權重的寫法');

  // b. 問題卡片：長規則名稱可換行，欄寬不被內容撐開
  assert.match(htmlSource, /\.iss-detail\{[^}]*grid-template-columns:minmax\(0,1fr\)/, '.iss-detail 欄寬需為 minmax(0,1fr)');
  assert.match(htmlSource, /\.iss-head \.pill\{[^}]*white-space:normal/, '問題卡片的規則標籤需可換行');

  // c. 觸控 44px 規則須排在基準高度之後（同權重時後者勝出）
  assert.ok(at('@media (pointer:coarse){.seg button,#startupDbBanner button,#recPickerQ,#recPickerReload{min-height:44px') >
    at('.seg button{border:none;border-radius:0;background:var(--surface);min-height:32px'), '觸控 .seg 規則需在基準規則之後');
  assert.match(htmlSource, /\.how summary, details\.fm>summary\{min-height:44px/, '交叉驗證失效模式摘要需有 44px 觸控高度');
  assert.match(htmlSource, /@media \(pointer:coarse\)\{\r?\n\s*button,select,input\[type=number\],input\[type=text\],input\[type=date\],textarea\{min-height:44px/, '日期欄位需在觸控 44px 規則內');

  // d. 行內 min-height 會蓋過觸控規則，改由 CSS 管理
  for (const id of ['btnBannerLoadDb', 'btnBannerGoImport', 'btnBannerDismiss', 'recPickerQ', 'recPickerReload']) {
    const tag = htmlSource.match(new RegExp(`<[^>]*id="${id}"[^>]*>`))[0];
    assert.doesNotMatch(tag, /min-height/, `#${id} 不可有行內 min-height`);
  }

  // e. 可橫向捲動的列不可壓縮項目（觸控 min-width:44px 取代了 flex 預設的 min-width:auto，文字會互相重疊）
  assert.match(htmlSource, /\n\.tab\{[^}]*flex-shrink:0/, '頁籤不可被壓縮');
  assert.match(htmlSource, /\n\.toc button\{[^}]*flex-shrink:0/, '本頁目錄按鈕不可被壓縮');
  assert.match(htmlSource, /#p-issues>#issFilter>\*\{flex-shrink:0\}/, '手機問題篩選 chip 不可被壓縮');

  // g. 手機頁首顯示版本與建置時間，另列一行並保留完整時間字串
  const mobileStart = htmlSource.indexOf('@media (max-width:600px), (pointer:coarse) and (max-height:500px){');
  const landscapeStart = htmlSource.indexOf('@media (pointer:coarse) and (max-height:500px){');
  assert.ok(mobileStart >= 0 && landscapeStart > mobileStart, '需有行動版與短版橫向 CSS 區塊');
  const mobileCss = htmlSource.slice(mobileStart, landscapeStart);
  assert.doesNotMatch(mobileCss, /\.brand \.ver\{display:none/, '手機版不可隱藏版本欄位');
  assert.match(mobileCss, /:root\{--navbar-h:76px\}/, '手機版頂欄高度需為 76px');
  assert.match(mobileCss, /\.brand\{[^}]*row-gap:2px[^}]*flex-wrap:wrap/, '品牌列需允許版本另起一行');
  assert.match(mobileCss, /\.brand \.ver\{[^}]*flex:0 0 100%[^}]*white-space:normal[^}]*overflow-wrap:anywhere/, '版本列需佔滿第二行並可換行');
  assert.match(mobileCss, /\.brand \.ver \.num\{white-space:nowrap\}/, '版本號與完整更新時間不可在數字中斷行');
  assert.match(mobileCss, /\.sticky\{[^}]*top:calc\(var\(--navbar-h\) \+ var\(--safe-t\)\)/, '黏性內容需跟隨行動版頂欄高度');
  const landscapeCss = htmlSource.slice(landscapeStart);
  assert.match(landscapeCss, /:root\{--navbar-h:52px\}/, '短版橫向頂欄高度需為 52px');
  assert.match(landscapeCss, /header\.top\{height:calc\(var\(--navbar-h\) \+ var\(--safe-t\)\)!important\}/, '短版橫向頁首需使用高度變數');
  assert.match(landscapeCss, /\.sticky\{top:calc\(var\(--navbar-h\) \+ var\(--safe-t\)\)!important/, '短版橫向黏性內容需跟隨頁首高度');

  // f. 欄位容器是直向 flex，flex-basis 會變成高度：版本欄位不可用 flex 基準寬
  const rev = htmlSource.match(/<input[^>]*id="placeRev"[^>]*>/)[0];
  assert.doesNotMatch(rev, /flex:/, '#placeRev 不可設定 flex（會變成 90px 高）');

  // g. 登入後主頁的版本資訊在手機標題列換到第二行，並保留 sticky 內容與對話框的頂部偏移
  const mobileSectionStart = at('@media (max-width:600px), (pointer:coarse) and (max-height:500px){');
  const shortStart = at('\n@media (pointer:coarse) and (max-height:500px){');
  const mobile = htmlSource.slice(mobileSectionStart, shortStart);
  const versionRule = mobile.match(/\.brand \.ver\{([^}]*)\}/)?.[1] || '';
  assert.match(mobile, /:root\{--navbar-h:76px\}/, '手機標題列需為版本資訊預留換行高度');
  assert.match(versionRule, /flex:0 0 100%/, '手機版本資訊需獨佔第二行');
  assert.match(versionRule, /white-space:normal/, '手機版本資訊需可換行');
  assert.match(versionRule, /overflow-wrap:anywhere/, '最窄螢幕不可被版本資訊撐出橫向溢出');
  assert.match(mobile, /\.brand \.ver \.num\{white-space:nowrap\}/, '日期時間數值需保持完整，不在日期與時分秒中間斷行');
  assert.doesNotMatch(mobile, /\.brand \.ver\{[^}]*display:none/, '手機主畫面不可隱藏版本資訊');
  assert.match(mobile, /\.sticky\{position:sticky!important;top:calc\(var\(--navbar-h\) \+ var\(--safe-t\)\)!important;/,
    '手機內容 sticky 偏移需跟隨新增的標題列高度');
  const short = htmlSource.slice(shortStart, htmlSource.indexOf('\n}', shortStart));
  assert.match(short, /:root\{--navbar-h:52px\}/, '短螢幕觸控版需使用較緊湊的兩行標題列');
  assert.match(short, /\.sticky\{top:calc\(var\(--navbar-h\) \+ var\(--safe-t\)\)!important\}/,
    '短螢幕觸控版 sticky 偏移需跟隨標題列高度');
});

test('8. 版面回歸：最終發布巡檢（1440／820／390／320 × 明亮／深色）找到的問題', () => {
  // a. LISA 畫布的 CSS 尺寸須固定為容器大小；否則依 getBoundingClientRect 設 width×dpr 會每次進頁面放大 dpr 倍
  const lisa = htmlSource.match(/<canvas[^>]*id="cLISA"[^>]*>/)[0];
  assert.match(lisa, /width:100%/, '#cLISA 需有 CSS width:100%');
  assert.match(lisa, /height:100%/, '#cLISA 需有 CSS height:100%');

  // b. 下拉選單不可因最長選項撐寬欄位（320px 時製程能力與匯入頁橫向溢出）
  assert.match(htmlSource, /\nselect\{max-width:100%\}/, 'select 需有 max-width:100%');
  // 隱式 auto 欄會被內容最小寬度撐開，max-width 單獨無效：分頁與格式說明的 grid 欄寬需為 minmax(0,1fr)
  assert.match(htmlSource, /\n\.panel\{[^}]*grid-template-columns:minmax\(0,1fr\)/, '.panel 欄寬需為 minmax(0,1fr)');
  assert.match(htmlSource, /\n\.vendor\{[^}]*grid-template-columns:minmax\(0,1fr\)/, '.vendor 欄寬需為 minmax(0,1fr)');
  // AI 設定卡：nowrap 的計價基準 chip 會撐開隱式 auto 欄，320px 時整頁寬 350（v10.9.3 巡檢發現）
  assert.match(htmlSource, /<\/small><\/h3><div style="display:grid;grid-template-columns:minmax\(0,1fr\);gap:12px"><div class="row"[^>]*><div[^>]*><span[^>]*>啟用服務商：/, 'AI 設定卡 grid 欄寬需為 minmax(0,1fr)');
  assert.match(htmlSource, /<span class="chip" style="white-space:normal;min-width:0">計價基準：<b id="aiPriceLabel">/, '計價基準 chip 需可換行');

  // c. 觸控時，包住核取方塊／單選鈕的 label.row 熱區需 44px（核取方塊本身只有 24px）
  assert.match(htmlSource, /label\.row:has\(>input\[type=checkbox\]\),label\.row:has\(>input\[type=radio\]\)\{min-height:44px;min-width:44px\}/, '核取方塊 label 需有 44px 觸控高度與寬度');

  // d. 報告預覽固定白紙：行內 var(--ng-soft) 等 token 須在紙張範圍固定為明亮值，深色模式才不會變成深字壓深底
  const paper = htmlSource.match(/\n\.report-preview\{--[^}]*\}/);
  assert.ok(paper, '.report-preview 需在範圍內重新宣告 token');
  for (const t of ['--ink', '--muted', '--line', '--ok-soft', '--warn-soft', '--ng-soft', '--logo-ink']) assert.match(paper[0], new RegExp(`${t}:#`), `.report-preview 需固定 ${t}`);

  // e. 剖面圖例文字用一般字色，系列色只放在符號上（文字直接用系列色時白底對比僅 2.1–2.5）
  const leg = htmlSource.match(/\$\("#csLegend"\)\.innerHTML=`[^`]*`/)[0];
  assert.doesNotMatch(leg, /<span style="color:/, '圖例文字不可直接套系列色');
});

test('8f. 色彩回歸：手動深色 LISA 與剖面圖例、畫線共用色彩 token', () => {
  const manualDark = htmlSource.match(/:root\[data-theme="dark"\]\{([^}]*)\}/)?.[1];
  assert.ok(manualDark, '需有手動深色主題 token 區');
  for (const [name, value] of [["--lisa-hh", "#F87171"], ["--lisa-ll", "#60A5FA"], ["--lisa-lh", "#BAE6FD"],
    ["--lisa-hl", "#FB923C"], ["--lisa-ns", "#64748B"]])
    assert.match(manualDark, new RegExp(`${name}:${value};`), `手動深色主題須定義 ${name}`);

  const root = htmlSource.match(/:root\{([^}]*)\}/)?.[1] || '';
  const profileTokens = ["--cs-baseline", "--cs-aperture", "--cs-stencil", "--cs-target", "--cs-limit", "--cs-substrate", "--cs-paste", "--cs-label"];
  for (const name of profileTokens) assert.match(root, new RegExp(`${name}:`), `需定義截面色彩 token ${name}`);

  const drawStart = htmlSource.indexOf('function drawCrossSectionProfile(r)');
  const drawEnd = htmlSource.indexOf('\nfunction selectPadForProfile(r)', drawStart);
  assert.ok(drawStart >= 0 && drawEnd > drawStart, '需能定位剖面繪圖函式');
  const draw = htmlSource.slice(drawStart, drawEnd);
  const legend = htmlSource.match(/\$\("#csLegend"\)\.innerHTML=`([^`]*)`/)?.[1] || '';
  for (const name of profileTokens.filter(name => name !== "--cs-label")) {
    assert.match(draw, new RegExp(`css\\("${name}"\\)`), `剖面畫線需使用 ${name}`);
    assert.match(legend, new RegExp(name), `剖面圖例需使用 ${name}`);
  }
  assert.match(draw, /css\("--cs-label"\)/, '空狀態文字需使用主題相容的文字 token');
});

test('9. 版面回歸：code review（v10.3.3）找到的問題', () => {
  const at = (s) => { const i = htmlSource.indexOf(s); assert.ok(i >= 0, `找不到 CSS：${s}`); return i; };

  // a. 桌機／平板的分析設定列：#railSheet 帶 hidden，全域 [hidden]{display:none!important} 會蓋過不帶 !important 的
  //    display:contents，1440／1024／820 時試產回合、量測項目、元件群組、管制圖選單全部寬度 0（v9.11.0 起）
  assert.match(htmlSource, /<div class="rail-sheet-modal" id="railSheet"[^>]*\shidden>/, '#railSheet 仍以 hidden 供手機收合');
  const desk = at('.rail-sheet-modal,.rail-sheet-modal[hidden]{display:contents!important}');
  const phone = at('@media (max-width:600px), (pointer:coarse) and (max-height:500px){');
  assert.ok(at('[hidden]{display:none!important}') < desk, '桌機 rail 規則需排在全域 [hidden] 之後');
  assert.ok(desk < phone, '桌機 rail 規則需在手機 media 區塊之外');
  assert.ok(at('.rail-sheet-modal:not(.open){display:none!important}') > phone, '手機收合規則需在手機 media 區塊內、排在桌機規則之後');

  // b. 未定義且無 fallback 的 CSS 變數整條宣告無效（錯誤提示與階梯未涵蓋警示不顯示紅色）
  const used = new Set([...htmlSource.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
  const defined = new Set([...htmlSource.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  assert.deepEqual([...used].filter((v) => !defined.has(v)), [], '每個 var(--x) 都需有定義');

  // c. 階梯鋼板區域表的選取單選鈕觸控時只有 24px：包進 label.row 取得 44px 熱區
  assert.match(htmlSource, /<td><label class="row"><input type="radio" name="selZone"/, '區域選取單選鈕需包在 label.row 內');
  assert.match(htmlSource, /--fs-input:\s*16px;/i, '需定義 --fs-input:16px');
  assert.match(htmlSource, /input\[type=password\]\{min-height:44px;min-width:44px;font-size:var\(--fs-input\)!important\}/, '密碼欄位需在觸控 44px 與 --fs-input 防縮放規則內');
  assert.match(htmlSource, /return\{g,group:g,padDim,apDim,st:stLvl/, 'dfmTable0 需提供報告頁所需欄位別名');
  // 檢查可用模型：結果綁定服務商＋金鑰＋端點；回應時以最新設定為準，設定已變更就不套用（PR #81 review）
  assert.match(htmlSource, /availableModels=\{sig,models:j\.models\}/, '可用模型清單需綁定查詢簽章');
  assert.match(htmlSource, /av\.sig===aiModelSig\(act,pCfg\)\?av\.models:null/, '金鑰或端點變更後不可再套用舊清單');
  assert.match(htmlSource, /const cur=snapshotAiInputsToCfg\(loadAiCfg\(\)\),curP=cur\.providers\[act\];\r?\n\s*if\(cur\.activeProvider!==act\|\|aiModelSig\(act,curP\)!==sig\)/, '回應時需比對最新設定');
  for (const id of ['aiProviderSeg', 'inAiKey', 'inAiKeyAntigravity', 'selAiModel', 'btnAiCheckModels', 'inAiCustomModel', 'selAiEffort', 'inAiCustomEndpoint']) {
    assert.match(htmlSource, new RegExp('id="' + id + '"'), 'AI 設定介面需有 #' + id);
  }
});

test('10. 問題地圖列限制在容器內', () => {
  const groupRule = htmlSource.match(/\.pmap-cells\.pmap-groups\{[^}]*\}/)?.[0];
  assert.ok(groupRule, '元件群組需有獨立格線規則');
  assert.match(groupRule, /grid-auto-flow:\s*row/, '桌機與平板元件群組需逐列填入格線');
  assert.match(groupRule, /grid-template-columns:\s*repeat\(auto-fill,minmax\(44px,1fr\)\)/, '元件群組欄數需依容器寬度換行');
  assert.match(htmlSource, /class="pmap-cells pmap-groups"/, '元件群組需套用獨立格線樣式');

  const mobileRules = htmlSource.match(/@media \(max-width:720px\)\{\r?\n([\s\S]*?)\r?\n\}/)?.[1];
  assert.ok(mobileRules, '需有可定位的窄螢幕問題地圖規則');
  assert.match(mobileRules, /\.pmap-cells\.pmap-boards\{[^}]*grid-auto-flow:\s*row/, '窄螢幕各板格需逐列換行，避免撐開頁面');
  assert.match(mobileRules, /\.pmap-cells\.pmap-groups\{[^}]*display:flex;[^}]*overflow-x:auto/, '窄螢幕元件群組需保留容器內橫向捲動');
});

test("已解析匯入預覽的 grid 欄不得由內容撐寬", () => {
  assert.match(htmlSource, /#mapBox\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(htmlSource, /#mapBox>\*\{min-width:0\}/);
});
