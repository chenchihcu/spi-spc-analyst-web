# RFC-SPI-UI-ENTRY-20261109：分析台入口介面整合與精簡規格書

**文件編號**：RFC-SPI-UI-ENTRY-20261109  
**版本**：v1.1 (依用戶 2026-11-09 審定決策修訂)  
**日期**：2026-11-09  
**狀態**：已審定 (Approved Architecture Decisions)  
**作者**：Antigravity Agent  
**審查對象**：前端維護者、QE／SPC 使用者代表、SMT 產線製程工程師  

**範圍聲明**：本 RFC 針對 SPI·SPC 分析台之頂欄狀態膠囊、開機導流橫幅、資料庫與匯入入口、以及主導覽頁籤（14 分頁）進行架構盤點、痛點分析與整合精簡設計。**本文件僅規範互動流程與 UI 架構契約，不涉及後端資料庫 Migration、不變更統計演算法與計算不變性。**

---

## 1. 問題陳述與目標 (Problem Statement & Goals)

### 1.1 現況背景與架構痛點 (FACT & INFERENCE)

SPI·SPC 分析台（主檔案 [`spi-spc.html`](../spi-spc.html)）為單頁應用程式（Single Page Application），提供高密度 SMT 製程錫膏印刷統計管制能力。隨功能演進，介面入口產生了多處冗餘與分流，對新進工程師與日常監控造成顯著的認知負擔與空間浪費：

1. **入口碎片化與重複定義 (Entry Point Fragmentation)**：
   - 使用者想要「載入/切換分析資料」，目前分散於 5 個互不連貫的進入點：
     - ① 頂欄膠囊 `stateSpi`（量測紀錄狀態，兼具點擊開啟選取視窗功能）
     - ② 頂欄膠囊 `statePlace`（座標檔狀態，兼具點擊開啟選取視窗功能）
     - ③ 頂欄按鈕 `btnOpenRecModal`（「記錄庫 ▾」）
     - ④ 首頁開機橫幅 `#startupDbBanner` 內的 `btnBannerLoadDb`（「記錄庫」）與 `btnBannerGoImport`（「匯入新檔」）
     - ⑤ 第 14 個主分頁「資料與規格」裡面的 6 個子頁（`import`, `specs`, `runs`, `stencil`, `records`, `ai-cfg`）
   - **問題**：使用者難以直覺分辨「頂欄記錄庫按鈕」、「開機橫幅記錄庫」、「記錄庫彈出視窗 (`#recPickerModal`)」與「分頁資料庫 (`#p-data [data-sub="records"]`)」的語意邊界。

2. **開機預設行為與垂直視野壓迫 (Vertical Space Tax on Boot)**：
   - 系統開機自動載入 `sampleCfg()`（範例資料），並在首頁 `#p-issues`（問題偵測）頂部顯示約 80px 高度之兩列式 `#startupDbBanner`。
   - 頂欄 Header (~48px) + 分析設定 Sticky Rail (~44px) + Tabs Bar (~42px) + Startup Banner (~80px) = **高達 214px ~ 260px** 的頂部高度被控制項佔據。在常見的 1080p 螢幕中，寶貴的首屏空間有超過 25% 無法直接呈現製程問題地圖或管制圖數據。

3. **桌面 14 個橫向分頁過度擁擠與分組標籤冗餘 (Tab Group Clutter)**：
   - 桌面頁籤橫向排布 14 個分頁，且交錯插置了 6 個不可點擊的靜態文字標籤：
     - `<span class="tabgrp">找問題</span>`
     - `<span class="tabgrp">看證據</span>`
     - `<span class="tabgrp">深入分析</span>`
     - `<span class="tabgrp">改善與比較</span>`
     - `<span class="tabgrp">診斷與報告</span>`
     - `<span class="tabgrp">設定</span>`
   - 這 6 個純裝飾性文字標籤累計佔據逾 320px 的水平寬度，使得在 1366px ~ 1440px 筆電螢幕上，頁籤列極易溢出並強制觸發左右捲動箭頭 (`tabScrollL`/`tabScrollR`)。
   - 尤有甚者，「資料與規格」被放置在最後一個（第 14 位），但「取得資料/匯入資料」卻是整個分析流程的 **第 0 步**。

