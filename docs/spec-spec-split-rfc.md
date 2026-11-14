# RFC：規格設定拆分（鋼板規格設定／錫膏印刷規格設定）

**狀態**：已實作（v10.35.0）  
**覆寫**：[設定 Hub](spec-settings-hub-rfc.md) 與 [設定獨立選單](spec-settings-nav-rfc.md) 中「規格與鋼板」合併在同一區的拆法。

## 1. Summary
製程工程師在設定規格時，鋼板屬性與錫膏印刷判定規格分屬兩個子分頁，各頁只含自己那一類欄位。完成後子分頁列為「匯入資料｜鋼板規格設定｜錫膏印刷規格設定｜回合管理」，既有跳轉都落在正確頁，分析數值與改版前完全相同。

## 2. Scope
**In scope**
- `#p-data` 子分頁由 3 個改為 4 個；原 `settings` 面板拆成兩個面板。
- 欄位歸屬（見 FR-2、FR-3）。
- 既有深連結／捷徑／提示文案改指向正確子分頁。
- 舊鍵 `settings`／`specs`／`stencil` 的相容別名。
- 測試、CHANGELOG、版本號（10.34.0 → 10.35.0）。

**Out of scope**
- 鋼板規格獨立版本化、新資料表、新 API、migration。
- `analyze()`、`detectIssues()` 公式與輸出；問題卡分類名稱「規格設定」（`cat:"規格設定"`，會動到 golden／報表）維持不變。
- 料號規格版本內容（`stencilRef` 等）與儲存流程。
- 介面與 AI 設定對話框（`#appSettingsModal`）、匯入頁的「匯入鋼板厚度」欄。
- 進階分析頁 `#inWipe` 行為。

## 3. User Stories
- 身為製程工程師，我想在「鋼板規格設定」只看到鋼板厚度、階梯區域與開孔，以便核對治具資料時不被判定規格干擾。
- 身為製程工程師，我想在「錫膏印刷規格設定」只看到印刷參數與 LSL／USL 規格，以便定義並儲存料號規格版本。
- 身為任一使用者，我從捷徑或提示點進設定時，要直接落在含該欄位的子分頁。

## 4. Functional Requirements
- **FR-1.** `#p-data` 子分頁列依序為：匯入資料、鋼板規格設定、錫膏印刷規格設定、回合管理（`data-sub`：`import`、`stencil-spec`、`paste-spec`、`runs`）。
- **FR-2.** 「鋼板規格設定」面板含且僅含：本回合鋼板厚度 `#inStencil2`（含 `#stencilList`）與 `#stencilNote`；階梯鋼板與位置設定卡（`#chkStep`、`#zoneTbl`、`#zoneMap`…）；鋼板開孔設定卡（`#apTbl`、`#geomPadFile`…）。
- **FR-3.** 「錫膏印刷規格設定」面板含且僅含：刮刀行程方向 `#selSqDir`、擦拭間隔 `#inWipe2`、`#partSpecBar`、儲存為新版本／放棄修改／版本清單、`#specTbl`、元件群組覆寫 `#specGrpBox`。
- **FR-4.** `[ASSUMPTION]` 錫膏印刷頁的規格表上方以唯讀文字顯示目前鋼板厚度（高度 µm 與高度 % 換算基準），並附「修改鋼板厚度」連結到鋼板頁、聚焦 `#inStencil2`。
- **FR-5.** 跳轉落點：`#railSpecBtn`（鋼板／規格）→ 鋼板頁聚焦 `#inStencil2`；規格閘門 `#btnGateSpec`、`gotoSpecCard()`、匯入後無料號規格的導引 → 錫膏印刷頁；`#btnGoWipeSpec` → 錫膏印刷頁聚焦 `#inWipe2`；錨點 `stencil` → 鋼板頁。
- **FR-6.** 相容別名：`setSub("settings")`、`setSub("specs")`、錨點 `spec` → `paste-spec`；`setSub("stencil")`、錨點 `stencil` → `stencil-spec`；`ai-cfg`／`ui` 行為不變（開對話框）。
- **FR-7.** 使用者可見文案中「資料與規格 → 規格設定」「資料與規格 → 規格」改為對應的新子分頁名稱。面板內不留與子分頁同名的 `h3`（依 AGENTS.md 文案規則）；鋼板頁第一張卡標題為「鋼板厚度」。
- **FR-8.** 兩頁所有控制項的寫入路徑、事件處理與 DOM id 不變；未儲存的規格草稿在子分頁間切換後仍保留。

## 5. Acceptance Criteria
### FR-1
- **Given** 進入「資料與規格」**When** 檢視子分頁列 **Then** 依序為四項，且鍵盤 ←／→／Home／End 依此順序循環。
- **Given** HTML 原始碼 **When** 搜尋 `data-sub="settings"` **Then** 不存在。

### FR-2 / FR-3
- **Given** 開啟鋼板頁 **When** 查詢 DOM **Then** `#inStencil2`、`#zoneTbl`、`#apTbl` 在該面板內，`#specTbl`、`#selSqDir`、`#inWipe2` 不在。
- **Given** 開啟錫膏印刷頁 **When** 查詢 DOM **Then** 反之；且每個 id 全頁只出現一次。

### FR-4
- **Given** 鋼板厚度 120 µm **When** 開啟錫膏印刷頁 **Then** 顯示「鋼板厚度 120 µm」唯讀文字；到鋼板頁改為 100 後回來，顯示 100 且高度 µm 列同步換算。
- **Given** 錫膏印刷頁 **When** 嘗試直接編輯厚度 **Then** 無可編輯輸入框，只有連結。

