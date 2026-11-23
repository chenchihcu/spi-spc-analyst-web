# RFC：問題定義整併與焦點問題收斂

**狀態**：底層整併已實作（v10.15.10）；問題頁與報告焦點問題收斂已實作（v10.38.13，2026-11-23）  
**範圍**：`detectIssues` 後處理 `buildProblemCases` 與 CSV／XLSX 末兩欄維持相容；問題頁 UI 以 `buildFocusedProblems` 收斂為最多 6 張「焦點問題」卡並內嵌預設收合的統計證據折疊區；`issuesMd`、`reportMd` 與 `renderReport` 在原統計發現清單前新增「焦點問題摘要」；不改統計門檻與 `F.meta.verdict` 計數。

## 目標

底層仍由 `buildProblemCases` 產出 `F.meta.cases` 與卡片 `case_id`／`case_title` 供 CSV／XLSX 相容；問題頁將數十項分散的統計發現依 6 大工程根因收斂為最多 6 張高聚焦「焦點問題」卡，每張卡以白話標題句「哪裡＋什麼現象 → 做什麼」直接呈現核心結論，並把底層統計發現收折為卡片底部的證據明細。

## 不變量

- 不重排 `F`；卡片 `id`、`title`、`same_phenomenon`、`corrob` 不變。
- 每筆統計發現經 `focusDomainOf` 6 階優先序歸入**恰好一個**焦點問題（`sum(g.count) === F.length`），未知或缺少 `sig` 的發現由第 6 類 `spike` 保底。
- `verdict` 仍數卡片張數，不數案數或焦點問題數。
- `failureModes` 規則不變。
- CSV／XLSX 仍於末兩欄保留 `case_id`、`case_title`；`/api/analyze` 白名單 `ALLOWED_KEYS` 仍保留 `"問題定義"` 以相容舊版客戶端。

## 6 大工程焦點問題優先表（先符合者勝）

1. `measurement`（量測與規格設定）：`sig.t ∈ {unit, msa}`
2. `align`（印刷對位偏移）：`sig.t === "align"`；或 `sig.t ∈ {board, local}` 且 `sig.off`；或 `sig.t ∈ {nelson, iso}` 且 `sig.k ∈ {offx, offy}`
3. `aperture`（元件開孔與能力不足）：`sig.t ∈ {sys, pad, dfm, lowte, mcd, repeated}`
4. `process`（錫量趨勢與擦拭／停線）：`sig.t ∈ {drift, wipe, pause}`；或 `nelson` 且 `ruleId ∉ {1, 4}`
5. `squeegee`（刮刀與板面均勻性）：`sig.t ∈ {stroke, grad, fig, spatial}`；或 `nelson` 且 `ruleId === 4`
6. `spike`（單板與局部突發異常）：非偏移 `board`/`local`/`iso`、`morph`、`nelson` 規則 1，以及任何未列出的新類型或缺少 `sig` 的發現（保底）

## 介面與匯出

- **問題頁主標題與篩選列**：`#issHead` 顯示 `N 個焦點問題：嚴重 a、警示 b、資訊 c`（a+b+c=N，窄元件範圍加上範圍前綴；0 筆時維持空狀態文字，不顯示 `0 個焦點問題`）。當 `S.F` 含 `sig.t === "msa"` 時，於 `#issSub` 頁首提示「量測系統變異偏大，以下判讀可信度降低。」。篩選列僅保留嚴重度按鈕與「全部展開／全部收合」，移除 `#selIssCat` 面向下拉選單。
- **嚴重度按鈕篩選語意**：依焦點問題卡的最高嚴重度 `g.lv` 篩選，按鈕上的數字嚴格等於點選後畫面顯示的 `.iss-focus` 張數；展開某張焦點卡的證據區時，該大類內所有成員統計發現（含較低嚴重度佐證）均完整列出。
- **焦點問題卡與證據折疊區**：`.iss-focus` 預設展開白話標題句 `{哪裡}{現象} → {動作}`、類別副標、去重截斷後的影響群組／板號（最多 6 項 + `另 N 個`）、重點現象與建議動作；底部 `<details class="iss-ev-fold">` 預設收合，內含成員 `.iss-card`（總數受 `ISS_PAGE = 150` 分批限制）。窄範圍下的 `#issBoardScope` 全板問題區同樣以 `buildFocusedProblems` 收斂為焦點問題卡。
- **報告焦點問題摘要**：`issuesMd`、`reportMd`（第二章）與 `renderReport`（`#repSec3`）皆在原統計發現清單**前面**輸出「焦點問題摘要」表格（欄位：嚴重度、焦點問題、影響範圍、建議動作、統計證據，證據編號最多 10 項 + `另 N 項`），原統計發現清單保持完整不變。
- **AI 摘要輸入（`aiPayload`）**：維持送出 `系統偵測問題清單`，不送出 `問題定義` 欄位。

## 驗收

- `tests/focused-problems.test.mjs`（6 階歸類、21 種已知 `sig.t`、未知保底、白話標題句、20 群組截斷、報告摘要段落）
- `tests/problem-cases.test.mjs`、`tests/issue-detection-audit.test.mjs`（底層 `buildProblemCases` 與 CSV 相容）
- `tests/ui.smoke.test.js`、`tests/issue-evidence-chart.test.mjs`、`tests/component-scope.test.mjs`、`tests/mobile-layout.test.mjs`、`tests/print.test.mjs`（焦點問題 UI、窄範圍與突變檢核、44px 觸控熱區、列印展開還原）
- `tests/data-export-defects.test.mjs`、`tests/report-ai.test.mjs`
