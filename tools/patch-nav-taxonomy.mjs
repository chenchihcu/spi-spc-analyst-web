/**
 * One-shot HTML patch for nav taxonomy (RFC-SPI-NAV-TAXONOMY).
 * Run: node tools/patch-nav-taxonomy.mjs
 * Idempotent: skips if already patched (marker comment present).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, "..", "spi-spc.html");
let html = fs.readFileSync(htmlPath, "utf8");

if (html.includes("<!-- NAV-TAXONOMY-APPLIED -->")) {
  console.log("Already patched");
  process.exit(0);
}

function sliceBetween(start, endMark, from = 0) {
  const i = html.indexOf(start, from);
  const j = html.indexOf(endMark, i + start.length);
  if (i < 0 || j < 0) throw new Error(`Missing block: ${start.slice(0, 40)}`);
  return { start: i, end: j, inner: html.slice(i + start.length, j) };
}

// --- Tab labels (full </button> — never truncate to "</") ---
html = html.replace(/data-tab="deep">深入分析<\/button>/, 'data-tab="deep">製程跡象</button>');
html = html.replace(/data-tab="improve">改善<\/button>/, 'data-tab="improve">比較與行動</button>');
html = html.replace(/data-tab="ai">AI 分析<\/button>/, 'data-tab="ai">AI 診斷</button>');
html = html.replace(/id="btnAI">產生分析報告<\/button>/, 'id="btnAI">產生診斷</button>');
html = html.replace(/3D 微觀形貌特徵指標/, "形貌指標");
html = html.replace(
  /title="鋼板厚度與規格在「資料與規格 → 設定」修改"/,
  'title="鋼板厚度與規格在「資料與規格 → 規格」修改"'
);
html = html.replace(
  /data-subnav-improve="compare">試產比較<\/button>/,
  'data-subnav-improve="compare">回合比較</button>'
);
html = html.replace(/data-subnav-improve="dfm">DFM 建議<\/button>/, 'data-subnav-improve="dfm">設計改善</button>');

html = html.replace(
  /\.deep-subviews,\.improve-subviews\{grid-template-columns:minmax\(0,1fr\)\}/,
  ".deep-subviews,.improve-subviews,.issues-subviews,.control-subviews{grid-template-columns:minmax(0,1fr)}"
);
html = html.replace(
  /\.deep-subviews>\[data-subview\],\.improve-subviews>\[data-subview\]\{min-width:0\}/,
  ".deep-subviews>[data-subview],.improve-subviews>[data-subview],.issues-subviews>[data-issues-sub],.control-subviews>[data-control-sub]{min-width:0}"
);

const chartFields = `        <div class="field" data-scope="c"><label for="selChart">管制圖</label>
          <select id="selChart">
            <option value="xbars">X̄-S（每板為子群組）</option>
            <option value="xbarr">X̄-R（自訂小子群組 n=2–10）</option>
            <option value="imr">I-MR（單一焊墊跨板）</option>
            <option value="p">P′ 圖（每板不良率，Laney）</option>
            <option value="ewma">EWMA（小幅漂移）</option>
            <option value="cusum">CUSUM（累積偏移）</option>
          </select></div>
        <div class="field" id="xrSizeField" data-scope="c" hidden><label for="selXrSize">子群組大小 n</label>
          <select id="selXrSize">
            <option value="2">n = 2</option>
            <option value="3">n = 3</option>
            <option value="4" selected>n = 4</option>
            <option value="5">n = 5</option>
            <option value="6">n = 6</option>
            <option value="7">n = 7</option>
            <option value="8">n = 8</option>
            <option value="9">n = 9</option>
            <option value="10">n = 10</option>
          </select></div>
        <div class="field" id="xrModeField" data-scope="c" hidden><label for="selXrMode">劃分方式</label>
          <select id="selXrMode">
            <option value="board" selected>同板依序 n 個</option>
            <option value="pad">同一焊墊連續 n 片板</option>
          </select></div>
        <div class="field" id="padField" data-scope="c" hidden><label for="selPad">焊墊</label><select id="selPad"></select></div>`;

html = html.replace(
  /\s*<div class="field" data-scope="a"><label for="selChart">管制圖<\/label>[\s\S]*?<div class="field" id="padField" data-scope="a" hidden><label for="selPad">焊墊<\/label><select id="selPad"><\/select><\/div>\s*/,
  "\n"
);

