# Focused Problem Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將問題頁分散的統計發現（如 42 項）依工程根因收斂為最多 6 張高聚焦「焦點問題」卡片（附白話標題句「哪裡＋什麼現象 → 做什麼」），預設展開摘要、影響範圍與建議動作，將底層統計發現收折為卡片底部的「檢視 N 項統計證據」折疊明細；同時在 Markdown／HTML 報告的問題清單前新增「焦點問題摘要」段落。

**Architecture:** 在 `spi-spc.html` 新增純函式 `focusDomainOf(x)`（6 階優先序＋第 6 類備援保底）與 `buildFocusedProblems(F)`，為每個工程大類產出白話標題句 `title`、類別名 `name`、去重截斷後的影響群組／板號／量測項目、重點現象與建議動作。`renderIssues()`（含窄範圍下的 `#issBoardScope`）改以 `.iss-focus` 呈現焦點問題並內嵌預設收合的 `.iss-ev-fold` 統計證據區，頁首於存在 MSA 警示時顯示 `.iss-msa-note`；`issuesMd()`、`reportMd()` 與 `renderReport()` 於原統計發現清單前新增「焦點問題摘要」表格。

**Tech Stack:** Vanilla JavaScript / HTML / CSS（`spi-spc.html`）、Node.js `node:test` + `jsdom`、Cloudflare build（`npm run build:cloudflare`）。

**Spec:** [docs/superpowers/specs/2026-11-23-focused-problems-design.md](../specs/2026-11-23-focused-problems-design.md) 與 [docs/spec-problem-cases-rfc.md](../../spec-problem-cases-rfc.md)。

## Global Constraints

- 不修改 `detectIssues()` 門檻、`F` 陣列結構、`F.meta.verdict`、`buildProblemCases()`、`issuesCsv()`、`issuesXlsx()`、`aiPayload()` 或 `/api/analyze`。
- 每筆統計發現必須經 6 階優先表歸入**恰好一個**焦點問題（`sum(g.count) === F.length`），未知 `sig.t` 或無 `sig` 一律由第 6 類 `spike` 保底，焦點問題數上限為 6。
- 清單截斷守衛（`AGENTS.md`）：焦點問題的影響群組／板號最多 6 項 + `另 N 個`，報告摘要的證據編號最多 10 項 + `另 N 項`，禁止無界限 `.join()`。
- 版面與觸控守衛（`AGENTS.md`）：`.iss-focus` 與 `.iss-ev-fold` 須含 `min-width:0; overflow-wrap:anywhere`；`@media(pointer:coarse)` 下 `.iss-ev-fold>summary` 觸控熱區 `min-height:44px` 且放在基礎規則之後；不可寫行內 `min-height`。
- 分析範圍一致：窄元件範圍下上方焦點卡只聚合 `sc.own`，`#issBoardScope` 全板問題亦以 `buildFocusedProblems` 收斂為焦點卡；報告摘要一律讀已篩選範圍的 `F`；`tests/fixtures/mutations-component-scope.json` 新增對應突變且須通過 `node tools/mutation-check.mjs`。

## Review Focus

- **未知規則或缺少 `sig` 的發現**：當卡片 `sig` 為 `null` 或 `sig.t` 為未列出的新字串時，`focusDomainOf(x)` 必須歸入 `"spike"`，維持 `sum(g.count) === F.length`。
- **0 筆發現或窄範圍僅有全板問題**：`F.length === 0` 時 `buildFocusedProblems([])` 回傳 `[]`，`#issHead` 維持既有空狀態文字（不出現 `0 個焦點問題`），報告不輸出空白「焦點問題摘要」段落。
- **跳轉與診斷返回（`flashIssue`、`backDiagnostic`）**：卡片位在預設收合的 `.iss-ev-fold` 內，跳轉或從多視角診斷返回時，若所屬焦點問題被 `S.issLv` 隱藏須自動切回 `"all"`，並同時展開外層 `.iss-ev-fold` 與目標 `.iss-card`，同步呼叫 `issToolsState()`。
- **列印展開與還原（`beforePrint`、`afterPrint`）**：列印問題頁時須將所有 `.iss-ev-fold` 與 `.iss-card` 展開，並在 `afterPrint` 還原列印前的收合狀態。
- **嚴重度篩選與按鈕數字一致**：點選 `嚴重 a`／`警示 b`／`資訊 c`／`全部 N` 後，畫面顯示的 `.iss-focus` 張數嚴格等於按鈕數字（依焦點卡最高嚴重度 `g.lv` 篩選），展開其證據區時該大類內所有成員卡均完整可見。

---