### FR-5 / FR-6
- **Given** 任一分析頁 **When** 點「鋼板／規格」**Then** 顯示鋼板頁且焦點在 `#inStencil2`。
- **Given** 回合尚無料號規格 **When** 點閘門「前往設定」**Then** 顯示錫膏印刷頁且 `#partSpecBar` 可見。
- **Given** 程式呼叫 `setSub("settings")` 或 `setSub("specs","spec")` **Then** `S.sub==="paste-spec"`；`setSub("stencil")` **Then** `S.sub==="stencil-spec"`。
- **Given** 呼叫 `setSub("不存在的鍵")` **Then** 不顯示空白面板（維持現行行為，不新增靜默落點）。

### FR-7
- **Given** HTML 與程式字串 **When** 搜尋「資料與規格 → 規格設定」**Then** 0 筆；`tests/ui-copy.test.mjs` 通過。

### FR-8
- **Given** 在規格表改一格未儲存 **When** 切到鋼板頁再切回 **Then** 修改值與「已修改，尚未存成新版本」標示仍在。
- **Given** golden 回合 **When** 跑 `tests/golden.test.mjs` **Then** 輸出與改版前相同。

## 6. Edge Cases and Failure Modes
- **Case:** 範例資料（`specSrc==="sample"`）。**Behavior:** 兩頁皆可開啟；儲存／版本按鈕維持停用，規格表仍可即時改示範值。
- **Case:** 回合沒有產品料號。**Behavior:** 錫膏印刷頁顯示既有鎖定訊息、規格表停用；鋼板頁照常可用。
- **Case:** 尚無任何回合（空狀態）。**Behavior:** 兩頁可開啟，不拋例外，`SPI_TEST_HOOK` 正常掛上。
- **Case:** 高度單位未知。**Behavior:** `#stencilNote` 既有警示在鋼板頁顯示；錫膏印刷頁高度列維持「單位未知」。
- **Case:** 階梯鋼板啟用。**Behavior:** 錫膏印刷頁的厚度文字標明「基礎厚度」。
- **Case:** 規格草稿未儲存時切換回合。**Behavior:** 既有放棄確認流程不變。
- **Case:** 320px 寬、四個較長的子分頁標籤。**Behavior:** 子分頁列自身換行或橫向捲動，整頁 `scrollWidth === clientWidth`。
- **Case:** `#zoneMap` canvas 所在面板被隱藏後再顯示（dpr 2）。**Behavior:** 進出 3 次寬度不變。

## 7. Non-Functional Requirements
- **相容性／版面.** 1440／820／390／320 × 明暗主題無整頁橫向溢出；面板 `grid-template-columns:minmax(0,1fr)`；無 `.card .card` 巢狀。
- **Accessibility.** 子分頁維持 `role="tab"`、`aria-selected`、roving tabindex；觸控熱區 ≥ 44px；文字對比 ≥ 4.5。
- **效能.** 進入單一子分頁只渲染該頁所需（鋼板頁：`renderZones`／`renderAperture`；錫膏頁：`renderSpecTbl`），不多於現行單頁總成本。
- **Security.** 不新增輸入面與 innerHTML 模式；`.textContent` 節點維持純文字。

## 8. Dependencies
- 既有 `setSub`／`scrollSettingsAnchor`／`SETTINGS_LEGACY`（`spi-spc.html` 的 `SETTINGS_LEGACY`／`ANCHOR_SUB`）、`gotoSpecCard`、`renderSpecTbl`、`renderTab` 的 data 分支。無外部依賴。

## 9. Risks and Mitigations
- **Risk:** 漏改跳轉，使用者落到不含目標欄位的頁。**Mitigation:** grep 全部 `setSub(`／`S.sub===`／錨點呼叫；FR-5 每條有 jsdom 測試。
- **Risk:** 測試以 `<div data-sub="settings"` 切片（`tests/ui-copy.test.mjs:66`、`tests/ui.smoke.test.js:100–116`）連鎖失敗。**Mitigation:** 同一 PR 更新。
- **Risk:** 厚度與高度規格分頁後，使用者改厚度沒注意高度 µm 窗跟著變。**Mitigation:** FR-4 唯讀厚度文字＋`#stencilNote` 保留。
- **Risk:** 與 `spec-settings-hub-rfc.md`／`spec-settings-nav-rfc.md`（合併方向）敘述相反。**Mitigation:** 新 RFC 註明覆寫這兩份的「規格與鋼板」區段拆法，並在兩份舊文件頂部加指向。

## 10. Open Questions
- `[ASSUMPTION]` 刮刀方向與擦拭間隔屬印刷製程參數，歸「錫膏印刷規格設定」。
- `[ASSUMPTION]` 幾何焊墊清單匯入留在鋼板開孔卡（鋼板頁）。
- `[ASSUMPTION]` 手機「更多」選單與桌面主頁籤不新增入口，仍由「資料與規格」進入。

## 11. Success Metrics
- **Leading:** 四個子分頁上線；全部深連結測試通過；UI 矩陣 8 格無溢出。
- **Lagging:** 使用者不再回報「鋼板／規格欄位找不到或混在一起」；golden 與 `test:slow` 結果零差異。

## 12. 實作備註

- 單位不符（`sig.t==="unit"`）問題卡的「前往」改開錫膏印刷頁；鋼板厚度不一致（`ACT.msa`）問題卡改開鋼板頁。只改跳轉目標，問題內容與分類不變。
- `renderTabByName("data")` 仍一次渲染規格表、階梯區域、開孔與回合表，成本與拆分前相同。
