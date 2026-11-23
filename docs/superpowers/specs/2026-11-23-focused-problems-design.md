# 焦點問題收斂設計（v10.38.13）

日期：2026-11-23　狀態：待使用者核准　前置：PR #209（v10.38.12，單一「依統計規則」視圖）

## 1. 目標

問題頁目前列出數十項統計發現（使用者資料：42 項；範例資料：26 項），判讀負擔大。把它們依工程根因收斂為**最多 6 張焦點問題卡**。每張卡用一句白話標題說清楚「哪裡＋什麼現象 → 做什麼」，原統計發現收在卡片底部當作證據。

## 2. 範圍

| 變更 | 不變 |
|---|---|
| 問題頁 UI（`renderIssues`、`#issBoardScope`、篩選列、跳轉／列印／診斷返回） | `detectIssues()` 門檻、`F` 結構、`F.meta.verdict` |
| 新純函式 `focusDomainOf`、`buildFocusedProblems` | `buildProblemCases()`、`issuesCsv()`、`issuesXlsx()` |
| 報告：`issuesMd()`、`reportMd()`、報告預覽 `renderReport()` 的問題清單**前面**加「焦點問題摘要」 | `aiPayload()`、`/api/analyze` |
| 移除 `#selIssCat` 與 `S.issCat` | 各報告原有的統計發現清單 |

## 3. 歸類規則（依序判斷，先符合者勝，一筆只會落在一類）

| 序 | 條件 | 焦點類別 `key` | 類別名 |
|---|---|---|---|
| 1 | `sig.t ∈ {unit, msa}` | `measurement` | 量測與規格設定 |
| 2 | `sig.t==="align"`；或 `sig.t ∈ {board, local}` 且 `sig.off`；或 `sig.t ∈ {nelson, iso}` 且 `sig.k ∈ {offx, offy}` | `align` | 印刷對位偏移 |
| 3 | `sig.t ∈ {sys, pad, dfm, lowte, mcd, repeated}` | `aperture` | 元件開孔與能力不足 |
| 4 | `sig.t ∈ {drift, wipe, pause}`；或 `nelson` 且 `ruleId ∉ {1, 4}` | `process` | 錫量趨勢與擦拭／停線 |
| 5 | `sig.t ∈ {stroke, grad, fig, spatial}`；或 `nelson` 且 `ruleId===4` | `squeegee` | 刮刀與板面均勻性 |
| 6 | 其他：`board`、`local`、`iso`、`morph`、`nelson` 規則 1，**以及任何未列出的新類型或缺少 `sig` 的發現** | `spike` | 單板與局部突發異常 |

- 第 6 列是備援，所以 `sum(count) === F.length` 恆成立，類別數 ≤ 6。
- 測試列出目前程式中全部 `sig.t`（align, board, dfm, drift, fig, grad, iso, local, lowte, mcd, morph, msa, nelson, pad, pause, repeated, spatial, stroke, sys, unit, wipe），逐一斷言歸屬。日後新增規則類型時，必須明確決定歸屬，測試才會通過。

## 4. 資料結構

`buildFocusedProblems(F)` → 依 `lv`（ng > warn > info），再依 `count` 降序排列的陣列：

```
{ key, name, title, lv, members, count, ids,
  groups, moreGroups, boards, moreBoards, metrics,
  highlights, actions }
```

- `name`：類別名（第 3 節）。
- `title`：白話標題句，格式為 `{哪裡}{現象} → {動作}`，純文字：
  - 哪裡：有具體群組時寫 `U2 BGA 等 4 群組`；只有一個群組時只寫該群組。沒有群組、有板號時寫 `B03 等 3 片板`。兩者皆無時省略。
  - 先過濾佔位值：`全部元件`、`ALL（全部元件）`、`全部板`、`不適用`、`—`、空字串。
  - 現象與動作固定對應類別，不取成員長文：

    | key | 現象 | 動作 |
    |---|---|---|
    | aperture | 製程能力不足 | 檢查鋼板開孔與厚度 |
    | align | 印刷偏移 | 校正鋼板對位 |
    | process | 錫量隨時間變化 | 檢查擦拭週期與停線 |
    | squeegee | 板面錫量不均 | 檢查刮刀壓力與速度 |
    | spike | 局部突發異常 | 追查該板與該位置 |
    | measurement | 量測或規格待確認 | 確認量測設定與規格 |

- `groups`／`boards`：去重後最多 6 項，超過的數量放在 `moreGroups`／`moreBoards`，顯示為 `另 N 個`。
- `highlights`：嚴重度最高的前 2 筆成員標題。
- `actions`：去重後前 2 筆成員建議動作。
- `ids`：成員 `id`。報告中以 topList 樣式截斷，最多 10 個，其餘寫 `另 N 項`。
- 不改動 `F` 的順序與卡片屬性。

量測可信度提示：`F` 含 `sig.t==="msa"` 時，在頁首顯示一行純文字警示 `.iss-msa-note`「量測系統變異偏大，以下判讀可信度降低」。這行不掛在個別卡片上，報告摘要也同樣放一行。

## 5. 問題頁 UI

```
#issHead   6 個焦點問題：嚴重 2、警示 3、資訊 1
           [量測系統變異偏大…]（僅 msa 存在時）
#issFilter [全部 6] [嚴重 2] [警示 3] [資訊 1]  [全部展開] [全部收合]
#issList   ┌ .iss-focus（預設展開）────────────────────┐
           │ [嚴重] U2 BGA 等 4 群組製程能力不足 → 檢查鋼板開孔與厚度 │
           │ 元件開孔與能力不足 · 9 項證據                    │
           │ 影響：群組 … 另 N 個｜板號 …｜量測項目 …          │
           │ 重點：highlights[0]；highlights[1]                │
           │ 建議：actions[0]；actions[1]                      │
           │ ▸ 檢視 9 項統計證據（details.iss-ev-fold，預設收合）│
           └──────────────────────────────────────────────┘
```

