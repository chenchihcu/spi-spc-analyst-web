# RFC：SPI·SPC 分析台介面精簡與架構整併規格書

- **狀態**：已核准實作（Approved，Triage `[F1]`）
- **適用版本**：基於 `spi-spc.html` v10.15.6（目標納入 v10.16.0）
- **參考依據**：
  - `AGENTS.md`
  - `APPLE_IPHONE_WEB_UI_UX_STANDARD.md`
  - `docs/spec-ui-copy-rfc.md`

---

## 1. 背景與現況問題診斷

依據實機檢視與原始碼盤點，介面在桌機寬螢幕（`1280px`–`1440px`）與跨分頁動線上存在以下結構性膨脹問題：

1. **頁首 (`header.top`) 被迫換行兩列**：`.brand` 內含 Mitcorp SVG、主標題與版本更新時間，加上 `.toprow` 內包含狀態膠囊、記錄庫、匯出、`#duoToggleBtn`（雙欄切換）及 `更多 ▾`，總寬度超過 `.wrap`（`1280px`）可用空間，導致控制列折行。
2. **分析設定列 (`.rail`) 寬度超載**：`.rail-fields` 內擺放獨立段落 `#groupBasisNote` 佔據約 150px 橫向寬度，迫使 `#railSpecBtn`（`鋼板／規格`）折行至第二列。
3. **主分頁列 (`.tabs-bar`) 扁平堆疊 14 個分頁**：6 個次級分析頁面（交叉驗證、進階分析、統計資料、試產比較、DFM 建議、實驗驗證）與一級核心頁面並列，導致頂部導覽擁擠且面板內部重複 6 份 `.panel-subnav`。
4. **`#p-data` 子分頁過多（6 個）與職責重複**：
   - `[data-sub="records"]` 與頂端 `#recPickerModal`（記錄庫彈窗）功能重疊。
   - `[data-sub="stencil"]` 與 `[data-sub="specs"]` 皆屬於「規格與製程基準」定義。
   - `#placeRow` 重複包含「管理者上傳座標檔」全套表單，而 `#recPickerModal` 座標檔庫已具備更完整的驗證與防呆上傳區（`#boxUploadPlaceForm`）。
   - `#cardAuxData` 重複放置 AOI、GR&R、幾何焊墊上傳入口。
5. **頁內冗餘介面與雙軌匯出出口**：首頁橫幅 `#startupDbBanner`、本頁目錄 `<nav id="toc">`、關係圖 `#cardRelChart`，以及分散於各頁／選單的 14 顆重複單項匯出／列印按鈕（與 `#exportCenterModal` / `#btnRepPrint` 重複）。

### 量化精簡目標

| 指標 | 現況 (v10.15.6) | 精簡後目標 |
|---|---|---|
| 桌機 `≥1280px` `header.top` 列數 | 2 列（換行） | **1 列** |
| 桌機 `≥1280px` `.rail` 設定列列數 | 2 列（`#railSpecBtn` 掉行） | **1 列** |
| 主分頁 `.tabs` 數量 | 14 個 | **10 個**（收斂 6 個次級分頁為 2 個複合頁） |
| `#p-data` 子分頁數量 | 6 個 | **4 個**（`匯入資料`、`規格與鋼板`、`回合管理`、`AI 設定`） |
| 面板內 `.panel-subnav` 重複份數 | 6 份 | **2 份**（父層共構） |
| 單項重複匯出／列印按鈕數 | 14 顆重複行內／選單鈕 | **0 顆重複行內／選單鈕**（統一由匯出中心與報告輸出負責） |

---

## 2. 範圍與硬性不變量（Non-Goals & Hard Invariants）

本 RFC **僅涵蓋 UI 殼層、導覽路由、資訊架構與元件減重**。以下系統契約必須嚴格維持位元級一致（Zero Functional Regression）：

1. **統計與製程演算法不變**：`analyze()`、`detectIssues()` 之規則條件、事實描述、推論、證據圖表、Nelson 規則、Cpk／Ppk、Moran's I／LISA、Hotelling T² 與所有 `lib/*.mjs` 函式（含 `lib/windows-parity.mjs`）**不得更動計算公式與輸出數值**。
2. **雲端資料架構與 Fail-Closed 不變**：Cloudflare D1 Schema、Migration、Worker `/api/*` 端點與 `RecDB.create` 未登入拋錯守衛保持不變。
3. **視覺設計語言與無障礙底線不變**：保留 `--bg`、`--accent:#A3521D`、Barlow／IBM Plex／Noto Sans TC 字體系統（全站字級 ≥12px、CJK 雙字重 400/700）、明亮預設主題、`spi-spc.html` 單檔部署架構、`IOS-01`–`IOS-18`。
4. **中文介面規範不變**：嚴格遵守 `docs/spec-ui-copy-rfc.md`，所有標題與按鈕只用中文名稱，不加括號英文譯名。

---

## 3. 完整合併／刪除／搬移／收折盤點總表