### 1.2 目標 (Goals)

1. **移除頁籤列靜態文字標籤，徹底釋放水平空間 (Zero Tabgroup Fluff)**：
   - 移除桌面頁籤列中 6 個純文字分組標籤（`找問題`、`看證據`、`深入分析`、`改善與比較`、`診斷與報告`、`設定`），使所有橫向空間完全保留給具互動性的 14 個核心分頁按鈕，徹底根除 1366px~1440px 視口下的不必要橫向捲動。
2. **前置「資料與規格」為第 1 頁（Step 0 Ingestion）**：
   - 將「資料與規格」分頁調整至導覽列最首位（第 1 頁），確立「資料準備 (Step 0) $\to$ 問題偵測 (Step 1) $\to$ 總覽 (Step 2) $\to$ SPC 管制圖 $\to$ ...」的自然工作流。
3. **盤點並收斂「設定」相關功能至資料與規格目錄 (Settings Consolidation)**：
   - 系統性盤點全站分散的各項設定（規格設定、鋼板開孔、幾何焊墊覆蓋、回合管理、雲端資料庫管理、管理者角色指派、AI 模型與金鑰配置、系統顯示偏好等），統一彙整於「資料與規格」目錄下之子分頁，形成單一設定管理中樞。
4. **開機提示橫幅單行化與首屏高度釋放 (Single-line Compact Banner ≤ 36px)**：
   - 首頁 `#startupDbBanner` 維持保留於問題清單頂部，但透過緊湊 Flex 單行排版將高度控制在 **≤ 36px**（減少 55% 垂直高度），同時保留「最近紀錄」快速點擊按鈕、記錄庫與匯入轉跳按鈕，釋放 50px+ 之首屏視窗高度給 Nelson 問題地圖與缺陷清單。
5. **數據分流保持嚴格清晰 (Strict Ingestion Decoupling)**：
   - 選取視窗（`#recPickerModal`）專注於「雲端歷史紀錄與受控座標檔」之查詢、快照檢驗與快速套用；新檔案匯入維持引導至「資料與規格 $\to$ 匯入資料」子分頁進行嚴格之 5 步驟解析與欄位映射。

### 1.3 非目標 (Non-goals)

- 不修改任何統計演算法、Nelson Rules 判異邏輯、Cpk 公式、Moran's I 或 Hotelling T²。
- 不變更 Cloudflare D1 Schema（維持 0007 正本）與 R2 物件讀寫 API。
- 不打破 `RecDB.create` 在未登入/離線時拋錯的 Fail-Closed 雲端寫入守則。
- 不引入外部肥大前端框架（React/Vue/Tailwind），嚴格遵循單檔原生 SPA 架構。
- 手機底欄（`nav.mtab`）維持 5 個核心按鈕（問題、總覽、管制圖、能力、更多），不破壞行動版操作契約。

---

## 2. 系統資訊架構 (Information Architecture & Navigation Flow)

### 2.1 導覽結構演進對比

```mermaid
flowchart TD
  subgraph 既有 14 頁籤佈局 (含 6 個文字標籤與末端設定)
    T0["[找問題] 標籤"] --- T1[問題偵測] --- T2[總覽]
    T2 --- T3["[看證據] 標籤"] --- T4[管制圖] --- T5[製程能力] --- T6[3D 模擬]
    T6 --- T7["[深入分析] 標籤"] --- T8[交叉驗證] --- T9[進階分析] --- T10[統計資料]
    T10 --- T11["[改善與比較] 標籤"] --- T12[試產比較] --- T13[DFM 建議] --- T14[實驗驗證]
    T14 --- T15["[診斷與報告] 標籤"] --- T16[AI 分析] --- T17[分析報告]
    T17 --- T18["[設定] 標籤"] --- T19[資料與規格 (第 14 位)]
  end

  subgraph 整合後導覽佈局 (無標籤、資料前置、緊湊可掃描)
    N0[資料與規格 (Step 0 首位)] --> N1[問題偵測 (預設首頁)] --> N2[總覽] --> N3[管制圖] --> N4[製程能力] --> N5[3D 錫膏模擬] --> N6[交叉驗證] --> N7[進階分析] --> N8[統計資料] --> N9[試產比較] --> N10[DFM 建議] --> N11[實驗驗證] --> N12[AI 分析] --> N13[分析報告]
  end
```

