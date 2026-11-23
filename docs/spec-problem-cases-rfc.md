# RFC：問題定義整併

**狀態**：底層整併已實作（v10.15.10）；介面／Markdown／AI 已簡化為單一統計發現視圖（2026-11-23）  
**範圍**：`detectIssues` 後處理 `buildProblemCases` 與 CSV／XLSX 末兩欄維持相容；問題頁 UI、`issuesMd` 與 `aiPayload` 統一採單一「統計發現」視圖，不改統計門檻與 `F.meta.verdict` 計數。

## 目標

底層仍由 `buildProblemCases` 產出 `F.meta.cases` 與卡片 `case_id`／`case_title` 供 CSV／XLSX 相容；使用者可見的問題清單、Markdown 匯出與 AI 摘要輸入統一以統計規則產出的「統計發現」單一呈現，消除兩套計數造成的判讀混淆。

## 不變量

- 不重排 `F`；卡片 `id`、`title`、`same_phenomenon`、`corrob` 不變。
- `verdict` 仍數卡片張數，不數案數。
- `failureModes` 規則不變。
- CSV／XLSX 仍於末兩欄保留 `case_id`、`case_title`；`/api/analyze` 白名單 `ALLOWED_KEYS` 仍保留 `"問題定義"` 以相容舊版客戶端。

## 合併規則摘要

見 `buildProblemCases`：群組能力、趨勢與 Nelson、刮刀／底面污染、停線、對位、子板與 Moran、M-09 分桶等；未命中者各成一案。

## 介面與匯出

- 問題頁僅提供單一「統計發現」平鋪檢視（依嚴重／警示／資訊分區標題列出，保留面向下拉篩選），移除「依問題定義／依統計規則」切換與雙重計數。
- 主標題與篩選鈕計數一致：`M 項統計發現：嚴重 a、警示 b、資訊 c`（a+b+c=M）；窄元件範圍下加上範圍前綴，且只計入歸屬範圍內的卡片。
- Markdown 匯出（`issuesMd`）直接輸出 `## 統計發現清單`，不再輸出 `## 問題定義` 段落或卡片標題尾端的 `（問題定義案 N）`。
- AI 摘要輸入（`aiPayload`）不再送出 `問題定義` 欄位，維持送出 `系統偵測問題清單`。

## 驗收

- `tests/problem-cases.test.mjs`、`tests/issue-detection-audit.test.mjs`（底層 `buildProblemCases` 與 CSV 相容）
- `tests/ui.smoke.test.js`、`tests/issue-evidence-chart.test.mjs`、`tests/component-scope.test.mjs`（單一統計發現視圖與窄範圍計數）
- `tests/data-export-defects.test.mjs`、`tests/report-ai.test.mjs`（`issuesMd` 與 `aiPayload` 移除問題定義）

