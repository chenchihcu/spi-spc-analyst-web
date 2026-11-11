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
- 標題：`N 個問題定義（M 項統計發現）：嚴重 a、警示 b、資訊 c`（a/b/c 為卡片張數）。

## 驗收

- `tests/problem-cases.test.mjs`
- `tests/corroboration.test.mjs`、`tests/issues-fields.test.mjs`、`tests/step12.test.mjs`、`tests/ui.smoke.test.js`
