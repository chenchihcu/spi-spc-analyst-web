# RFC：SPI·SPC 分析台 UI/UX 與前端架構深度去重與整合

- **文件編號**：RFC-SPI-UI-CODE-CONSOLIDATION-20261115
- **狀態**：已核准實作（Approved，Triage `[L3]`）
- **適用版本**：基於 `spi-spc.html` `v10.37.0`（目標納入 `v10.38.0`）
- **參考依據**：
  - `AGENTS.md`
  - `APPLE_IPHONE_WEB_UI_UX_STANDARD.md`
  - `docs/spec-ui-streamlining-rfc.md`
  - `docs/spec-ui-copy-simplify-rfc.md`
  - `docs/spec-nav-taxonomy-rfc.md`
  - `docs/spec-record-pair-ux-rfc.md`

---

## 1. Problem Statement & Goals

### 1.1 現況問題（FACT）
在 `v10.35.0`–`v10.37.0` 連續功能整合後，`spi-spc.html` 已膨脹至 **17,499 行（約 1.35 MB）**，存在五類顯著的結構性重複與殘留：

1. **對話框過多與控制樣板重複（20 個 Dialog/Sheet）**：
   - 4 個各自獨立的確認／刪除對話框：`#specConfirmModal`、`#recDeleteModal`、`#recConfirmModal`、`#recBatchConfirmModal`。
   - 重疊的編修對話框：`#recRenameModal`（僅改顯示檔名）與已包含 `#recEditName` 欄位的 `#recEditModal`。
   - 3 個唯讀詳情對話框：`#proofModal`、`#unmatchedRefsModal`、`#recDetailModal`。
   - 2 個高度相似的參考檔登錄對話框：`#uploadPlaceModal`（受控座標）與 `#uploadLayoutModal`（Gerber 圖檔）。
   - 2 個判定處理對話框：`#recNewBatchModal`（新批次）與 `#recCorrectModal`（取代修正）。
   - JS 端存在 3 套重複 `open`/`close` 函式與重複的 Escape／Backdrop／Focus-trap 監聽器。
2. **導覽與子頁籤雙軌並存**：
   - `#recPickerModal` 同時存在頂部 `#btnPickImport`（「匯入資料」）與底部 `#btnRecPickerGoImport`（「＋ 匯入新檔」）兩個相同行為入口。
   - `#p-issues`、`#p-control`、`#p-improve` 使用 `.panel-subnav`，而 `#p-data` 使用 `.subtabs`。
   - 桌面 `#moreMenu` 與手機 `#moreSheet` 重複定義 `#mBtn*` 點擊代理與第二份內嵌 Mitcorp SVG Logo。
3. **匯出出口重疊與靜態重複標記**：
   - PDF 匯出分散在 `#p-report`（`#btnRepPdf`、`#btnRepPdfLite`）、`#p-mail`（`#btnMailDlPdf`）與 `#exportCenterModal`。
   - `#exportCenterModal` 手寫重複 14 張 `.exp-item-card` HTML。
4. **CSS、行內樣式與文案未徹底收斂**：
   - `<style>` 含 1,209 行，包含未再被參考的歷史類別；靜態 HTML 含 295 處重複行內 `style="..."`。
   - `docs/spec-ui-copy-simplify-rfc.md` 多項精簡尚未落地（含過時文字「雙欄捷徑仍位於頁首」、多處「AI 智能／品質工程／一鍵匯出」、空狀態引導至不存在的頂部「載入範例資料」按鈕等）。
5. **JS 死碼與重複 `fetch()` 樣板**：
   - 仍殘留 `btnAIMd`、`btnDl3d`、`btnShowLayoutForm`、`data-sub='import'`、`recPlace` 等無對應 DOM 的程式碼，以及 `/api/share` 等重複的 `fetch` JSON 錯誤解包樣板。

### 1.2 目標 (Goals)
1. 對話框由 20 個收斂為 **10 個語意清晰的對話框／Sheet**，並統一由單一 `createDialogController()` 驅動。
2. 記錄庫移除底部重複「＋ 匯入新檔」，子頁籤統一為 `.subtabs`，`#moreMenu`／`#moreSheet` 由單一 `USER_MENU_ACTIONS` 驅動。
3. 全站 PDF 與檔案下載統一由 `#exportCenterModal`（改為 `EXPORT_ITEMS` 資料陣列渲染）執行；`#p-report` 聚焦於章節勾選、預覽、列印與轉寄；`#p-mail` 聚焦於系統原生檔案分享與 `mailto`。
4. 清理未使用 CSS、將高頻行內樣式收斂為共用類別、補齊 `:focus-visible` 焦點環與 `prefers-reduced-motion`，落地 `spec-ui-copy-simplify-rfc.md` 文案簡化。
5. 抽取共用 `apiFetchJson()` 與 `setupSubtabs()`，清除殘留死碼，並同步更新測試與 `verify-spi-spc` 腳本。