### Task 1: 新增 `focusDomainOf(x)`、`buildFocusedProblems(F)` 與報告「焦點問題摘要」生成函式

**Files:**
- Modify: `spi-spc.html:5915-5925`（在 `issueCaseCounts` 後新增 `FOCUS_DOMAINS`、`focusDomainOf`、`buildFocusedProblems`、`focusedProblemsMd`）
- Modify: `spi-spc.html:7265-7285`（`issuesMd` 在 `## 統計發現清單` 前插入 `focusedProblemsMd(F, "##")`）
- Modify: `spi-spc.html:11970-11976`（`reportMd` 在 `## 二、問題偵測清單` 標題下、原清單前插入 `focusedProblemsMd(scopedFindings(), "###")`）
- Modify: `spi-spc.html:14191-14196`（`renderReport` 在 `二、問題偵測清單` 標題下、原表格前插入 HTML 版焦點問題摘要表）
- Modify: `spi-spc.html:7395`（`module.exports` 匯出 `focusDomainOf`, `buildFocusedProblems`, `focusedProblemsMd`）
- Modify: `spi-spc.html:17195`（`SPI_TEST_HOOK` 匯出 `focusDomainOf`, `buildFocusedProblems`, `focusedProblemsMd`）
- Create: `tests/focused-problems.test.mjs`

**Interfaces:**
- Consumes: `F`（`detectIssues(st)` 產出的統計發現陣列）。
- Produces:
  - `focusDomainOf(x)` → `"measurement" | "align" | "aperture" | "process" | "squeegee" | "spike"`（依設計文件第 3 節 6 階優先序，第 6 階保底）。
  - `buildFocusedProblems(F)` → `{ key, name, title, lv, members, count, ids, groups, moreGroups, boards, moreBoards, metrics, highlights, actions }[]`：
    - `name`：中文類別名（如 `"元件開孔與能力不足"`）。
    - `title`：白話標題句 `{哪裡}{現象} → {動作}`（如 `"U2 BGA 等 4 群組製程能力不足 → 檢查鋼板開孔與厚度"`）。
    - `groups` / `boards`：過濾佔位值後去重最多 6 項，超出數記於 `moreGroups` / `moreBoards`。
    - `ids`：成員 `id` 陣列。
  - `focusedProblemsMd(F, headingPrefix="##")` → `F.length === 0` 時回傳 `""`；否則回傳含 `${headingPrefix} 焦點問題摘要`（以及當 `F` 含 `sig.t==="msa"` 時的量測可信度提示行）與 Markdown 表格（欄位：`嚴重度 | 焦點問題 | 影響範圍 | 建議動作 | 統計證據`，證據欄最多 10 個 `#id` + `另 N 項`）。

- [ ] **Step 1: 建立 `tests/focused-problems.test.mjs` 撰寫失敗測試**