### 2.2 頁籤佈局契約 (Tabs Bar Contract)

在 [`spi-spc.html`](../spi-spc.html) 的 `.tabs-bar` 中：
1. 徹底移除 6 處 `<span class="tabgrp" aria-hidden="true">...</span>` 節點。
2. 將 `<button class="tab" role="tab" data-tab="data">資料與規格</button>` 調動至首位。
3. 導覽列整體結構更新為：
```html
<nav class="tabs" role="tablist" aria-label="分析頁籤">
  <button class="tab" role="tab" data-tab="data">資料與規格</button>
  <button class="tab" role="tab" data-tab="issues" aria-selected="true">問題偵測</button>
  <button class="tab" role="tab" data-tab="overview">總覽</button>
  <button class="tab" role="tab" data-tab="control">管制圖</button>
  <button class="tab" role="tab" data-tab="capability">製程能力</button>
  <button class="tab" role="tab" data-tab="sim3d">3D 錫膏模擬</button>
  <button class="tab tab--sub" role="tab" data-tab="cross" data-tab-group="deep">交叉驗證</button>
  <button class="tab tab--sub" role="tab" data-tab="adv" data-tab-group="deep">進階分析</button>
  <button class="tab tab--sub" role="tab" data-tab="stats" data-tab-group="deep">統計資料</button>
  <button class="tab tab--sub" role="tab" data-tab="compare" data-tab-group="improve">試產比較</button>
  <button class="tab tab--sub" role="tab" data-tab="dfm" data-tab-group="improve">DFM 建議</button>
  <button class="tab tab--sub" role="tab" data-tab="lab" data-tab-group="improve">實驗驗證</button>
  <button class="tab" role="tab" data-tab="ai">AI 分析</button>
  <button class="tab" role="tab" data-tab="report">分析報告</button>
</nav>
```

> **開機分頁與 Deep Link 相容性**：
> - 雖然「資料與規格」位於 HTML 結構首位，但開機時若 URL 無特定 Hash，`initHash` 解析仍將預設選中 `issues`（問題偵測），確保「開機即見製程異常總結」的核心價值不受影響。
> - 若使用者點擊書籤 `#data`，則直接開啟資料與規格頁面。

---

## 3. 「設定」欄位與子目錄盤點整合 (Settings Inventory)

系統各層級設定功能全面盤點並歸納至 `#p-data`（資料與規格）之子目錄結構中，消除分散與不易尋找之困擾：

