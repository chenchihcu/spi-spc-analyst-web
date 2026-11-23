# Simplify Issue List to Single Rule-Based View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將問題清單 UI、Markdown 匯出與 AI 摘要輸入簡化為單一「依統計規則（統計發現）」視圖與單一計數，移除「依問題定義」檢視切換與雙重計數，同時保留底層 `buildProblemCases` 與 CSV/XLSX `case_id`／`case_title` 欄位以維持資料格式相容。

**Architecture:** 在 `spi-spc.html` 移除 `S.issGroup` 切換狀態、`.iss-case` 折疊外殼與 `issueCaseRows()`，讓 `renderIssues()` 與 `flashIssue()` 一律以嚴重度分區平鋪呈現統計發現卡；`issuesMd()` 與 `aiPayload()` 同步移除使用者可見的「問題定義」段落與欄位。底層 `buildProblemCases()`、`F.meta.cases`、`issueCaseCounts()`、`issuesCsv()`、`issuesXlsx()` 與 `lib/analyze-core.mjs` 的 `ALLOWED_KEYS` 維持不變。

**Tech Stack:** Vanilla JavaScript / HTML / CSS（`spi-spc.html`）、Node.js `node:test` + `jsdom`、Cloudflare build（`npm run build:cloudflare`）。

**Spec:** [docs/spec-problem-cases-rfc.md](../../spec-problem-cases-rfc.md)（本計畫更新其介面與匯出段落以反映單一統計發現視圖；本輪使用者已於 `/grill-me` 確認 4 項設計決策：單一統計規則視圖、簡化 UI + Markdown + AI 並保留底層與 CSV/XLSX 相容、標題維持 `N 項統計發現：嚴重 a、警示 b、資訊 c`、列表沿用嚴重度分區平鋪）。

## Global Constraints

- 不破壞底層資料結構與匯出相容性：`detectIssues()` 仍產出 `F.meta.cases`、`x.case_id`、`x.case_title`；`issuesCsv()` 與 `issuesXlsx()` 末兩欄維持 `case_id`、`case_title`；`lib/analyze-core.mjs` 的 `ALLOWED_KEYS` 維持保留 `"問題定義"` 以相容舊版呼叫端。
- 不改統計公式、偵測門檻、卡片 `id`／`title`／`corrob`／`same_phenomenon` 或 `F.meta.verdict`。
- 分析範圍一致：`renderIssues()` 仍依 `issueScope()` 只計入 `sc.own` 並將全板問題列於 `#issBoardScope`；修改後須通過 `tests/component-scope.test.mjs` 與 `node tools/mutation-check.mjs`。
- 使用者可見文案遵守 `docs/spec-ui-copy-rfc.md`：中文標題、不附英文譯名、不留無意義靜態標籤。
- build 產物守衛：不放暫存檔進 `dist/`，`npm run build:cloudflare` 必須通過。

## Review Focus

- 空結果或窄範圍下 `own` 為 0 但 `board` > 0：`#issHead` 須顯示「未偵測到統計上顯著的問題」或 `${sc.label}：未偵測到歸屬此範圍的問題`，`#issSub` 須顯示全板問題提示，不可出現 `NaN` 或例外。
- 跳轉至分頁外或被嚴重度篩選隱藏的卡片（`flashIssue(id)`）：須自動切回 `S.issLv = "all"`、依嚴重度平鋪順序計算分頁索引並加大 `ISS_PG.n`、展開目標 `.iss-card` 並捲動至視窗中央。
- 多視角診斷返回（`DIAG.back`）：從卡片開啟診斷再返回時，須還原 `S.issLv`、`S.issCat`、`S.issEnt`、`ISS_OPEN`、`ISS_PG` 並正確聚焦，不得因移除 `issGroup` 或 `.iss-case` 報錯。
- 向後相容契約：`tests/problem-cases.test.mjs` 與 `tests/issue-detection-audit.test.mjs` 全部維持綠燈，`issuesCsv`／`issuesXlsx` 仍輸出 `case_id` 與 `case_title`，`lib/analyze-core.mjs` 同時接受帶或不帶 `"問題定義"` 的 payload。
- 窄元件範圍嚴重度計數：`#issHead` 與 `#issFilter` 嚴重度按鈕的數字須嚴格等於 `sc.own` 卡片的嚴重／警示／資訊張數，點選各嚴重度按鈕後顯示的 `.iss-card` 數量須等於按鈕數字。

---

### Task 1: 問題頁 UI 簡化為單一統計發現檢視