| 類別 | 項目 / DOM Selector | 處置方式 | 目標狀態與耦合清理重點 |
|---|---|---|---|
| **刪除** | `<span class="tag" hidden>` | 永久刪除 | 移除無作用隱藏標籤與 `.brand .tag` 規則 |
| **刪除** | `#srcName` / `#srcBoards` / `#srcPads` 隱藏膠囊 | 永久刪除 | 保留 `header.top .toprow .chip` CSS 權重守衛；改查 `#railChipSummary` / `curRun()` |
| **刪除** | `#groupBasisNote` | 永久刪除 | 改將分組依據寫入 `#selGroup` 之 `title`/`aria-label`，保留 `#railChipSummary` |
| **刪除** | `<nav class="toc" id="toc">` | 永久刪除 | 移除 `buildToc()`、呼叫點及 `.toc` CSS；保留 `stickyH()`、`railH()`、`updateVars()` |
| **刪除** | `#startupDbBanner` | 永久刪除 | 移除 `BANNER_*`、`updateStartupDbBanner()` 與按鈕綁定；**保留 `<style id="bootHide">` 與解鎖敘述防 CLS** |
| **刪除** | `#cardRelChart` | 永久刪除 | 移除 `renderRelChartUI()` 與 `#selRelChart` 事件；**保留 `lib/windows-parity.mjs` 函式不變** |
| **刪除** | `#cardAuxData` | 永久刪除 | 移除 `updateAuxDataStatus()`、`setupAuxData()` 與呼叫點（完整保留 `#mapBox` 及 `.card` 閉合標籤） |
| **刪除** | `#placeRow` 重複欄位 (`#placePart`, `#placePartHint`, `#placeRev`, `#placeSide`, `#placeIn`, `#placeUnit`) | 精簡欄位 | **保留 `saveControlledPlacement()` 供 Modal 用**；`#placeRow` 只留 `#btnSelectPlace`、`#btnSelectPlaceError`、`#placeClear`、`#placeState` |
| **刪除** | `[data-sub="records"]` 與 `#recCard`（含 `#recSpi`、`#recPlace`、`#recQ`） | 刪除重複區；部分資產搬移 | 移除 `renderRecords()` 與 `#recCard` 監聽器；將 `#recSpec`、`#adminUsersSection`、`#recAuditBox` 搬進 `#recPickerModal` |
| **刪除** | 14 顆重複匯出／列印按鈕 | 永久刪除 | 刪 `#btnIssMd/#btnIssCsv/#btnIssXlsx`、`#btnDl3d`、`#btnStatsCsv`、`#btnCmpMd`、`#btnDfmCsv/#btnDfmMd`、`#btnAIMd`、`#btnPrint/#mBtnPrint`、`#btnExpMd/#btnExpBoard/#btnExpDef`；**重構 `triggerExportByType()` 直接呼叫具名匯出函式** |
| **搬移** | `#duoToggleBtn` | 移入選單 | 移入 `#moreMenu`（`role="menuitem"`）並於 `#moreSheet` 增 `#mBtnDuo`，保留 SVG 與 `aria-*` 契約 |
| **搬移** | `#adminUsersSection`, `#recSpec`, `#recAuditBox` | 移入彈窗 | 納入 `#recPickerModal` 第 3 頁籤 `#boxPickSpecs`（`#btnPickSpecs`），維持 `data-ract` 與測試選擇器契約 |
| **合併** | `#p-cross` + `#p-adv` + `#p-stats` | 合併為 1 個 Panel | 合併為 `#p-deep`（`data-tab="deep"`），共用 1 組 `.panel-subnav` 與 3 個 `[data-subview="cross\|adv\|stats"]` |
| **合併** | `#p-compare` + `#p-dfm` + `#p-lab` | 合併為 1 個 Panel | 合併為 `#p-improve`（`data-tab="improve"`），共用 1 組 `.panel-subnav` 與 3 個 `[data-subview="compare\|dfm\|lab"]` |
| **合併** | `[data-sub="stencil"]` → `[data-sub="specs"]` | 合併為 1 個子分頁 | 子分頁標題改為 `規格與鋼板`，兩張鋼板／開孔卡片併入 `[data-sub="specs"]` |
| **替代** | `#inWipe` 數字輸入框 | 改為唯讀顯示 | 改為 `<span id="wipeDisplay" class="num"></span>` + `#btnGoWipeSpec` 連結至 `data/specs` `#inWipe2` |
| **收折** | 問題地圖 `#pmap` + `.legend` | 預設收合 | 外層包入預設關閉之 `<details class="card pmap-details" id="pmapDetails">`（`44px` 觸控高；`beforePrint` 在 `issues` 頁暫時展開，於 `afterPrint` 還原） |
| **緊湊** | `#impFlowSteps` 五步驟導覽 | 橫向單列膠囊 | 精簡步驟描述長度並單列緊湊排佈，保留所有 `data-flow-step` / `data-state` / `data-flow-state` 屬性契約 |

---

## 4. 前後 DOM 拓撲與 Container Flattening 決策