涵蓋：
1. `buildFocusedProblems([])` 回傳 `[]`；`focusedProblemsMd([])` 回傳 `""`。
2. `sampleData()` 26 項發現收斂為 ≤ 6 個焦點問題，`sum(g.count) === F.length`，每筆恰好歸入一類。
3. 全部 21 種已知 `sig.t`（`align, board, dfm, drift, fig, grad, iso, local, lowte, mcd, morph, msa, nelson, pad, pause, repeated, spatial, stroke, sys, unit, wipe`）及 `nelson` 規則分流、`board/local` 的 `off` 分流、未知 `sig.t` 與缺少 `sig` 的保底（歸入 `spike`）逐一斷言。
4. 白話標題句 `title` 格式 `{哪裡}{現象} → {動作}`、佔位值過濾（`"全部元件"`、`"ALL（全部元件）"`、`"全部板"`、`"不適用"`、`"—"`、`""`）與單一群組／多群組／板號回退。
5. 排序（`ng` > `warn` > `info`，同嚴重度依 `count` 降序）與 20 個群組截斷（`groups.length === 6`、`moreGroups === 14`）及不改動 `F`。
6. `issuesMd(F, st)` 與 `focusedProblemsMd(F)`：在 `## 統計發現清單` 之前輸出 `## 焦點問題摘要` 表格，超過 10 項證據時截斷為 `另 N 項`，含 `msa` 時輸出量測系統變異提示。

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test --test-reporter=tap tests/focused-problems.test.mjs`
Expected: FAIL（`core.buildFocusedProblems is not a function`）。

- [ ] **Step 3: 在 `spi-spc.html` 實作 `FOCUS_DOMAINS`、`focusDomainOf`、`buildFocusedProblems`、`focusedProblemsMd` 並串接 `issuesMd`、`reportMd`、`renderReport`**

依設計文件第 3、4、6 節實作並匯出。

- [ ] **Step 4: 執行測試確認通過**

Run: `node --test --test-reporter=tap tests/focused-problems.test.mjs tests/data-export-defects.test.mjs tests/report-ai.test.mjs`
Expected: PASS（0 failed）。

- [ ] **Step 5: Commit**

```bash
git add spi-spc.html tests/focused-problems.test.mjs
git commit -m "feat(issues): add buildFocusedProblems and report focused summary section"
```

---

### Task 2: 問題頁 UI 改為焦點問題卡片與內嵌統計證據折疊區

**Files:**
- Modify: `spi-spc.html`：
  - CSS（約 line 310 & line 1039）：新增 `.iss-focus`、`.iss-focus-head`、`.iss-focus-sub`、`.iss-focus-meta`、`.iss-focus-pts`、`.iss-focus-act`、`.iss-msa-note`、`.iss-ev-fold`、`.iss-ev-fold>summary`（含 `@media(pointer:coarse)` 44px 熱區）；移除 `.iss-cat-sel` CSS。
  - State（約 line 3914）：移除 `issCat:"all"`。
  - `flashIssue`、`issueBoardList`、`issueList`、`pmapSelect`、`issToolsState`、`renderIssues`、`openDiagnostic`、`backDiagnostic`、`beforePrint`、`afterPrint`：
    - 移除 `S.issCat` 與 `#selIssCat`。
    - `renderIssues` 以 `buildFocusedProblems(F)` 計算 `#issHead`（`${focusedAll.length} 個焦點問題：嚴重 ${c.ng}、警示 ${c.warn}、資訊 ${c.info}`）與 `#issFilter` 嚴重度按鈕計數；若 `F` 含 `sig.t==="msa"`，在 `#issSub` 或頁首提示顯示「量測系統變異偏大，以下判讀可信度降低」。
    - `#issList` 對 `issueList("all")` 執行 `buildFocusedProblems(L)`，再依 `S.issLv === "all" || g.lv === S.issLv` 篩選焦點卡；每張 `.iss-focus` 預設展開白話標題 `g.title`、類別副標 `g.name · ${g.count} 項證據`、影響範圍、重點現象、建議動作，底部 `<details class="iss-ev-fold" data-focus="${g.key}">` 預設收合，內含成員 `.iss-card`（總量受 `ISS_PG` `lim` 限制並保留 `if(ISS_PG.F!==F0||ISS_PG.k!==pgK){ISS_PG.F=F0;`）。
    - `#issBoardScope` 全板問題區同樣以 `buildFocusedProblems(BL)` 渲染 `.iss-focus` 焦點卡。
    - `issToolsState`、`#issExpand`、`#issCollapse`、`flashIssue`、`backDiagnostic`、`beforePrint`、`afterPrint` 同步管理 `.iss-ev-fold`（以 `"f:"+key` 或 `"fb:"+key` 記於 `ISS_OPEN`）與 `.iss-card`。
- Modify: `tests/ui.smoke.test.js`
- Modify: `tests/component-scope.test.mjs`
- Modify: `tests/ui-polish.test.mjs`
- Modify: `tests/mobile-layout.test.mjs`
- Modify: `tests/fixtures/mutations-component-scope.json`

**Interfaces:**
- Consumes: `buildFocusedProblems(F)`、`issueScope()`、`issueList(lv)`、`issueBoardList(lv)`。
- Produces: `#issHead` 顯示 `N 個焦點問題：嚴重 a、警示 b、資訊 c`；`#issFilter` 不含 `#selIssCat`；`#issList` 與 `#issBoardScope` 輸出 `.iss-focus` 卡片與內嵌預設收合的 `.iss-ev-fold`（內含 `.iss-card`）。

- [ ] **Step 1: 更新測試與突變檢核 fixture（先紅燈）**

1. `tests/ui.smoke.test.js`：
   - 斷言 `#issList > .iss-focus` 數量介於 1..6，`#issList details.iss-ev-fold[open]` 為 0，`#issList details.iss-card[open]` 為 0，`#selIssCat` 為 `null`。
   - 斷言 `#issHead` 符合 `/^\d+ 個焦點問題：嚴重 \d+、警示 \d+、資訊 \d+$/` 且 `ng + warn + info === total`。
   - `chipCheck("#issList > .iss-focus")` 驗證每個嚴重度按鈕數字等於顯示的 `.iss-focus` 數量。
   - `flashIssue(firstNg.id)` 驗證跨嚴重度跳轉會同時展開外層 `.iss-ev-fold` 與目標 `#iss-${firstNg.id}`，且 `#issCollapse` 可收合全部。
   - `#issExpand` 展開全部 `.iss-ev-fold` 與 `.iss-card`，`#issCollapse` 全部收合。