**Files:**
- Modify: `spi-spc.html:311-313`（移除未使用的 `.iss-case` CSS）
- Modify: `spi-spc.html:3914`（從 `S` 初始狀態移除 `issGroup`）
- Modify: `spi-spc.html:7712-7735`（簡化 `flashIssue` 移除 `caseView` 與 `.iss-case`）
- Modify: `spi-spc.html:7787-7793`（移除僅供案檢視使用的 `issueCaseRows`）
- Modify: `spi-spc.html:8018-8024`（從 `pmapSelect` 移除 `S.issGroup = "cases"`）
- Modify: `spi-spc.html:8172-8274`（簡化 `renderIssues` 為單一統計發現平鋪檢視）
- Modify: `spi-spc.html:8385-8392`（從 `DIAG.back` 儲存與還原移除 `issGroup` 與 `.iss-case`）
- Test: `tests/ui.smoke.test.js:44-97`
- Test: `tests/issue-evidence-chart.test.mjs:49`
- Test: `tests/component-scope.test.mjs:210-227`

**Interfaces:**
- Consumes: `issueCaseCounts(F)` 回傳 `{ cards: { ng, warn, info }, cases: { ng, warn, info } }`；`issueList(lv)` 回傳篩選後的統計發現陣列；`issueScope()` 回傳 `{ own, board, label } | null`。
- Produces: `#issHead` 顯示 `${F.length} 項統計發現：嚴重 ${c.ng}、警示 ${c.warn}、資訊 ${c.info}`（窄範圍加 `${sc.label}：` 前綴）；`#issFilter` 僅含嚴重度按鈕、面向下拉選單 `#selIssCat`、全部展開／收合按鈕（無 `[data-group]` 切換鈕）；`#issList` 僅輸出 `.sevhead` 與 `.iss-card`（無 `.iss-case`）。

- [ ] **Step 1: 更新 `tests/ui.smoke.test.js`、`tests/issue-evidence-chart.test.mjs` 與 `tests/component-scope.test.mjs` 的測試斷言（先紅燈）**

在 `tests/ui.smoke.test.js`：
- 第 45 行：將 `assert.ok(d.querySelectorAll("#issList .iss-case").length >= 1, ...)` 改為 `assert.equal(d.querySelectorAll("#issList .iss-case").length, 0, "首頁不再顯示問題定義折疊外殼")` 與 `assert.ok(d.querySelectorAll("#issList .sevhead").length >= 2, "首頁直接依嚴重度分段顯示統計發現")`。
- 第 71–90 行：移除案檢視與 `rulesBtn` 切換測試，改為斷言：
  ```js
  assert.equal(d.querySelector('#issFilter [data-group]'), null, "篩選列不再顯示依問題定義／依統計規則切換");
  assert.match($("#issHead").textContent, /^\d+ 項統計發現：嚴重 \d+、警示 \d+、資訊 \d+$/);
  const headN = $("#issHead").textContent.match(/\d+/g).map(Number);
  assert.equal(headN[1] + headN[2] + headN[3], headN[0], "嚴重度加總等於統計發現總數");
  chipCheck("#issList .iss-card");
  ```
- 新增 `flashIssue` 跨篩選／分頁檢核：點選 `[data-lv="info"]` 後呼叫 `w.eval(\`flashIssue(${ngId})\`)`，確認 `S.issLv` 切回 `"all"` 且 `#iss-${ngId}` 為 `open`。

在 `tests/issue-evidence-chart.test.mjs`：
- 移除第 49 行 `d.querySelector('#issFilter [data-group="rules"]').click();`（預設即為平鋪統計發現）。

在 `tests/component-scope.test.mjs`：
- 第 213 行：改為 `const listed = [...d.querySelectorAll("#issList > h3 ~ details.iss-card")].map((e) => +e.dataset.id);`。
- 第 224–225 行：移除 `const caseView = S.issGroup === "cases"; if (!caseView)` 條件，無條件斷言 `assert.match($("#issHead").textContent, new RegExp(`^元件 U2（群組 U2 BGA）：${own.length} 項統計發現：嚴重 ${sev.ng}、警示 ${sev.warn}、資訊 ${sev.info}$`));`。

- [ ] **Step 2: 執行受影響測試確認失敗**

Run: `node --test tests/ui.smoke.test.js tests/issue-evidence-chart.test.mjs tests/component-scope.test.mjs`
Expected: FAIL（因目前 `#issHead` 仍顯示 `問題定義` 且存在 `.iss-case` 與 `[data-group]` 按鈕）。