| 設定分類 | 子分頁 (Subtab) | 包含之設定項目與操作 | 現有位置 / 整合動線 |
|---|---|---|---|
| **1. 資料匯入設定** | `import` (匯入資料) | - CSV 檔案選取與剪貼簿貼上<br>- 格式與面別設定 (TOP/BOT/ALL)<br>- 欄位映射與幾何焊墊覆蓋率比對<br>- 批號、工單、量測日期與備註中繼資料登記 | `#p-data [data-sub="import"]`（既有） |
| **2. 料號與規格設定** | `specs` (規格設定) | - 產品料號規格版本管理（不可變版本快照）<br>- 厚度、面積、體積、高度、偏移之 LSL/USL/靶值門檻<br>- 設為目前預設規格與歷史版本切換<br>- 焊墊級規格客製 (Spec Override) | `#p-data [data-sub="specs"]`（既有） |
| **3. 回合與試產設定** | `runs` (回合管理) | - 多試產回合切換與並行管理<br>- 回合命名、鋼板版本標記<br>- 匯入外部已存回合 / 匯出回合快照 JSON<br>- 回合刪除與重設 | `#p-data [data-sub="runs"]`（既有） |
| **4. 鋼板與幾何設定** | `stencil` (鋼板與開孔) | - 鋼板整體厚度 (Stencil Foil Thickness: 100/120/130/150µm)<br>- 各元件開孔面積比 (Area Ratio) 與寬深比 (Aspect Ratio)<br>- 階梯鋼板 (Step Stencil) 與微開孔配置 | `#p-data [data-sub="stencil"]`（既有） |
| **5. 資料庫與角色設定** | `records` (資料庫) | - 雲端量測紀錄 (SPI CSV) 清單與 SHA-256 指紋驗證<br>- 受控座標檔 (CAD Placement) 管理與備註修訂<br>- 管理者角色指派與權限變更 (`adminUsersSection`)<br>- 資料庫稽核紀錄 (Audit Log) 查閱 | `#p-data [data-sub="records"]`（既有） |
| **6. AI 與智能診斷設定** | `ai-cfg` (AI 設定) | - AI 提供商配置 (Google Gemini / OpenAI / Anthropic)<br>- AES-256-GCM API 金鑰保存與驗證<br>- 動態模型型錄與推理思維預算配置<br>- 每日 Token 用量配額硬阻斷設定 | `#p-data [data-sub="ai-cfg"]`（既有） |
| **7. 系統顯示與偏好設定** | 整合至 `records` 或各卡片標頭 | - 介面主題快速切換（明亮/深色）<br>- 時段篩選閉區間預設模式<br>- 圖表字型與高對比顯示偏好 | 強化設定可見度，不再僅能從頂欄「更多 ▾」進入 |

---

## 4. 首頁開機橫幅精簡設計 (Single-Line Compact Banner)

### 4.1 設計規格 (Specification)

- **容器 ID**：維持 `#startupDbBanner`，保留 `.card` 與 `.startup-db-banner` class。
- **高度約束**：桌面端整體容器高度 **≤ 36px**（相較於既有 80px 縮減逾 50%）。
- **佈局方式**：採用單行彈性盒子（`display: flex; flex-wrap: nowrap; align-items: center; justify-content: space-between; gap: 8px`）。
- **內部元件收斂**：
  - **左側摘要**：`[💡 範例資料預覽 · 試產 1 · 鋼板 V1]`，文字字級維持 `--fs-caption`，色彩維持語意 `--accent-ink`。
  - **中央快速批號**：`#bannerRecentRuns` 改為行內彈性展示（`display: inline-flex; align-items: center; gap: 6px`），消除原先多餘的 `margin-top: 6px`，最近 3 筆記錄直接在單行內水平排布。
  - **右側動作列**：
    - `#btnBannerLoadDb`：「記錄庫」（緊湊按鈕，高度 28px，觸控設備 44px）
    - `#btnBannerGoImport`：「匯入新檔」（緊湊按鈕）
    - `#btnBannerDismiss`：「✕」（極簡文字按鈕，點擊記憶隱藏狀態）

### 4.2 程式碼調整對比

```css
/* 緊湊單行開機橫幅 (高度 <= 36px) */
.startup-db-banner {
  margin-bottom: 8px !important;
  background: var(--accent-soft);
  border: 1px solid var(--accent);
  display: flex !important;
  flex-wrap: nowrap !important;
  justify-content: space-between !important;
  align-items: center !important;
  padding: 2px 10px !important;
  min-height: 32px !important;
  max-height: 36px !important;
  border-radius: var(--r);
  gap: 8px !important;
  overflow-x: auto;
}
.startup-db-banner__main {
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  min-width: 0 !important;
  flex: 0 1 auto !important;
}
.startup-db-banner__body {
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  min-width: 0 !important;
}
.startup-db-banner__title-row {
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  white-space: nowrap !important;
}
#bannerRecentRuns {
  margin-top: 0 !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
}
.startup-db-banner__actions {
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  flex-shrink: 0 !important;
}
.startup-db-banner__btn {
  padding: 2px 8px !important;
  min-height: 28px !important;
  font-size: var(--fs-caption) !important;
}
```