```text
【精簡 10 Tabs / 10 Panels】
.tabs: data | issues | overview | control | capability | sim3d | deep | improve | ai | report
                                                                 │      │
                                       ┌─────────────────────────┘      └──────────────────────────┐
                                       ▼                                                           ▼
                          #p-deep (panel)                                            #p-improve (panel)
                          ├─ nav.panel-subnav (1x)                                   ├─ nav.panel-subnav (1x)
                          ├─ [data-subview="cross"]                                  ├─ [data-subview="compare"]
                          ├─ [data-subview="adv"]  (#cardMorph 直接子層)              ├─ [data-subview="dfm"]
                          └─ [data-subview="stats"]                                  └─ [data-subview="lab"]

【#p-data 4 Subtabs】
import | specs (標籤：規格與鋼板) | runs | ai-cfg
└─ 資料庫瀏覽、規格版本清單、管理者角色與稽核紀錄統一移至 #recPickerModal (記錄庫 3 頁籤)
```

- **Zero Card-in-Card**：`[data-subview]` 與 `[data-sub="specs"]` 僅使用語義網格容器（`display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; min-width: 0`），`#cardMorph` 為 `#p-deep > [data-subview="adv"]` 直接子節點，保持 `$$('#p-deep .card .card').length === 0`。

---

## 5. 核心契約與路由規範

1. **複合路由 & Clean-Break**：
   - `ALL_TABS = ["issues","overview","control","capability","sim3d","deep","improve","ai","report","mail","data","share","shares"]`。
   - 舊 hash（`#cross`、`#adv`、`#stats`、`#compare`、`#dfm`、`#lab`）一律視為無效 hash，安全降落 `"issues"`。
   - `parseTabTarget(raw)` 解析 `deep[/cross|adv|stats]` 與 `improve[/compare|dfm|lab]`；預設子視圖分別寫回 `#deep`／`#improve`，非預設子視圖寫回 `#deep/adv`、`#improve/dfm` 等。
   - `setTab()` **先顯後繪**：先設定 `S.tab`、`S.deepSub` / `S.improveSub`、`[data-subview]` `hidden`、`.panel-subnav button[aria-current="page"]` 與 `showPanels()`，再呼叫 `renderTab()`，避免 Chart.js `offsetParent === null` 空畫。
2. **全站連動集合**：
   - `detectIssues()` 與 `GOLAB` / `goto()`：`go` 目標正規化為 `{tab:"deep",sub:"cross|adv"}` 與 `{tab:"improve",sub:"dfm"}`。
   - `AN_TABS` 判斷含複合動態檢查：`isAnalysisScopeTab()` 在 `deep/stats` 回傳 `false`，顯示 `RAIL_NOTE["deep:stats"]`。
   - `F_TABS = new Set(["issues","overview","deep","improve","report"])`。
   - `COLLAPSE_TABS = new Set(["overview","control","capability","sim3d","deep","improve"])`（記憶鍵含子視圖識別）。
   - `S.duo` 互斥守衛：保持 `S.duo` 初始字面量結構不變，加入 `duoPanelId(route)` 確保 `duoPanelId(left) !== duoPanelId(right)`；`cycleDuoRightTab` 為 `["sim3d","deep/cross","control","capability","deep/adv"]`。
   - `#moreSheet` 快捷列：保留 `['sim3d','deep/cross','deep/adv','deep/stats','improve/compare','improve/dfm','improve/lab','ai','report','data']` 與 `#mBtnDuo`。
3. **全域匯出解耦 (`triggerExportByType`)**：
   - 移除 14 顆重複按鈕（含 `#btnPrint`/`#mBtnPrint`，改由 `#btnRepPrint` 或 `Ctrl/Cmd+P` 觸發列印）。
   - 將匯出邏輯獨立為具名函式並掛載於 `window.SPI_TEST_HOOK`，`triggerExportByType(type)` 直接呼叫對應匯出函式，不再透過 DOM `.click()` 代理。
4. **`#recPickerModal` 三頁籤**：
   - `#btnPickSpi` / `#btnPickPlace` / `#btnPickSpecs`；`"specs"` 分頁隱藏 `#pickSideSeg` 與 `#pickQualitySeg`，顯示 `#adminUsersSection`、`#recSpec` 與 `#recAuditBox`，沿用 `#recPickerQ` 與 `#pickPartFilter` 篩選與 `[data-ract]` 操作；`openRecord()` 錯誤同步寫入 `toast` 與 `#recPickerNotice`。

---

## 6. 實作驗收矩陣（UI）

依 `AGENTS.md`：以 **build 產物**在 **1440／820／390／320** CSS px、**明亮／深色**各驗一輪；涵蓋 10 個主分頁、`#p-data` 四子分頁、`#moreMenu`、`#recPickerModal`（含三頁籤）與 `#exportCenterModal`。每頁檢查：

- `documentElement.scrollWidth === clientWidth`（`.rail` 單列目標在 ≥1280px 寬度須達成）
- 觸控熱區 ≥44px（`tests/mobile-layout.test.mjs` 對照）
- `devicePixelRatio > 1` 下同一頁至少進出兩次（3D、LISA 等 canvas 尺寸不累積放大）
- 深色主題下報告預覽文字對比符合既有守則

無法於 CI 模擬者（例如 `pointer:coarse` 於 ≥768px）標 `NOT TESTED` 並列於驗收紀錄。