- [ ] **Step 3: 修改 `spi-spc.html` 移除問題定義 UI 檢視與切換狀態**

在 `spi-spc.html` 依序完成以下精確修改：
1. lines 311–313：刪除 `.iss-case,.iss-case-body` 與 `.iss-case>summary` 三行 CSS。
2. line 3914：從 `S` 物件移除 `issGroup:"cases",`。
3. lines 7712–7735 `flashIssue(id)`：
   - 移除 `const caseView=S.issGroup==="cases";`。
   - 嚴重度篩選檢查改為 `if (S.issLv!=="all" && !issueList().some(x=>x.id===id)) { S.issLv="all"; renderIssues(); }`。
   - 分頁索引改為 `const index=["ng","warn","info"].flatMap(lv=>list.filter(x=>x.lv===lv)).findIndex(x=>x.id===id);`。
   - 移除 `const group=el.closest(".iss-case"); if (group) ...`。
4. lines 7787–7793：刪除 `issueCaseRows` 函式與其註解。
5. line 8022 `pmapSelect(selection)`：移除 `S.issGroup = "cases";`。
6. lines 8172–8274 `renderIssues()`：
   - 第 8172–8173 行簡化為 `const F0=S.F||[],sc=issueScope(),F=sc?F0.filter(x=>sc.own.has(x.id)):F0,c=issueCaseCounts(F).cards,total=F.length;`。
   - 第 8186–8191 行簡化為：
     ```js
     $("#issHead").textContent=F.length
       ?`${F.length} 項統計發現：嚴重 ${c.ng}、警示 ${c.warn}、資訊 ${c.info}`
       :"未偵測到統計上顯著的問題";
     ```
   - 第 8201 行：移除 `[["cases","依問題定義"],["rules","依統計規則"]]` 與前置 `<span class="vsep"...>`。
   - 第 8204–8205 行 `#issExpand`：改為 `issueList().forEach(x=>ISS_OPEN.add(x.id)); $$("#issList details").forEach(d=>d.open=true); issToolsState();`。
   - 第 8211–8219 行：只綁定 `#issFilter [data-lv]` 點擊事件，移除 `data-group` 迴圈。
   - 第 8240–8258 行：刪除 `caseShell`、`if(S.issGroup==="cases")` 分支與 `S.issGroup` in `pgK`，直接執行嚴重度分區平鋪渲染（`["ng","warn","info"]`）。
   - 第 8267–8270 行：移除 `$$("#issList details.iss-case")` 的 `toggle` 監聽器。
7. lines 8385–8391 `DIAG.back`：移除 `group:S.issGroup`、`S.issGroup=b.group` 與 `el.closest(".iss-case")` 展開。

- [ ] **Step 4: 執行受影響測試確認通過**

Run: `node --test tests/ui.smoke.test.js tests/issue-evidence-chart.test.mjs tests/component-scope.test.mjs tests/ui-polish.test.mjs`
Expected: PASS（全部測試項目通過，0 failed）。

- [ ] **Step 5: Commit**

```bash
git add spi-spc.html tests/ui.smoke.test.js tests/issue-evidence-chart.test.mjs tests/component-scope.test.mjs
git commit -m "refactor(ui): simplify issue list to single rule-based statistical findings view"
```

---

### Task 2: Markdown 匯出與 AI 摘要輸入移除「問題定義」

**Files:**
- Modify: `spi-spc.html:7265-7301`（`issuesMd` 移除 `## 問題定義` 區塊與標題尾端 `（問題定義案 N）`）
- Modify: `spi-spc.html:12158`（`aiPayload` 移除 `問題定義` 鍵）
- Test: `tests/data-export-defects.test.mjs`
- Test: `tests/report-ai.test.mjs`

**Interfaces:**
- Consumes: `issuesMd(F, st)`、`aiPayload()`。
- Produces: `issuesMd(F, st)` 直接輸出標頭、`## 統計發現清單` 與 `fmMd(F, st)`，不含 `## 問題定義` 或 `問題定義案`；`aiPayload()` 不送出 `問題定義` 欄位，仍送出 `系統偵測問題清單`。`lib/analyze-core.mjs` 的 `ALLOWED_KEYS` 不變。

- [ ] **Step 1: 在 `tests/data-export-defects.test.mjs` 與 `tests/report-ai.test.mjs` 新增失敗測試**

