import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import jsdom from "jsdom";

const require = createRequire(import.meta.url);
const { withIdb } = require("./_load.js");
const { JSDOM, VirtualConsole } = jsdom;
const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, "..", "spi-spc.html");

test("整合資料上傳入口與下載出口介面結構與互動契約驗證", async () => {
  const rawHtml = fs.readFileSync(HTML_PATH, "utf8");
  // 濾除外部第三方大型腳本，加速 JSDOM 初始化
  const strippedHtml = rawHtml.replace(/<script src=[^>]+><\/script>/g, "");

  const virtualConsole = new VirtualConsole();
  virtualConsole.on("error", err => {
    // 忽略 JSDOM 無法解析的 CSS 或 WebGL 錯誤
    if (err && String(err).includes("WebGL")) return;
  });

  const dom = new JSDOM(strippedHtml, {
    url: "https://spi-spc.test/",
    runScripts: "dangerously",
    resources: "usable",
    virtualConsole,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
      Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { let e = this; while (e) { if (e.hidden) return null; e = e.parentElement; } return w.document.body; } });
      w.Element.prototype.scrollIntoView = () => {};
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} };
      w.scrollTo = () => {};
      w.Chart = class { constructor(_c, cfg) { if (!cfg || !cfg.data) throw new Error("圖表設定錯誤"); } destroy() {} static register() {} };
      w.claude = { use: async (n) => (n === "downloads" ? { save: async () => {} } : null) };
      withIdb(w);
      w.SPI_TEST_HOOK = {};
    }
  });

  const { window } = dom;
  const { document } = window;

  // 等待初始化完成
  await new Promise(r => setTimeout(r, 200));

  // 1. 頂欄 Header 與呼叫入口檢驗
  const btnOpenExportModal = document.getElementById("btnOpenExportModal");
  assert.ok(btnOpenExportModal, "頂端導覽列應存在 #btnOpenExportModal 按鈕");
  assert.ok(btnOpenExportModal.textContent.includes("匯出"), "按鈕文字應包含「匯出」");

  const mBtnOpenExportModal = document.getElementById("mBtnOpenExportModal");
  assert.ok(mBtnOpenExportModal, "手機端更多抽屜中應存在 #mBtnOpenExportModal 按鈕");

  const btnHubExport = document.getElementById("btnHubExport");
  assert.ok(btnHubExport, "分析報告分頁中應存在 #btnHubExport 匯出中心捷徑");

  // 2. 上傳資料入口 (subtab=import) 三段式卡片檢驗
  const importPanel = document.querySelector('[data-sub="import"]');
  assert.ok(importPanel, "資料與規格分頁應包含 [data-sub=\"import\"] 容器");

  // 卡片 1: 主要 SPI 量測
  const dropZone = document.getElementById("drop");
  const fileIn = document.getElementById("fileIn");
  const selVendor = document.getElementById("selVendor");
  const selSide = document.getElementById("selSide");
  const inPart = document.getElementById("inPart");
  const inRev = document.getElementById("inRev");
  const btnApply = document.getElementById("btnApply");
  assert.ok(dropZone && fileIn, "卡片 1 應包含 SPI 檔案拖放區與檔案輸入");
  assert.ok(selVendor && selSide, "卡片 1 應包含加工廠格式與面別選單");
  assert.ok(inPart && inRev && btnApply, "卡片 1 應包含料號、版次與套用按鈕");

  // 卡片 2: CAD 受控座標
  const placeRow = document.getElementById("placeRow");
  const btnSelectPlace = document.getElementById("btnSelectPlace");
  const placeState = document.getElementById("placeState");
  assert.ok(placeRow, "應包含 CAD 受控座標區塊 #placeRow");
  assert.ok(btnSelectPlace, "CAD 座標區塊應包含從資料庫選取按鈕 #btnSelectPlace");
  assert.ok(placeState, "CAD 座標區塊應顯示座標狀態 #placeState");
  assert.ok(document.getElementById("upPlaceFile"), "記錄庫視窗應提供受控座標上傳 #upPlaceFile");

  // 輔助工程資料改置於改善／實驗驗證子視圖與規格頁
  const aoiFile = document.getElementById("aoiFile");
  const grrFile = document.getElementById("grrFile");
  const geomPadFile = document.getElementById("geomPadFile");
  assert.ok(aoiFile, "實驗驗證子視圖應提供 AOI 檔案上傳");
  assert.ok(grrFile, "實驗驗證子視圖應提供 GR&R 檔案上傳");
  assert.ok(geomPadFile, "規格頁應提供幾何焊墊清單上傳");

  // 3. 下載出口介面 (#exportCenterModal) 檢驗
  const exportModal = document.getElementById("exportCenterModal");
  assert.ok(exportModal, "應存在全域匯出交付中心視窗 #exportCenterModal");
  assert.equal(exportModal.getAttribute("role"), "dialog", "模態視窗 role 應為 dialog");
  assert.equal(exportModal.getAttribute("aria-modal"), "true", "模態視窗 aria-modal 應為 true");

  // 驗證三大角色分組
  const groupCards = exportModal.querySelectorAll(".export-group-card");
  assert.ok(groupCards.length >= 3, "匯出中心應至少包含 3 大角色分類卡片");

  // 驗證交付項目核取方塊與下載動作按鈕
  const itemCheckboxes = exportModal.querySelectorAll(".exp-item-chk");
  assert.ok(itemCheckboxes.length >= 12, "匯出中心應至少提供 12 項可勾選交付物");

  const standardBundleBtn = document.getElementById("btnDownloadStandardBundle");
  assert.ok(standardBundleBtn, "應提供「一鍵下載標準交付包」按鈕");

  const chkSelectAll = document.getElementById("chkExportSelectAll");
  assert.ok(chkSelectAll, "應提供「全選所有項目」核取方塊");

  const btnDlSelected = document.getElementById("btnDownloadSelected");
  assert.ok(btnDlSelected, "應提供「下載已勾選項目」按鈕");

  // 4. 模態視窗開關互動契約
  assert.ok(exportModal.hidden, "開機時匯出中心應為隱藏");
  btnOpenExportModal.click();
  assert.equal(exportModal.hidden, false, "點擊頂欄匯出按鈕後應顯示視窗");
  assert.ok(exportModal.classList.contains("open"), "視窗應包含 .open class");

  const closeBtn = document.getElementById("exportCenterClose");
  assert.ok(closeBtn, "應包含關閉按鈕");
  closeBtn.click();
  assert.equal(exportModal.hidden, true, "點擊關閉按鈕後視窗應隱藏");

  // 手機版按鈕與報告頁按鈕亦能開啟
  mBtnOpenExportModal.click();
  assert.equal(exportModal.hidden, false, "點擊手機更多抽屜匯出按鈕應顯示視窗");
  const closeBottomBtn = document.getElementById("btnExportCenterCloseBottom");
  assert.ok(closeBottomBtn, "應存在底部完成關閉按鈕");
  closeBottomBtn.click();
  assert.equal(exportModal.hidden, true, "點擊底部完成按鈕後視窗應隱藏");

  btnHubExport.click();
  assert.equal(exportModal.hidden, false, "點擊分析報告分頁捷徑按鈕應顯示視窗");

  // 5. 批次全選與計數連動契約
  chkSelectAll.click();
  const allChecked = Array.from(itemCheckboxes).every(c => c.checked);
  assert.ok(allChecked, "點擊全選後所有核取方塊皆應勾選");
  const countEl = document.getElementById("exportSelectedCount");
  assert.equal(countEl.textContent, String(itemCheckboxes.length), "勾選計數應與總項目數一致");

  chkSelectAll.click();
  const noneChecked = Array.from(itemCheckboxes).every(c => !c.checked);
  assert.ok(noneChecked, "取消全選後所有核取方塊皆應取消");
  assert.equal(countEl.textContent, "0", "取消全選後計數應為 0");

  closeBtn.click();

  // 6. 既有分頁行內單項匯出按鈕完整性契約 (維護既有使用者肌肉記憶)
  const legacyButtons = [
    "btnStatsCsv",
    "btnExportCorrectionJson",
    "btnRepPdf", "btnExpDef"
  ];
  legacyButtons.forEach(btnId => {
    const el = document.getElementById(btnId);
    assert.ok(el, `既有行內匯出按鈕 #${btnId} 應被完整保留，不可被刪除`);
  });
  for (const type of ["rep-md", "iss-csv", "iss-xlsx", "rep-pdf", "snap-3d", "cmp-md", "dfm-csv", "dfm-md"]) {
    assert.ok(document.querySelector(`[data-exp-act="${type}"]`), `匯出中心應支援 ${type}`);
  }
});