2. `tests/component-scope.test.mjs`：
   - 第 213 行：`const listed = [...d.querySelectorAll("#issList > .iss-focus details.iss-card")].map((e) => +e.dataset.id);`
   - 第 221-223 行：以 `H.buildFocusedProblems(own)` 計算焦點問題數與嚴重度，斷言 `#issHead` 符合 `^元件 U2（群組 U2 BGA）：${fg.length} 個焦點問題：嚴重 ${sev.ng}、警示 ${sev.warn}、資訊 ${sev.info}$`，並斷言 `#issBoardScope .iss-focus` 存在且報告含 `焦點問題摘要`。
3. `tests/ui-polish.test.mjs`：第 55 行 regex 更新為 `/焦點問題|統計發現/`。
4. `tests/mobile-layout.test.mjs`：第 440–441 行移除 `#selIssCat` 斷言，改斷言 `.iss-ev-fold>summary` 在 `@media(pointer:coarse)` 下具備 `min-height:44px`。
5. `tests/fixtures/mutations-component-scope.json`：新增一項突變將 `renderIssues` 的焦點問題計數來源從範圍內 `F` 改為全板 `F0`。

- [ ] **Step 2: 執行受影響測試確認失敗**

Run: `node --test --test-reporter=tap tests/ui.smoke.test.js tests/component-scope.test.mjs tests/ui-polish.test.mjs tests/mobile-layout.test.mjs`
Expected: FAIL。

- [ ] **Step 3: 修改 `spi-spc.html` 實作焦點問題卡片 UI**

確保無行內 `min-height`、`@media(pointer:coarse)` 置於基礎規則之後、所有文字經 `esc()` 跳脫。

- [ ] **Step 4: 執行測試與突變檢核確認通過**

Run:
```bash
node --test --test-reporter=tap tests/focused-problems.test.mjs tests/ui.smoke.test.js tests/component-scope.test.mjs tests/issue-evidence-chart.test.mjs tests/ui-polish.test.mjs tests/mobile-layout.test.mjs tests/ui-copy.test.mjs tests/diagnostic.test.mjs tests/print.test.mjs
node tools/mutation-check.mjs
```
Expected: 全部 PASS，`mutation-check.mjs` 26/26 攔截。

- [ ] **Step 5: Commit**

```bash
git add spi-spc.html tests/ui.smoke.test.js tests/component-scope.test.mjs tests/ui-polish.test.mjs tests/mobile-layout.test.mjs tests/fixtures/mutations-component-scope.json
git commit -m "feat(ui): render focused problem cards with plain titles and collapsible evidence"
```

---

### Task 3: 更新 RFC、升版至 `v10.38.13` 並執行完整驗證關卡

**Files:**
- Modify: `docs/spec-problem-cases-rfc.md`
- Modify: `package.json`, `package-lock.json`, `lib/version.mjs`, `spi-spc.html`（`#appVer`）, `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1 與 Task 2 完成的程式碼與測試。
- Produces: 一致的 `v10.38.13` 版本、更新後的 RFC 與通過所有驗證關卡的乾淨分支。

- [ ] **Step 1: 更新 `docs/spec-problem-cases-rfc.md` 與版本號至 `v10.38.13`**

在 `docs/spec-problem-cases-rfc.md` 記錄 6 大工程焦點問題收斂設計、白話標題句、嚴重度按鈕篩選語意與報告「焦點問題摘要」；在 `package.json`、`package-lock.json`、`lib/version.mjs`、`spi-spc.html` `#appVer` 與 `CHANGELOG.md` 升版至 `v10.38.13`。

- [ ] **Step 2: 執行回歸測試、慢速統計模擬、發布掃描、Cloudflare 建置與本機 UI 驗收**

Run:
```bash
node --test --test-reporter=tap tests/problem-cases.test.mjs tests/issue-detection-audit.test.mjs tests/data-export-defects.test.mjs tests/report-ai.test.mjs
npm run test:slow
npm run release-check:scans
npm run build:cloudflare
```
Expected: 全部 PASS，`release-check:scans` 全掃描 `PASS`，`build:cloudflare` 成功。

- [ ] **Step 3: Commit**

```bash
git add docs/spec-problem-cases-rfc.md docs/superpowers/specs/2026-11-23-focused-problems-design.md docs/superpowers/plans/2026-11-23-focused-problem-consolidation.md package.json package-lock.json lib/version.mjs spi-spc.html CHANGELOG.md
git commit -m "chore(release): bump version to v10.38.13 and update RFC for focused problem cards"
```