const crossStart = '<div data-subview="cross">';
const advStart = '<div data-subview="adv" hidden>';
const { inner: crossBlock } = sliceBetween(crossStart, advStart);

const t2Open = html.lastIndexOf('<div class="card">', html.indexOf("<h3>多變量 Hotelling T²"));
const cpkStart = html.indexOf('<div class="card"><h3>焊墊 Cpk 排行');
const t2Block = html.slice(t2Open, cpkStart).trimEnd();

const corrStart = html.indexOf('<div class="card"><h3>量測項目相關矩陣');
const cpkBlock = html.slice(cpkStart, corrStart).trim();

const sidedStart = html.indexOf('<div class="card" id="sidedPpmCard">');
const improveAt = html.indexOf('<section class="panel" id="p-improve"', sidedStart);
if (sidedStart < 0 || improveAt < 0) throw new Error("sided ppm block");
let sidedEnd = sidedStart;
let depth = 0;
for (let p = sidedStart; p < improveAt; p++) {
  if (html.startsWith("<div", p)) depth++;
  if (html.startsWith("</div>", p)) {
    depth--;
    if (depth === 0) {
      sidedEnd = p + 6;
      break;
    }
  }
}
const sidedBlock = html.slice(sidedStart, sidedEnd).trim();

// deep flat body: adv (minus t2, cpk) + stats (minus sided)
const advInnerStart = html.indexOf(advStart) + advStart.length;
const advInnerEnd = html.indexOf('<div data-subview="stats" hidden>', advInnerStart);
let advBody = html.slice(advInnerStart, advInnerEnd);
advBody = advBody.replace(t2Block, "");
advBody = advBody.replace(cpkBlock, "");

const statsInnerStart = html.indexOf('<div data-subview="stats" hidden>') + '<div data-subview="stats" hidden>'.length;
const statsSidedAt = html.indexOf('<div class="card" id="sidedPpmCard">', statsInnerStart);
if (statsSidedAt < 0) throw new Error("stats/sided");
let statsBody = html.slice(statsInnerStart, statsSidedAt).trim();
statsBody = statsBody.replace(/<\/div>\s*$/, "").trim();

const deepNew = `<section class="panel" id="p-deep" role="tabpanel" hidden>
  <div class="deep-body" style="display:grid;gap:12px;grid-template-columns:minmax(0,1fr);min-width:0">
${advBody}
${statsBody}
  </div>
</section>

`;

html = html.replace(
  /<section class="panel" id="p-deep" role="tabpanel" hidden>[\s\S]*?<\/section>\r?\n\r?\n<section class="panel" id="p-improve"/,
  deepNew + '<section class="panel" id="p-improve"'
);

// p-issues: add subnav and cross pane
const issuesMatch = html.match(
  /<section class="panel" id="p-issues" role="tabpanel">([\s\S]*?)<\/section>\r?\n\r?\n<section class="panel" id="p-overview"/
);
if (!issuesMatch) throw new Error("p-issues");
const listBody = issuesMatch[1];

const issuesNew = `<section class="panel" id="p-issues" role="tabpanel">
  <nav class="panel-subnav" aria-label="問題偵測子視圖">
    <button type="button" data-subnav-issues="list" aria-current="page">問題清單</button>
    <button type="button" data-subnav-issues="cross">交叉驗證</button>
  </nav>
  <div class="issues-subviews" style="display:grid;gap:12px">
    <div data-issues-sub="list">
${listBody}    </div>
    <div data-issues-sub="cross" hidden>
${crossBlock}
    </div>
  </div>
</section>

<section class="panel" id="p-overview"`;
html = html.replace(
  /<section class="panel" id="p-issues" role="tabpanel">[\s\S]*?<\/section>\r?\n\r?\n<section class="panel" id="p-overview"/,
  issuesNew
);

const controlMatch = html.match(
  /<section class="panel" id="p-control" role="tabpanel" hidden>([\s\S]*?)<\/section>\r?\n\r?\n<section class="panel" id="p-capability"/
);
if (!controlMatch) throw new Error("p-control");
const uniBody = controlMatch[1];