### 1.3 非目標 (Non-Goals)
- 不變更任何統計計算（`analyze()`、`detectIssues()`、Nelson、Cpk/Ppk、Moran's I/LISA、Hotelling T²、DFM、`lib/*.mjs`）。
- 不變更 D1 Schema、Migration、Cloudflare Worker `/api/*` 端點與 `RecDB.create` fail-closed 行為。
- 不拆離單檔 SPA 部署架構（`spi-spc.html` → `tools/build-cloudflare.mjs` → `dist/`）。
- 不更換品牌色系（`--bg`、`--accent: #A3521D`、400/700 字重、明亮預設主題）。

---

## 2. System Architecture & Consolidation Mapping

### 2.1 對話框整併矩陣（20 → 10）

| 整併前 DOM ID | 整併後 DOM ID | 整併方式與契約 |
|---|---|---|
| `#specConfirmModal`、`#recDeleteModal`、`#recConfirmModal`、`#recBatchConfirmModal` | `#confirmModal` | 單一通用確認／刪除框（`role="alertdialog"`）；支援 `danger` 主鈕樣式、`warnBox`、風險清單與 `onExcludeRisk` 動作；按鈕維持左確認／右取消 |
| `#recRenameModal`、`#recEditModal` | `#recEditModal` | 雙模式切換（`mode: "rename" | "edit"`）：僅更名時隱藏工單／日期／批號／備註欄位；完整編修時顯示全部欄位 |
| `#uploadPlaceModal`、`#uploadLayoutModal` | `#uploadRefModal` | 雙模式切換（`mode: "place" | "layout"`）：共用拖放區、料號／版次／面別欄位與狀態列；依模式顯示座標單位或 Gerber 圖層／批次佇列 |
| `#recNewBatchModal`、`#recCorrectModal` | `#recAdjudicateModal` | 雙模式切換（`mode: "new-batch" | "correct"`）：切換新批次說明欄位或取代既有有效紀錄選取清單 |
| `#unmatchedRefsModal`、`#proofModal` | `#proofModal` | 於 `#proofModal`（與 `#recDetailModal`）內直接展開檢視完整無座標位號清單，移除獨立 `#unmatchedRefsModal` |
| 其餘保留獨立結構 | `#railSheet`、`#moreSheet`、`#appSettingsModal`、`#recPickerModal`、`#exportCenterModal`、`#specSaveModal`、`#specVerModal`、`#recDetailModal`、`#recActionSheet` | 全數納入統一對話框引擎管理 ESC、Backdrop、焦點捕捉與還原（共計 14 個？註：含兩個 sheet `#railSheet`/`#moreSheet`、`#recActionSheet` 及 11 個 modal；其中獨立 `db-modal` 由 16 個減為 10 個，連同 sheet 共 13 個） |

*(註：原 20 個 `role="dialog"`/`alertdialog"` 元素收斂為 13 個，其中業務 `db-modal` 對話框由 16 個精簡為 10 個。)*

### 2.2 導覽、匯出與元件整合契約
- **子頁籤統一**：`#p-issues`、`#p-control`、`#p-improve`、`#p-data` 皆使用 `.subtabs` / `.subtab` 樣式與 `setupSubtabs()` 鍵盤導覽；既有 `data-subnav-*` 與 `data-sub` 鍵值屬性予以保留以相容 `parseTabTarget()` 與深連結。
- **記錄庫匯入唯一入口**：移除 `#recPickerModal` 頁尾 `#btnRecPickerGoImport`，保留頂部 `#btnPickImport` 頁籤。
- **報告與郵件頁收斂**：移除 `#p-report` 的 `#btnRepPdf`／`#btnRepPdfLite` 與 `#p-mail` 的 `#btnMailDlPdf`；`triggerExportByType()` 與 `#exportCenterModal` 為唯一檔案下載出口。
- **資料驅動匯出與選單**：`EXPORT_ITEMS` 驅動 `#exportCenterModal` 卡片渲染；`USER_MENU_ACTIONS` 驅動 `#moreMenu` 與 `#moreSheet`「資料／操作與帳號」動作列，消除 `#mBtn*` 點擊代理。

---

## 3. 行為驗收與相容性

| 情境 | 可觀察預期 | 保留行為 |
|---|---|---|
| 開啟任一對話框／確認／登錄／編修／判定 | 焦點進入對話框、Tab 循環不逸出、ESC／背景點擊關閉並還原焦點；確認／儲存在左、取消在右 | 所有資料儲存、API 驗證與 D1/R2 狀態寫入不變 |
| 記錄庫匯入／篩選／批次操作 | 頂部 `#btnPickImport` 直接切換匯入流程；無底部重複鈕；清單維持單一 `.rec-scroll` | 分頁與快速篩選、對應證明與 SHA-256 驗證不變 |
| 匯出中心與報告／郵件頁 | `#exportCenterModal` 14 項交付物、標準交付包與批次勾選正常下載；`#p-report` 正常預覽／列印／轉寄；`#p-mail` 正常系統分享／`mailto` | PDF 生成內容與檔案命名規則不變 |
| 4 寬度 × 2 主題與無頭 Chrome 驗證 | 1440／820／390／320 px 下無水平溢出（`scrollWidth === clientWidth`）、觸控目標 ≥ 44px、`:focus-visible` 清晰 | 黃金測試 `tests/golden.test.mjs` 數值完全不變 |