在 `tests/data-export-defects.test.mjs` 的 `issuesMd` 測試（約第 40 行）補上斷言：
```js
assert.ok(md.includes('## 統計發現清單'), 'issuesMd 應包含統計發現清單段落');
assert.ok(!md.includes('## 問題定義'), 'issuesMd 不應再輸出問題定義段落');
assert.ok(!md.includes('問題定義案'), 'issuesMd 卡片標題不應再附帶問題定義案號');
```

在 `tests/report-ai.test.mjs` 的 `aiPayload()` 測試（約第 107 行）補上斷言：
```js
assert.equal('問題定義' in p, false, 'aiPayload 不應再送出問題定義欄位');
assert.ok(Array.isArray(p['系統偵測問題清單']), 'aiPayload 仍應包含系統偵測問題清單');
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test tests/data-export-defects.test.mjs tests/report-ai.test.mjs`
Expected: FAIL（因 `issuesMd` 仍含 `## 問題定義` 且 `aiPayload` 仍含 `問題定義`）。

- [ ] **Step 3: 修改 `spi-spc.html` 的 `issuesMd` 與 `aiPayload`**

1. `issuesMd(F, st)`（lines 7273–7290）：
   - 移除 `const cases=...` 與 `const casesMd=...`。
   - 模板直接以 `## 統計發現清單` 開頭（移除 `${casesMd}`）。
   - 每筆發現標題改為 ``## #${x.no!=null?x.no:x.id}［${x.level||(typeof LVL_MAP!=="undefined"&&LVL_MAP[x.lv])||x.lv}］${x.title}``（移除 `（問題定義案 ...）`）。
2. `aiPayload()`（line 12158）：
   - 刪除 `問題定義:(S.F.meta&&S.F.meta.cases||[]).slice(0,8).map(...),` 整行。

- [ ] **Step 4: 執行測試確認通過（含相容性測試）**

Run: `node --test tests/data-export-defects.test.mjs tests/report-ai.test.mjs tests/problem-cases.test.mjs tests/issue-detection-audit.test.mjs tests/spi-audit-fixes.test.mjs`
Expected: PASS（`issuesMd` 與 `aiPayload` 新斷言通過，且 `buildProblemCases`／CSV／XLSX 相容性測試維持通過）。

- [ ] **Step 5: Commit**

```bash
git add spi-spc.html tests/data-export-defects.test.mjs tests/report-ai.test.mjs
git commit -m "refactor(export,ai): remove problem-cases section from issuesMd and aiPayload"
```

---

### Task 3: 更新 RFC 文件與完整回歸／建置驗證

**Files:**
- Modify: `docs/spec-problem-cases-rfc.md`

**Interfaces:**
- Consumes: Task 1 與 Task 2 完成後的 `spi-spc.html` 與測試。
- Produces: 更新後的 `docs/spec-problem-cases-rfc.md`，準確記錄「介面／Markdown／AI 已簡化為單一統計發現視圖；底層 `buildProblemCases` 與 CSV/XLSX 末兩欄保留相容」。

- [ ] **Step 1: 更新 `docs/spec-problem-cases-rfc.md`**

更新狀態與「介面」段落：
- 註明自本次簡化起，問題頁 UI、Markdown 匯出（`issuesMd`）與 AI 摘要輸入（`aiPayload`）統一採單一「統計發現」視圖與單一計數（`M 項統計發現：嚴重 a、警示 b、資訊 c`），移除「依問題定義」切換與雙重計數。
- 註明底層 `buildProblemCases`、`F.meta.cases`、`issueCaseCounts`、CSV/XLSX 末兩欄（`case_id`、`case_title`）與 `/api/analyze` 白名單維持相容不破壞。

- [ ] **Step 2: 執行相關測試套件、範圍突變檢核與 Cloudflare 建置**

Run:
```bash
node --test tests/ui.smoke.test.js tests/issue-evidence-chart.test.mjs tests/component-scope.test.mjs tests/problem-cases.test.mjs tests/issue-detection-audit.test.mjs tests/data-export-defects.test.mjs tests/report-ai.test.mjs tests/ui-copy.test.mjs tests/mobile-layout.test.mjs
node tools/mutation-check.mjs
npm run build:cloudflare
```
Expected:
- 所有測試 PASS（0 failed）。
- `mutation-check.mjs` 全部突變皆被測試攔截並回報通過。
- `npm run build:cloudflare` 成功完成且無 `Unexpected deploy asset`。

- [ ] **Step 3: Commit**

```bash
git add docs/spec-problem-cases-rfc.md
git commit -m "docs(rfc): update spec-problem-cases-rfc for single rule-based issue view"
```
