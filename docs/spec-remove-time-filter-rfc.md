# RFC：移除時間篩選（時段篩選）

- **狀態**：已核准規格（本文件步驟僅產出規格；實作另 PR）
- **日期**：2026-11-12
- **基準版本**：`spi-spc.html` v10.15.6
- **參考依據**：[`AGENTS.md`](../AGENTS.md)、[`docs/spec-ui-copy-rfc.md`](spec-ui-copy-rfc.md)、[`docs/spec-windows-parity-rfc.md`](spec-windows-parity-rfc.md)

---

## 1. Problem Statement & Goals

### 問題

全域分析設定列（`.rail`）的「時段篩選」（`#railTimeWrap`）會依 `r.ts` 將 `S.rows` 收成 UTC+8 閉區間子集，並把同一份子集寫回目前回合的 `curRun().rows`。由此產生：

1. **無時間戳列被丟棄**：篩選時 `r.ts == null` 的列不納入，分析結果與匯入筆數不一致。
2. **部分板標示與問題地圖耦合**：時間窗切到半片板時，`S.partialBoards` 驅動問題地圖「部分」標籤與報告揭露，語意只服務時段篩選。
3. **本機快照不可逆**：`saveRunsNow` 持久化的是篩選後的 `rows`；`_rawRows` 不寫入 IndexedDB `spi-spc`。套用篩選後保存並重整，無法在 UI 內還原被濾掉的列。
4. **設定列負擔**：桌機／行動版為時段控制保留 DOM、CSS 與 `updateRailSummary` 的時段摘要，與介面精簡方向衝突。

### 目標

- 分析、管制圖、問題偵測、報告預覽與 AI 摘要**一律使用該回合匯入的全部量測列**（`S.rows` ≡ 回合匯入列，不再因時段變動 `rows` 參考內容）。
- 分析設定列**不再出現**時段篩選相關控制與狀態文案。
- 報告「資料範圍揭露」**不再列出**「時間區間篩選」「部分焊墊板數」。
- 保留 CSV／匯入管線對日期、時間欄的解析與 `r.ts` 欄位（供排序、顯示、匯出等其他用途）。

### Non-goals

- 不變更 `analyze()`、`detectIssues()` 公式、門檻與 `test:slow` 期望。
- 不變更 D1／R2 schema、Worker `/api/*` 契約。
- 不實作資料遷移或自動回補已被舊版篩選寫進本機回合快照的缺失列（需從雲端紀錄重新開啟原始匯入）。
- 不新增替代性的子集控制（板號子集、抽樣、功能旗標）。
- 不刪除 `formatUtc8Date`、`fmtNowUtc8` 及匯出檔名時間戳邏輯。

---

## 2. System Architecture

### 2.1 元件職責（變更後）

| 元件 | 變更前 | 變更後 |
|---|---|---|
| `#railTimeWrap` 及子節點 | 時段輸入、套用／清除、摘要 | **刪除** |
| `applyTimeFilter` | 篩選 `S.rows`、設定 `timeFilter`／`partialBoards`、`recompute` | **刪除** |
| `S.timeFilter` | 記錄起迄字串 | **刪除** |
| `S.partialBoards` | 部分焊墊板號列表 | **刪除** |
| `S._rawRows` / `run._rawRows` | 篩選前快照與 `stencilRescale` 去重用 | **保留**（與 `rows` 同參考於 `addRun`；不再作篩選還原來源） |
| `buildRows` / `parseCSV` | 解析時間欄 → `r.ts` | **不變** |
| `computePadCoverage`（FR-9） | 幾何焊墊分母不受時段縮小 | **行為不變**；文件註解改寫 |

### 2.2 資料流

```mermaid
flowchart LR
  import[匯入parseCSVbuildRows]
  runRows[回合rows與_rawRows]
  session[S分析狀態]
  analyze[analyze與detectIssues]
  report[reportMd與匯出]
  import --> runRows --> session --> analyze --> report
```

移除後**不存在**自 `applyTimeFilter` 至 `S.rows` 子集的分支。

### 2.3 關鍵互動序列（實作後）