const controlNew = `<section class="panel" id="p-control" role="tabpanel" hidden>
  <nav class="panel-subnav" aria-label="管制圖子視圖">
    <button type="button" data-subnav-control="uni" aria-current="page">單變量</button>
    <button type="button" data-subnav-control="multi">多變量</button>
  </nav>
  <div class="control-subviews" style="display:grid;gap:12px">
    <div data-control-sub="uni">
      <div class="card" style="margin-bottom:12px">
        <div class="rail-fields" style="flex-wrap:wrap;gap:10px 16px;align-items:flex-end;display:flex">
${chartFields}
        </div>
      </div>
${uniBody}    </div>
    <div data-control-sub="multi" hidden>
${t2Block}
    </div>
  </div>
</section>

<section class="panel" id="p-capability"`;
html = html.replace(
  /<section class="panel" id="p-control" role="tabpanel" hidden>[\s\S]*?<\/section>\r?\n\r?\n<section class="panel" id="p-capability"/,
  controlNew
);

html = html.replace(
  /(<section class="panel" id="p-capability" role="tabpanel" hidden>[\s\S]*?)(<\/section>\r?\n\r?\n<section class="panel" id="p-sim3d")/,
  `$1\n  ${cpkBlock}\n  ${sidedBlock}\n$2`
);

html = html.replace(
  /<button role="tab" class="subtab" data-sub="settings"[^>]*>設定<\/button>/,
  '<button role="tab" class="subtab" data-sub="settings" aria-selected="false">規格</button>'
);

const uiStart = html.indexOf('<div class="card" id="settingsUiSection">');
const uiEnd = html.indexOf('<div class="card" id="settingsAnchorSpec">', uiStart);
const uiHtml = html.slice(uiStart, uiEnd).trim();

const aiStart = html.indexOf('<div class="card" id="aiSettingsCard">');
const aiEnd = html.indexOf('<div class="grid2" data-sub="runs"', aiStart);
const aiHtml = html.slice(aiStart, aiEnd).trim();

html = html.slice(0, uiStart) + html.slice(uiEnd);
const aiStart2 = html.indexOf('<div class="card" id="aiSettingsCard">');
const aiEnd2 = html.indexOf('<div class="grid2" data-sub="runs"', aiStart2);
html = html.slice(0, aiStart2) + html.slice(aiEnd2);

const settingsModal = `
<!-- NAV-TAXONOMY-APPLIED -->
<div class="db-modal" id="appSettingsModal" role="dialog" aria-modal="true" aria-label="介面與 AI 服務設定" hidden>
  <div class="db-modal-panel" style="max-width:920px;max-height:90vh;display:flex;flex-direction:column">
    <div class="sheet-head" style="padding:14px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;background:var(--surface)">
      <h3 style="margin:0;font-size:var(--fs-heading)">介面與 AI 服務</h3>
      <button type="button" class="sheet-close" id="appSettingsClose" aria-label="關閉設定">✕</button>
    </div>
    <div style="padding:14px 18px;background:var(--surface);display:grid;gap:16px;overflow-y:auto;flex:1 1 auto;grid-template-columns:minmax(0,1fr)">
${uiHtml}
${aiHtml}
    </div>
    <div class="sheet-foot" style="padding:10px 18px;border-top:1px solid var(--line);display:flex;justify-content:flex-end;background:var(--surface2)">
      <button type="button" class="primary" id="appSettingsDone">完成</button>
    </div>
  </div>
</div>
`;

html = html.replace("<!-- 量測記錄與座標檔資料庫選取載入中樞 -->", settingsModal + "\n<!-- 量測記錄與座標檔資料庫選取載入中樞 -->");

html = html.replace(
  /<button role="menuitem" class="duo-toggle-btn"/,
  '<button role="menuitem" type="button" id="btnOpenUiSettings">介面</button>\n        <button role="menuitem" type="button" id="btnOpenAiSettings">AI 服務</button>\n        <button role="menuitem" class="duo-toggle-btn"'
);

