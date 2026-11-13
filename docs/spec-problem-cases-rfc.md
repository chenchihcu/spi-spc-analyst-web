# RFC：問題定義整併

**狀態**：已實作（v10.15.10）  
**範圍**：`detectIssues` 後處理 `buildProblemCases`、問題頁 UI、匯出與 AI 輸入；不改統計門檻與 `F.meta.verdict` 計數。

## 目標

同一根因的多張統計卡收成「問題定義」一案；統計卡仍是證據，公式與卡片欄位不變。

## 不變量

- 不重排 `F`；卡片 `id`、`title`、`same_phenomenon`、`corrob` 不變。
- `verdict` 仍數卡片張數，不數案數。
- `failureModes` 規則不變。
- CSV 僅在末欄追加 `case_id`、`case_title`。

## 合併規則摘要

見計畫 `buildProblemCases`：群組能力、趨勢與 Nelson、刮刀／底面污染、停線、對位、子板與 Moran、M-09 分桶等；未命中者各成一案。

## 介面

- 預設「依問題定義」；可切「依統計規則」平鋪。
- 標題與嚴重度篩選鈕的計數單位跟著檢視（v10.23.2）：
  - 依問題定義：`N 個問題定義：嚴重 a、警示 b、資訊 c（M 項統計發現）`，a+b+c=N，案的嚴重度為成員最高嚴重度；篩選鈕依案的嚴重度篩選，案內成員全數顯示。
  - 依統計規則：`M 項統計發現：嚴重 a、警示 b、資訊 c（N 個問題定義）`，a+b+c=M，依卡片嚴重度篩選。
  - 舊版在案檢視顯示卡片張數，又同時以案與卡的嚴重度雙重篩選，使「警示／資訊」點下去的卡少於鈕上數字。

## 驗收

- `tests/problem-cases.test.mjs`
- `tests/corroboration.test.mjs`、`tests/issues-fields.test.mjs`、`tests/step12.test.mjs`、`tests/ui.smoke.test.js`