1. 使用者匯入或切換回合 → `switchRun` 載入 `n.rows`（全量）→ `recompute`。
2. 使用者改群組／量測項目／規格 → 仍對**全量** `S.rows` 分析（群組篩選為顯示維度，非刪列）。
3. 產生報告 → 第八節僅揭露筆數、板號推定、座標狀態等；無時段與部分板欄位。

---

## 3. Data Model & Interfaces

### 3.1 實體與狀態

| 欄位／儲存 | 變更 |
|---|---|
| `S.rows` | 恆為回合匯入列集合（可就地換算高度 µm 等，不因時段替換為新陣列子集） |
| `S._rawRows` | 保留；`addRun` 設 `_rawRows: rows`（與 `rows` 同一參考） |
| `S.timeFilter` | 移除 |
| `S.partialBoards` | 移除 |
| IndexedDB `spi-spc` `runs[].rows` | 契約不變；值應為全量（舊客戶端曾存篩選後子集者見 §4.3） |
| Cloudflare D1 紀錄 | 從未持久化時段篩選；無 migration |

### 3.2 API 契約

**無變更。** 時間篩選從未進入 `/api/records`、`/api/analyze` 請求本文。

### 3.3 模組匯出（Node 測試沙箱）

實作階段自 `spi-spc.html` `<script id="core">` 的 `module.exports` **移除** `applyTimeFilter`。其餘匯出與 `SPI_TEST_HOOK` 維持；若測試曾直接呼叫 `applyTimeFilter`，改刪對應案例。

### 3.4 相關文件同步（實作階段）

| 文件 | 動作 |
|---|---|
| [`docs/spec-windows-parity-rfc.md`](spec-windows-parity-rfc.md) §驗收 | 刪除 Given「時間篩選使部分焊墊這段沒有量測」；100% 覆蓋率 Given 移除時間篩選子句 |
| [`docs/spec-entry-interface-streamlining-rfc.md`](spec-entry-interface-streamlining-rfc.md) | 「時段篩選閉區間預設模式」標記**不採用** |
| `lib/windows-parity.mjs`、`spi-spc.html` FR-9 註解 | 「時間篩選不縮分母」→「分母始終為幾何相異焊墊」 |

---

## 4. Security, Performance & Rollout

### 4.1 威脅模型

- 移除客戶端子集路徑後，無 `ts` 列不再因時段篩選被靜默排除（fail-visible 改為「全量納入」）。
- 無新增 XSS／注入面；刪除之 UI 為純文字輸入，移除後攻擊面不增。

### 4.2 效能

- 正向：刪除每次篩選的全列 scan 與 `partialBoards` 組裝。
- 取捨：大檔無法再以時段縮小 `detectIssues` 輸入；不另做抽樣或後端篩選（與 Non-goals 一致）。既有 `WORKER_MIN`／DetCache 路徑不變。

### 4.3 發布與回溯

- **無功能旗標**；上線即為全量分析語意。
- **版本**：實作 PR 依 SemVer 遞增 minor（使用者可見功能移除）；**本 RFC 提交不升版**。
- **回**回滾**：還原實作提交即可恢復舊 UI（不建議長期並存）。
- **本機資料**：曾套用篩選並 `saveRunsNow` 的回合，還原快照仍可能為截短列；規格要求 UI 提示使用者自雲端紀錄重新開啟以取得全檔（可於實作時評估是否在「回合管理」加一次性說明；非本 RFC 硬性範圍）。

---

## 5. 實作盤點（供後續 PR）

### 5.1 HTML／CSS（[`spi-spc.html`](../spi-spc.html)）

**刪除 DOM（約 1002–1010 行）**

- `#railTimeWrap`、`#btnRailTimeToggle`、`#railTimePopover`、`#inTimeStart`、`#inTimeEnd`、`#btnTimeFilter`、`#btnTimeFilterClear`、`#timeFilterState`、`#railTimeSummary`

**刪除 CSS**

- `.rail-time-wrap`、`.rail-time-pop`
- `@media (max-width:600px)…` 內對 `#btnRailTimeToggle`、`.rail-time-pop` 的規則
- `@media(pointer:coarse)` 選擇器中的 `#btnRailTimeToggle`

**刪除腳本**