- **嚴重度按鈕**依焦點卡的 `lv`（成員最高嚴重度）篩選，按鈕數字等於顯示張數。點「警示」時，最高為嚴重、但含警示成員的類別不會出現。這個語意寫進 RFC，並用測試鎖住。
- **證據區預設收合與分頁**：`<details class="iss-ev-fold">` 預設收合（不加 `open`），內部成員 `.iss-card` 沿用既有 `ISS_PAGE`（150）總量上限分批渲染，超過時顯示 `#issMore`「再顯示 N 項」按鈕；「全部展開」、`flashIssue`、`backDiagnostic`、`beforePrint` 會自動打開對應或全部 `.iss-ev-fold`。
- **窄範圍**：上方焦點卡只聚合 `sc.own`。`#issBoardScope` 的全板問題也用 `buildFocusedProblems` 收斂成焦點卡，排版相同，維持「全板分析，不隨元件範圍變動」說明。
- **0 筆**：`buildFocusedProblems([])` 回傳 `[]`。標題維持現有空狀態文字，不出現「0 個焦點問題」。
- **跳轉與列印**：
  - `flashIssue(id)`：找出所屬焦點卡；若該卡被 `S.issLv` 隱藏，切回 `all` 並重畫。接著產生並打開證據區，展開目標卡，呼叫 `issToolsState()`。
  - `ISS_OPEN` 用 `"f:"+key` 記錄已打開的證據區。
  - `afterPrint` 還原列印前的收合狀態。
- **版面守衛**：
  - `.iss-focus`、`.iss-ev-fold` 加 `min-width:0; overflow-wrap:anywhere`。
  - `@media(pointer:coarse)` 下 `.iss-ev-fold>summary` 設 `min-height:44px`，寫在基礎規則之後。
  - 不使用行內 `min-height`。所有文字經過 `esc()`。

## 6. 報告「焦點問題摘要」

三個輸出都放在原統計發現清單**前面**，原清單內容不變：

| 輸出 | 位置 | 格式 |
|---|---|---|
| `issuesMd(F, st)` | `## 統計發現清單` 之前 | `## 焦點問題摘要` + Markdown 表 |
| `reportMd()` | `## 二、問題偵測清單` 標題下、清單之前 | `### 焦點問題摘要` + Markdown 表 |
| `renderReport()` s3 | `二、問題偵測清單` 標題下、原表格之前 | `<h3>焦點問題摘要</h3>` + HTML 表（`esc()`） |

- 表格欄位：`嚴重度 | 焦點問題 | 影響範圍 | 建議動作 | 統計證據`。
  - 焦點問題欄：`title`。
  - 影響範圍欄：群組與板號，各最多 6 項加 `另 N 個`。
  - 建議動作欄：`actions`。
  - 統計證據欄：`#1、#4…` 最多 10 個加 `另 N 項`。
- 輸入一律用呼叫端已篩選範圍的 `F`（`scopedFindings()`），不另外重算全板。
- 0 筆時不輸出摘要段。

## 7. 分析範圍與突變檢查

- 問題頁、報告的焦點聚合都讀已篩選範圍的 `F`，符合 `AGENTS.md`「分析範圍一致」。
- `tests/fixtures/mutations-component-scope.json` 新增一項破壞：「`renderIssues` 的焦點聚合改用 `F0`（全板）取代範圍內 `F`」。這項破壞必須讓 `component-scope` 測試變紅。

## 8. 測試

| 檔案 | 內容 |
|---|---|
| `tests/focused-problems.test.mjs`（新） | 空陣列；`sampleData` 每筆恰好歸入一類、類別數 ≤ 6；全部 21 種 `sig.t` 的歸屬表；`nelson` 依 `ruleId` 與 `offx/offy` 分流；`board/local` 依 `off` 分流；未知 `t` 與無 `sig` 走 `spike`；排序；20 群組截斷（`另 14 個`）；`title` 格式與佔位值過濾；不改動 `F` |
| `tests/ui.smoke.test.js` | `.iss-focus` 1..6 張；證據區預設收合且延遲產生；標題格式與加總；嚴重度按鈕數字等於顯示張數；`flashIssue` 跨嚴重度打開證據區；全部展開／收合；`#selIssCat` 不存在 |
| `tests/component-scope.test.mjs` | 窄範圍標題計數依 `buildFocusedProblems(own)`；`#issBoardScope` 呈現焦點卡 |
| `tests/mobile-layout.test.mjs` | 拿掉 `#selIssCat` 斷言，改驗 `.iss-ev-fold>summary` 44px |
| `tests/ui-polish.test.mjs` | regex 改 `/焦點問題|統計發現/` |
| 報告測試（`report-ai`、`data-export-defects` 或新增案例） | 三個輸出都有摘要段，且位置在清單之前；0 筆時不輸出；截斷規則 |

## 9. 驗證與發布

- 版本：v10.38.13（開分支時若 main 已前進，則用 main 的下一號）。
- 驗證關卡（依 `AGENTS.md`「驗證避免重複」分批跑）：
  - 語法、smoke、受影響測試
  - `node tools/mutation-check.mjs`
  - `npm run test:slow`：偵測邏輯沒動，預期結果不變
  - `release-check:scans`
  - `build:cloudflare`
  - UI 驗證：1440／820／390／320 寬度 × 明亮／深色主題
- push、PR、合併需使用者另外授權。合併後讀回 Workers Build 狀態與正式站版本。
- 未實測的項目標記為 `NOT TESTED`，包括 iPhone 真機與正式站資料庫路徑。
