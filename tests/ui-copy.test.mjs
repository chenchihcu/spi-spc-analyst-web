import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "spi-spc.html"), "utf8");

const forbidden = [
  "Executive Summary",
  "Closed-Loop Correction",
  "Pass/Fail)",
  "(OOC)",
  "(Shift)",
  "(Drift)",
  "Bridge Margin",
  "<summary>怎麼看</summary>",
  "<summary>偵測邏輯</summary>",
  "<summary>怎麼用</summary>",
  "<summary>判定方式</summary>",
  "<summary>風險分數怎麼算</summary>",
  "<summary>怎麼設定</summary>",
  'label:"體積 Volume"',
  "Reasoning Effort",
  "高 (high)",
  "Executive &",
  "Process &",
  "Stencil &",
  "批號 (Lot)",
  "面別 (Side)",
  "版本 (Rev)",
  "收件人 (To)",
  "副本 (Cc)",
  "本版尚未提供（規劃中）",
  "解讀：X̄ 圖看",
  "主題：明亮（切換深色）",
  "主題：深色（切換明亮）",
  "下載 3D 圖",
  "下載已勾選項目",
  "列印／存成 PDF",
  "常態機率圖 Q-Q",
  "高度 × 面積 散佈",
  "一鍵下載標準交付包",
  "問題偵測自動掃描全部量測項目與元件群組，不需要選擇。",
];

// 本檔只擋已知禁用字串。通過之後仍依 AGENTS.md 文案條刪掉不改變判讀的靜態標籤。
test("spi-spc.html 不含禁用教學段與英文譯名", () => {
  for (const needle of forbidden) {
    assert.equal(
      html.includes(needle),
      false,
      `不應出現：${needle}`
    );
  }
});

test("spi-spc.html 保留功能型折疊", () => {
  assert.match(html, /id="aiPayloadDetails"/);
  assert.match(html, /id="recAuditBox"/);
  assert.match(html, /<summary>預覽送出內容<\/summary>/);
});

test("規格鋼板控制項唯一且分屬鋼板／錫膏印刷規格子頁；關係圖不含已拒絕圖種", () => {
  const stencilAt = html.indexOf('<div data-sub="stencil-spec"'), pasteAt = html.indexOf('<div data-sub="paste-spec"'), runsAt = html.indexOf('<div data-sub="runs"');
  assert.ok(stencilAt > 0 && pasteAt > stencilAt && runsAt > pasteAt, "鋼板規格設定、錫膏印刷規格設定應依序在回合管理之前");
  const stencilPane = html.slice(stencilAt, pasteAt), settings = html.slice(stencilAt, runsAt);
  for (const id of ["chkStep", "apTbl", "zoneMap", "inStencil2"]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `#${id} 應只出現一次`);
    assert.match(stencilPane, new RegExp(`id="${id}"`), `#${id} 應位於鋼板規格設定`);
  }
  assert.equal(html.includes('data-sub="settings"'), false, "不應再留合併的規格子分頁");
  assert.equal(html.includes("資料與規格 → 規格設定"), false, "文案不應再指向舊的規格設定子頁");
  const appSettings = html.slice(html.indexOf('id="appSettingsModal"'), html.indexOf("<!-- 量測記錄"));
  for (const id of ["aiSettingsCard", "btnThemeSettings", "settingsUiSection"]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `#${id} 應只出現一次`);
    assert.match(appSettings, new RegExp(`id="${id}"`), `#${id} 應位於介面與 AI 設定對話框`);
  }
  assert.doesNotMatch(html.slice(0, html.indexOf('id="appSettingsModal"')), /id="aiSettingsCard"/, "資料頁不應再內嵌 AI 設定卡");
  assert.equal(html.includes('data-sub="stencil"'), false, "不應再留獨立鋼板子分頁");
  assert.equal(html.includes('data-sub="specs"'), false, "不應再留獨立規格子分頁");
  assert.equal(html.includes('data-sub="ai-cfg"'), false, "不應再留獨立 AI 子分頁");
  assert.doesNotMatch(settings, /id="runTbl"/);
  const rel = html.match(/<select id="selRelChart">([\s\S]*?)<\/select>/);
  assert.ok(rel, "應有關係圖下拉");
  assert.deepEqual([...rel[1].matchAll(/value="([^"]+)"/g)].map((m) => m[1]), ["specScatter", "parallel", "radar"]);
  const notice = html.match(/<details class="how" id="aiNoticeDetails">([\s\S]*?)<\/details>/);
  assert.ok(notice && !/\sopen[\s>]/.test(notice[0].slice(0, notice[0].indexOf(">"))), "送出範圍預設收合");
  assert.match(notice[1], /<summary>查看送出範圍與記錄方式<\/summary>/);
  const display = html.match(/<details class="how" id="sim3dDisplayOpts">([\s\S]*?)<\/details>/);
  assert.ok(display && !/\sopen[\s>]/.test(display[0].slice(0, display[0].indexOf(">"))));
  for (const id of ["inExag", "chkGhost", "chkBridgeWarn"]) assert.match(display[1], new RegExp(`id="${id}"`));
  for (const id of ["btnPhme", "btnAddB", "btnSample", "btnAoiSample", "btnDoeSample", "btnGrrSample"]) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > 0, `#${id} 仍須存在`);
    const open = html.lastIndexOf("<details", at);
    const block = html.slice(open, html.indexOf("</details>", at));
    assert.match(block, /<summary>範例資料<\/summary>/);
    assert.equal(/\sopen[\s>]/.test(block.slice(0, block.indexOf(">"))), false);
  }
});

test("UI 整併後共用對話框存在且重複舊對話框與重複匯出按鈕已移除", () => {
  for (const id of ["confirmModal", "proofModal", "recEditModal", "uploadRefModal", "recAdjudicateModal", "exportGroupsHost"]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `共用元件 #${id} 應唯一存在`);
  }
  for (const legacy of [
    "btnRepPdf", "btnMailDlPdf", "specConfirmModal", "recDeleteModal", "recConfirmModal",
    "recBatchConfirmModal", "unmatchedRefsModal", "recRenameModal", "uploadPlaceModal",
    "uploadLayoutModal", "recNewBatchModal", "recCorrectModal"
  ]) {
    assert.equal(html.includes(`id="${legacy}"`), false, `已整併或移除之舊 ID #${legacy} 不應殘留`);
  }
  assert.equal(html.includes("panel-subnav"), false, "舊子分頁樣式 .panel-subnav 應統一為 .subtabs/.subtab");
});
