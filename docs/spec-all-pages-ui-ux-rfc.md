# RFC-SPI-UI-UX-ALL-PAGES-20261029：分析台全分頁 UI/UX 與無障礙系統性優化規格書

**文件編號**：RFC-SPI-UI-UX-ALL-PAGES-20261029  
**版本**：v1.0  
**日期**：2026-10-29  
**狀態**：草案 (Draft / For Review)  
**作者**：Antigravity Agent  
**審查對象**：前端維護者、QE／SPC 使用者代表、SMT 製程工程師  

---

## 1. 問題陳述與目標 (Problem Statement & Goals)

### 1.1 背景與問題 (Problem Statement)
SPI·SPC 分析台已於 v10.10.1 完成使用者可見文案收斂（RFC-SPI-UI-COPY-20261029）並於 v10.9.1 ~ v10.9.3 確立了基礎 CSS Tokens、雙軌導覽與行動版觸控規範。然而在全站 14 個主分頁、4 個資料子分頁與 9 個對話框的整體 UI/UX 巡檢中，仍存在跨頁面的五大系統性體驗缺口：

1. **表格響應式橫向捲動容器缺失 (Table Overflow Isolation Gaps)**：
   - 全站 20+ 個核心資料表格（如管制圖 `#nelsonTbl`、製程能力 `#capGrpTbl`、3D 不良焊墊 `#boardDefTbl`、交叉驗證 `#xvTbl`、進階分析 5 個表格、統計資料 2 個表格、DFM 2 個表格、資料管理 10 個表格）未統一包裹於 `.tbl-wrap`（`overflow-x: auto`）容器中。
   - 在 320px ~ 390px 小螢幕（iPhone Safari / Android Chrome）下，當表格內容較寬時，存在撐開外層 flex/grid 容器導致頁面橫向抖動的風險。
2. **無障礙表單標籤與圖表語意缺失 (Accessibility & A11Y Gaps)**：
   - 3D 頁面中的 `chkGhost`、`chkBridgeWarn`、實驗驗證中的 `aoiFile`、`grrFile`、AI 分析中的 `aiAnon`、分析報告中的 `chkRep1`~`chkRep10` 以及郵件轉寄中的 `chkMailRep1`~`chkMailRep10` 缺少顯式的 `for` 屬性或 `aria-label`。
   - 全站 18+ 個 Canvas 統計圖表（如 `#cXbar`、`#cS`、`#cHist`、`#cQQ`、`#cBox`、`#cXvScatter` 等）未標註 `role="img"` 與具體 `aria-label`，螢幕閱讀器與輔助技術無法識別圖表內容。
3. **未收斂的寫死色碼與 Token 例外 (Hardcoded Color Exceptions)**：
   - `#p-sim3d` 具有 `#0d1117` 寫死背景，在明亮模式下視覺割裂；`#p-adv` 具有 `#ef4444`、`#3b82f6`、`#93c5fd`、`#f97316`、`#94a3b8` 等寫死 hex 顏色；記錄庫具有 `#9aa3a0` 等線條色，在深色模式切換時無法隨主題自然調整。
4. **Emoji 圖示殘留與視覺一致性 (Emoji Icon Inconsistencies)**：
   - 雖然主導覽與範例提示已移除 Emoji，但在 `#recPickerModal`（記錄庫選取中樞）與記錄列表仍大量殘留 `🔐`、`📊`、`📍`、`⚠️`、`✓`、`✗`、`🕒`、`🗄`、`✏️` 等 Emoji，與 Institution / ui-ux-pro-max「不以 emoji 當圖示」規範衝突。
5. **資料庫與 Schema 盤點 (design-database-schema Assessment)**：
   - 經盤點 Cloudflare D1 既有 migrations (0001~0007)，目前 `records`、`shares`、`audit_log` 之 SQLite schema 結構完善，且已涵蓋量測記錄、座標庫、料號規格快照與防篡改指紋；UI/UX 優化項目聚焦於呈現層、無障礙、深淺色 Token 收斂、表格響應式捲動防護與圖示語意化，無須變更 D1 DDL 或新增 migration，避免破壞性 DB 遷移風險。

### 1.2 目標 (Goals)
1. **全頁面表格響應式容器包裹**：為全站 14 個主分頁與 4 個子頁的全部資料表格包覆 `<div class="tbl-wrap">`，阻絕 320px / 390px 橫向溢出。
2. **全頁面無障礙與圖表語意補齊**：為所有圖表畫布配置 `role="img"` 與 `aria-label`；為所有表單核取方塊、檔案上傳鈕補齊顯式標籤或 `aria-label`。
3. **硬編碼色值全面 Token 化**：將所有寫死的 hex 色值替換為語意化 CSS Tokens（`var(--surface)`、`var(--ng)`、`var(--series2)`、`var(--line)` 等）。
4. **Emoji 全面收斂為純文字或 SVG 圖標**：清理 `#recPickerModal` 及資料庫介面的 Emoji，統一為簡約專業的工業級 UI 樣式。
5. **確保既有 420 項測試與 mobile-layout 矩陣 100% 通過**，維持零回歸。

### 1.3 非目標 (Non-goals)
- 不變更任何統計演算法、Nelson 判異規則、Cpk 計算或偵測門檻。
- 不新增或修改 Cloudflare D1 migrations 與資料庫 schema（維持 0007 正本）。
- 不破壞登入驗證、Fail-Closed 機制與 Cloudflare R2 物件讀寫邏輯。
- 不引入外部肥大前端框架（如 React/Vue/Tailwind），維持單檔 SPA 架構。