- `applyTimeFilter` 函式（約 3390–3473 行）
- `syncRailTimeUI` 與 `#btnTimeFilter`／`#btnTimeFilterClear`／`#btnRailTimeToggle` 綁定（約 9078–9114 行）
- `updateRailSummary` 內 `timeText`、`#railTimeSummary`（約 12354–12355 行）
- `renderPmap`／`cell` 內 `isPart`／「部分」subpill（約 6384 行）
- `reportMd` 第八節兩行：時間區間篩選、部分焊墊板數（約 9047–9048 行）
- `switchRun` 內 `S.timeFilter = null`、`S.partialBoards = null`（約 8308 行）
- `module.exports` 中的 `applyTimeFilter`（約 6076 行）
- `SPI_TEST_HOOK` 若匯出 `applyTimeFilter` 則一併移除

### 5.2 保留

- `stencilRescale` 對 `run._rawRows`／`S._rawRows` 的 Set 去重
- `clearPlacePreviewFromRun`／`applyPlacePreviewToRun` 的 `allRows` 雙陣列走訪
- `DET_SKIP` 含 `_rawRows`
- `formatUtc8Date`、`fmtNowUtc8`、匯入 `time`／`date` 欄位映射

---

## 6. Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-1 | 已載入含時間欄的 SPI 回合 | 檢視 `.rail` 分析設定列 | 無「時段篩選」、無起迄時間輸入、無套用／清除按鈕 |
| AC-2 | 同上 | 檢視總覽、管制圖、問題偵測、報告 | 分析筆數等於匯入列數；報告無「時間區間篩選」「部分焊墊板數」 |
| AC-3 | 匯入列部分無 `ts` | 執行分析 | 無 `ts` 列仍留在 `S.rows` 並參與統計（與現有全量語意一致） |
| AC-4 | 已上傳幾何焊墊清單 | 計算覆蓋率 | 分母仍為幾何相異焊墊；與 FR-9 一致 |
| AC-5 | 問題地圖有板號格 | 渲染 | 無「部分」警告 subpill（原 `partialBoards` 驅動） |

### 6.1 測試調整（實作 PR）

| 檔案 | 動作 |
|---|---|
| [`tests/step14.test.mjs`](../tests/step14.test.mjs) | 刪除 `M-21: applyTimeFilter sequence R5-18 and partial board detection` |
| [`tests/ui.smoke.test.js`](../tests/ui.smoke.test.js) | 改為斷言 `.rail` **不含** `#railTimeWrap`／`#inTimeStart`（取代現有「應整合於 rail」斷言） |
| `formatUtc8Date` 等時間格式化測試 | **保留** |

建議實作 PR 至少執行：`node --test tests/ui.smoke.test.js`；統計無變更時不必重跑 `test:slow`，除非觸及核心匯出清單。

### 6.2 UI 驗證矩陣（實作 PR）

依 `AGENTS.md`：build 產物下在 **1440／820／390／320** 四種寬度、明亮與深色各跑一輪，確認 `.rail` 無因刪除時段區塊導致換行迴歸；設定列仍含回合、量測項目、群組、`#railSpecBtn` 等核心控制；整頁無橫向溢出，觸控裝置下控制項熱區 ≥44px。

---

## 7. Sequences（請求／事件，實作後）

```text
使用者切換回合
  → switchRun(id)
  → S.rows := n.rows（全量）
  → syncControls(); recompute()

（不再存在）
使用者按「套用篩選」
  → applyTimeFilter(start, end)
  → S.rows := filtered subset
```

---

## 8. 未決事項

| 項目 | 決策 |
|---|---|
| 本機已截短回合是否自動偵測並提示 | 實作 PR 可選；預設不阻擋分析 |
| 是否在 CHANGELOG 單列「移除時段篩選」 | 實作 PR 必填 |

---

## 9. 與其他 RFC 關係

- 與 [`docs/spec-ui-streamlining-rfc.md`](spec-ui-streamlining-rfc.md) 精簡 `.rail` 列寬目標一致：刪除 `#railTimeWrap` 有助單列容納 `#railSpecBtn`。
- 與 [`docs/spec-windows-parity-rfc.md`](spec-windows-parity-rfc.md) FR-9 數學契約一致；僅驗收敘述移除時段依賴。