---

## 5. 行為驗收與相容性矩陣 (Acceptance & Compatibility)

| 使用情境／觸發 | 可觀察預期 | 錯誤／例外分支 | 應保留的既有行為 |
|---|---|---|---|
| **開機初次進入 (無 Hash)** | 頁籤首位顯示「資料與規格」，但作用中分頁預設為「問題偵測」（`issues`）；首頁頂部顯示單行緊湊橫幅（高度 ≤ 36px）；下方 Nelson 問題地圖與第一張問題卡完整呈現，無過度下推 | 外部圖表庫若連線失敗，維持顯示 `#libWarn` | 既有 `updateStartupDbBanner()` 邏輯相容，測試用 `BANNER_DISMISSED` 與略過功能正常運作 |
| **點擊「資料與規格」分頁** | 正確顯示資料與規格面板（`#p-data`），6 個子分頁正常切換，所有設定與管理功能完整可用 | 若無載入資料，提示前往匯入或選擇 | 保持鍵盤左右箭頭切換子分頁 (ArrowLeft / ArrowRight / Home) 無障礙契約 |
| **點擊首頁橫幅「記錄庫」按鈕** | 觸發 `#btnBannerLoadDb.click()`，無阻礙彈出 `#recPickerModal` 視窗，搜尋框自動取得焦點 | 離線或無雲端連線時以本機模式提示 | 保留鍵盤 ESC 關閉與焦點返回原按鈕之契約 |
| **1366px ~ 1440px 筆電螢幕檢視** | 移除 6 個文字標籤後，14 個分頁於水平列中緊湊排布，不觸發橫向左右捲動箭頭 | 視口極窄時仍有 `tabScrollL/R` 保底 | 頁籤點擊高亮、`aria-selected` 狀態與滑鼠滾輪橫向捲動相容 |
| **手機端 (320px ~ 440px) 檢視** | 手機底欄 (`nav.mtab`) 維持 5 個按鈕（問題、總覽、管制圖、能力、更多）；首頁橫幅在小螢幕自動允許橫向微捲，所有按鈕觸控熱區維持 ≥ 44px | 旋轉螢幕時版面自動重排，無異常白邊 | 遵循 `APPLE_IPHONE_WEB_UI_UX_STANDARD.md` 與 `tests/mobile-layout.test.mjs` |

---

## 6. 架構決策記錄 (Architecture Decision Records)

- **ADR-01：分頁文字標籤移除 (Tabgroup Removal)**：經審定，移除桌面頁籤列中 6 個純文字分組標籤（`tabgrp`）。實測可釋放逾 320px 水平空間，一舉解決主流筆電螢幕（1366px / 1440px）的頁籤擁擠問題。
- **ADR-02：資料規格前置至第 1 頁 (Data-First Ordering)**：將 `data` 分頁移至首位，使整體分析動線符合「先備料/設規格 $\to$ 找問題 $\to$ 看證據 $\to$ 深入分析 $\to$ 產出報告」的自然認知模型。
- **ADR-03：首頁橫幅緊湊單行化 (Single-Line Banner)**：不完全移除 `#startupDbBanner`（避免破壞測試依賴與最近記錄點擊便利性），改採單行 ≤ 36px 佈局，釋放逾 50px 垂直高度。
- **ADR-04：新檔匯入與歷史庫嚴格分流 (Strict Ingestion Decoupling)**：選取視窗專職負責雲端歷史資料與座標套用，新檔匯入統一導流至「資料與規格 $\to$ 匯入資料」子分頁，維持資料驗證之嚴謹度與 Fail-Closed 雲端寫入守則。