---

## 2. 系統架構與各分頁優化清單

### 2.1 主分頁與子頁對照與優化清單

| 分頁 ID | 中文名稱 | UI/UX 改善項目 | 驗收依據 |
|---|---|---|---|
| `#p-issues` | 問題偵測 | 圖例與嚴重度標示 Token 化，補齊語意化樣式 | IOS-12, IOS-13 |
| `#p-overview` | 總覽 | 為 `#cSumCtrl` 與 `#cSumPareto` 補全 `role="img"` 與 `aria-label` | IOS-11 |
| `#p-control` | 管制圖 | `<table id="nelsonTbl">` 包裹 `.tbl-wrap`；畫布補齊 `role="img"` 與 `aria-label` | IOS-03, IOS-11 |
| `#p-capability` | 製程能力 | `<table id="capGrpTbl">` 包裹 `.tbl-wrap`；直方圖/QQ/盒鬚畫布補齊 `role="img"` 與 `aria-label` | IOS-03, IOS-11 |
| `#p-sim3d` | 3D 錫膏模擬 | 移除 `#0d1117` 寫死背景，改用 Token；`chkGhost`、`chkBridgeWarn` 補齊 `aria-label`；`<table id="boardDefTbl">` 包裹 `.tbl-wrap` | IOS-03, IOS-11, IOS-15 |
| `#p-cross` | 交叉驗證 | `<table id="xvTbl">` 包裹 `.tbl-wrap`；3 個畫布補齊 `role="img"` 與 `aria-label` | IOS-03, IOS-11 |
| `#p-adv` | 進階分析 | 移除 5 處寫死 hex 顏色（`#ef4444`, `#3b82f6` 等）；5 個表格全部包裹 `.tbl-wrap`；8 個畫布補齊 `role="img"` 與 `aria-label` | IOS-03, IOS-11, IOS-15 |
| `#p-stats` | 統計資料 | `<table id="statsTbl">` 與 `<table id="matrixTbl">` 包裹 `.tbl-wrap` | IOS-03 |
| `#p-compare` | 試產比較 | `<table id="cmpTbl">` 包裹 `.tbl-wrap`；2 個畫布補齊 `role="img"` 與 `aria-label` | IOS-03, IOS-11 |
| `#p-dfm` | DFM 建議 | `<table id="dfmTbl">` 與 `<table id="dfmPads">` 包裹 `.tbl-wrap`；`#cDfmRisk` 補齊 `aria-label` | IOS-03, IOS-11 |
| `#p-lab` | 實驗驗證 | 為 `aoiFile` 與 `grrFile` 添加顯式 `aria-label`；`#cLab` 補齊 `role="img"` 與 `aria-label` | IOS-11 |
| `#p-ai` | AI 分析 | 補齊 `aiAnon` 之 `aria-label`；收斂按鈕 Focus Ring 與窄螢幕間距適配 | IOS-04, IOS-11 |
| `#p-report` | 分析報告 | 匯出章節核取方塊 `chkRep1`~`chkRep10` 建立顯式 `for` 關聯與 `aria-label`；響應式網格間距優化 | IOS-04, IOS-11 |
| `#p-gate` | 放行閘門 | 提升引導按鈕之對比度與觸控熱區 (>= 44px) | IOS-04, IOS-12 |
| `#p-data` | 資料與規格 | 10 個資料表格全面包覆 `.tbl-wrap`；檔案上傳框補齊 `aria-label`；清除記錄子頁殘留 Emoji | IOS-03, IOS-11 |
| `#p-share` | 建立分享 | 確保分享按鈕在行動端具備足夠觸控邊距與清晰狀態回饋 | IOS-04 |
| `#p-shares` | 我的分享 | `<table id="mySharesTbl">` 包裹 `.tbl-wrap` | IOS-03 |
| `#p-mail` | 轉寄報告 | 郵件章節核取方塊 `chkMailRep1`~`chkMailRep10` 補齊 `for` 關聯；受控座標上傳 `upPlaceFile` 補齊 `aria-label` | IOS-04, IOS-11 |
| 模態對話框 | 記錄選取中樞等 | 清除 `#recPickerModal` 內的 Emoji（`🔐`, `📊`, `📍`, `⚠️`, `🕒`, `🗄`, `✏️` 等），統一替換為清晰專業文字與向量圖標 | RFC UI-GAP-01, IOS-11 |

---

## 3. 驗收矩陣與測試規範

依據 `AGENTS.md` 與 `APPLE_IPHONE_WEB_UI_UX_STANDARD.md`，變更完成後需通過：
1. **單元與回歸測試**：`npm test` 420 項測試 100% 通過（含 `tests/mobile-layout.test.mjs`、`tests/ui-copy.test.mjs`、`tests/type-scale.test.mjs`、`tests/ui.smoke.test.js`）。
2. **多視口與主題驗證**：
   - 1440px（桌機）、820px（平板）、390px（手機）、320px（最小螢幕）。
   - 明亮主題 (Light) 與 深色主題 (Dark)。
   - 320px 下無整頁橫向捲軸溢出（`document.documentElement.scrollWidth === clientWidth`）。
3. **發布檢查**：`node tools/release-check.js` 檢查無阻斷錯誤。