const sheetContentRe = /<div class="sheet-content">[\s\S]*?<div class="sheet-ver-info">/;
const newSheet = `<div class="sheet-content">
      <div class="sheet-sec-title">其餘分析</div>
      <div class="sheet-list">
        <button type="button" class="sheet-row" data-mtab="sim3d"><span>3D 錫膏模擬</span><span class="sheet-arrow">›</span></button>
        <button type="button" class="sheet-row" data-mtab="deep"><span>製程跡象</span><span class="sheet-arrow">›</span></button>
        <button type="button" class="sheet-row" data-mtab="improve" data-mtab-sub="compare"><span>回合比較</span><span class="sheet-arrow">›</span></button>
        <button type="button" class="sheet-row" data-mtab="improve" data-mtab-sub="dfm"><span>設計改善</span><span class="sheet-arrow">›</span></button>
        <button type="button" class="sheet-row" data-mtab="improve" data-mtab-sub="lab"><span>實驗驗證</span><span class="sheet-arrow">›</span></button>
      </div>

      <div class="sheet-sec-title">診斷與交付</div>
      <div class="sheet-list">
        <button type="button" class="sheet-row" data-mtab="ai"><span>AI 診斷</span><span class="sheet-arrow">›</span></button>
        <button type="button" class="sheet-row" data-mtab="report"><span>分析報告</span><span class="sheet-arrow">›</span></button>
      </div>

      <div class="sheet-sec-title">資料</div>
      <div class="sheet-list">
        <button type="button" class="sheet-row" id="mBtnOpenRecModal"><span style="display:inline-flex;align-items:center;gap:8px"><svg class="ui-ico ui-ico--folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>記錄庫</span><span class="sheet-arrow">›</span></button>
        <button type="button" class="sheet-row" id="mBtnOpenExportModal"><span style="display:inline-flex;align-items:center;gap:8px"><svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:18px;height:18px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>匯出</span><span class="sheet-arrow">›</span></button>
        <button type="button" class="sheet-row" data-mtab="data"><span>資料與規格</span><span class="sheet-arrow">›</span></button>
      </div>

      <div class="sheet-sec-title">操作與帳號</div>
      <div class="sheet-list" id="sheetUserTools">
        <button type="button" class="sheet-row" id="mBtnUiSettings"><span>介面</span><span class="sheet-arrow">›</span></button>
        <button type="button" class="sheet-row" id="mBtnAiSettings"><span>AI 服務</span><span class="sheet-arrow">›</span></button>
        <button type="button" class="sheet-row duo-toggle-btn" id="mBtnDuo"><span>雙欄模式</span><span class="sheet-arrow">›</span></button>
        <button type="button" class="sheet-row" id="mBtnShare" hidden><span>分享連結</span><span class="sheet-arrow">›</span></button>
        <button type="button" class="sheet-row" id="mBtnMyShares" hidden><span>我的分享</span><span class="sheet-arrow">›</span></button>
        <a class="sheet-row" id="mLogoutLink" href="/__logout" hidden><span>登出</span><span class="sheet-arrow">›</span></a>
      </div>

      <div class="sheet-ver-info">`;
html = html.replace(sheetContentRe, newSheet);

// Export center regroup
const aiMdCard = html.match(
  /<div class="exp-item-card">[\s\S]*?data-type="ai-md"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/
)?.[0];
if (aiMdCard) {
  html = html.replace(aiMdCard + "\n\n", "");
  html = html.replace(
    /<!-- 分類卡片 2: 製程改善與工程分析 -->/,
    `<!-- 分類卡片 1b: 診斷 -->
      <div class="export-group-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <b style="font-size:var(--fs-ui);color:var(--ink)">診斷</b>
        </div>
        <div class="export-items-grid">
${aiMdCard}
        </div>
      </div>

      <!-- 分類卡片 2: 問題與管制清單 -->`
  );
}
html = html.replace(/管理與決策層/g, "報告");
html = html.replace(/製程改善與工程分析/g, "問題與管制清單");
html = html.replace(/鋼板設計與 Layout/g, "比較與改善");
html = html.replace(/<!-- 分類卡片 3: 鋼板設計與 Layout -->/, "<!-- 分類卡片 3: 比較與改善 -->");

// Move snap-3d to 板面快照 - find group 4 if exists
const htmlClose = html.indexOf("</html>");
if (htmlClose < 0) throw new Error("missing </html>");
const after = html.slice(htmlClose + 7).trim();
if (after) throw new Error("content after </html>: " + after.slice(0, 80));
const improveCount = (html.match(/id="p-improve"/g) || []).length;
if (improveCount !== 1) throw new Error(`p-improve count ${improveCount}`);
const sidedCount = (html.match(/id="sidedPpmCard"/g) || []).length;
if (sidedCount !== 1) throw new Error(`sidedPpmCard count ${sidedCount}`);

fs.writeFileSync(htmlPath, html.slice(0, htmlClose + 7) + "\n");
console.log("Patched", htmlPath);
