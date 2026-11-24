# SPI 進階統計分析圖表 — 階段一（管制圖與製程能力擴充）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成階段一（PR 1）全部交付項目：純統計模組 `lib/spi-stats-ext.mjs`（含同步工具與測試）、管制圖擴充（G 圖、Laney U′ 圖、板序 ACF/PACF 子分頁）、製程能力擴充（Ca×Cp 四象限圖、滑動視窗 Cpk 趨勢圖）、2 條經 `test:slow` 校準的正交偵測規則（`M-22`、`M-23`），以及分析報告 Ch.4/5/10 與 `/api/analyze` AI 診斷白名單整合。

**Architecture:** 比照 `lib/windows-parity.mjs` 慣例，將 5 個階段一純統計演算法寫於無 DOM 相依的 ESM 模組 `lib/spi-stats-ext.mjs`，透過 `tools/sync-spi-stats-ext.mjs` 同步內嵌至 `spi-spc.html` 的 `<script id="core">`（相容主執行緒、>20,000 筆 Inline Web Worker 與 `tests/_load.js` VM 沙箱）。所有圖表統一透過既有 Chart.js 封裝 `mk()` 與離屏 `renderOffscreenChart()` 渲染，並以 `anKey` 索引之 `extStatsCache` 按需快取。

**Tech Stack:** Vanilla ES Modules (Node 22+, `node:test`), single-file SPA (`spi-spc.html`), Chart.js (`mk`, `renderOffscreenChart`), Cloudflare Worker (`lib/analyze-core.mjs`).

**Spec:** [docs/superpowers/specs/2026-11-23-spi-statistical-charts-design.md](../specs/2026-11-23-spi-statistical-charts-design.md)

## Global Constraints

- 所有使用者可見標題僅用中文，不可出現「中文（English）」括號譯名；`.textContent` 嚴禁內嵌 HTML 標籤；`detectIssues` 清單欄位必經 `topList(arr, 10)` 截斷。
- 不新增頂層主分頁；維持現有 10 個主分頁、`#selRelChart` 原 3 選項與底部分頁列 5 項；新圖表色彩全數複用既有已定義 CSS token（深淺色與白底報告對比 ≥ 4.5）。
- 所有讀取量測列之新圖表必經 `scopeFilter(st)`（空範圍不得退回全板資料），並補齊 `tests/fixtures/mutations-component-scope.json` 變異守衛。
- 5 萬筆級 `analyze` 與 `detectIssues` 各 <3 秒（目標 <1 秒）；`lib/spi-stats-ext.mjs` 不得存取 `window`／`document`。
- 跨行 regex 一律使用 `\r?\n`；VM 沙箱陣列斷言前以 `Array.from()` 轉為宿主陣列。
- 階段一新增規則編號為 `M-22`（`sig.t: "acf"` → `"process"`）與 `M-23`（`sig.t: "gburst"` → `"spike"`），避開歷史已移除之 `M-21`，且不使用 `cat: "空間分布"`。

## Review Focus

1. **原始 CSV 列未按板序排列時執行 G 圖**：若直接掃描 `rows` 會算出錯誤間隔；`calcGChart` 必須先依 `boardOrder`（`A.boards`）分組排序再計算相鄰不良間隔。
2. **全板零不良（$\bar{u} = 0$）或單一不良（$m < 2$）**：`calcLaneyUChart` 必須避免 `0/0 = NaN` 並回傳 `UCL=0, LCL=0, sigmaZ=1`；`calcGChart` 必須回傳 `insufficient: true` 並呈現空狀態。
3. **非對稱目標值（`spec.tgt !== (lsl+usl)/2`）與零變異（$s \le 10^{-12}$）**：`calcCaCpQuadrant` 必須以規格中點 $M=(\text{lsl}+\text{usl})/2$ 計算 $Ca$ 以維持 $Cpk \equiv Cp(1-|Ca|/100)$ 精確等值線，且零變異群組／視窗不得輸出 `Infinity`。
4. **多指標 i.i.d. 模擬下 `M-22`／`M-23` 誤報膨脹**：`M-22` 必須對受測指標數 $M$ 做 Bonferroni 校正（$p < 0.001/M$、$N \ge 15$），`M-23` 必須對高良率 $LCL = 0$ 區間採連續 $g_i = 0$ Bonferroni 校正，確保 `npm run test:slow` 通過。
5. **超過 20,000 筆資料於 Inline Web Worker 執行 `detectIssues()`**：`/* @spi-stats-ext START */` 必須位於 `<script id="core">` 內、`DET_SKIP` 須排除 `extStatsCache`，且 Worker 結果須經 `F.meta.extCore` 回傳主執行緒。

---

## File Structure

- **Create**: `lib/spi-stats-ext.mjs` — 階段一 5 個純統計函式（`calcGChart`、`calcLaneyUChart`、`calcAcfPacf`、`calcCaCpQuadrant`、`calcRollingCpk`）與輔助卡方尾端機率（純 JS，無 DOM）。
- **Create**: `tools/sync-spi-stats-ext.mjs` — 比照 `tools/sync-windows-parity.mjs`，將 `lib/spi-stats-ext.mjs` 去除 `export` 關鍵字同步至 `spi-spc.html` `<script id="core">` 的 `/* @spi-stats-ext START */ ... /* @spi-stats-ext END */`。
- **Create**: `tests/spi-stats-ext.test.mjs` — 涵蓋 5 個純統計函式、Review Focus 全部邊界條件與 `spi-spc.html` 內嵌區塊逐字同步守衛測試。
- **Modify**: `spi-spc.html` — 內嵌 `@spi-stats-ext`、`analyzeView`/`drawCtrl`/`chartName` 支援 G 圖與 U′ 圖、`#p-control` 新增 `自相關` 子分頁與 `isAnalysisScopeTab`/`setTab` 路由、`#p-capability` 新增 `Ca × Cp 四象限圖` 與 `滑動視窗 Cpk 趨勢圖`、`detectIssues` 新增 `M-22`/`M-23` 與 `focusDomainOf`/`F.meta.extCore`、`renderReport` Ch.4/5/10 與 `aiPayload`。
- **Modify**: `lib/analyze-core.mjs` — `ALLOWED_KEYS` 新增 `"進階統計診斷"`。
- **Modify**: `tests/analyze-core.test.mjs` — 驗證 `"進階統計診斷"` 通過白名單與深度／大小清理。
- **Modify**: `tests/fixtures/mutations-component-scope.json` — 新增階段一新圖表之範圍篩選變異破壞項。
- **Modify**: `tests/component-scope.test.mjs` — 補上階段一新圖表範圍連動與空範圍測試。

---

### Task 1: 建立 `lib/spi-stats-ext.mjs` 與 `tools/sync-spi-stats-ext.mjs`（階段一 5 個純統計核心）

**Files:**
- Create: `lib/spi-stats-ext.mjs`
- Create: `tools/sync-spi-stats-ext.mjs`
- Modify: `spi-spc.html:3160-3165`（於 `/* @windows-parity END */` 後加入 `/* @spi-stats-ext START */ ... /* @spi-stats-ext END */`）與 `spi-spc.html:7465`（`module.exports` 匯出 5 函式）
- Test: `tests/spi-stats-ext.test.mjs`

**Interfaces:**
- Produces (from `lib/spi-stats-ext.mjs` & `<script id="core">`):
  - `calcGChart(rows, classifyFn, boardOrder)` → `{ insufficient, reason?, totalPads, defectCount, yieldPct, gMean, gMedian, pHat, clMean, clMed, ucl, lcl, burstCount, burstIndices, pts: [{ idx, board, g, burst, aboveUcl, belowLcl }] }`
  - `calcLaneyUChart(rows, classifyFn, boardOrder)` → `{ insufficient, uBar, uBarPer1k, sigmaZ, pts: [{ lab, n, c, u, uPer1k, cl, ucl, lcl, z, ooc }] }`
  - `calcAcfPacf(boardMeans, maxLag)` → `{ insufficient, n, maxLag, ci95, acf: number[], pacf: number[], lbQ, lbP, maxAbsLag, sigLags: number[] }`
  - `calcCaCpQuadrant(rows, metric, spec, keyFn)` → `{ insufficient, reason?, midpoint, asymmetricTarget, softYMax, counts: { healthy, offCenter, highVar, both }, pts: [{ key, n, mean, sd, ca, cp, cpk, zone, zeroVar, capped }] }`
  - `calcRollingCpk(boardGroups, spec, windowSize)` → `{ insufficient, windowSize, slope, pts: [{ lab, cp, cpk, n }] }`

- [ ] **Step 1: 建立 `tests/spi-stats-ext.test.mjs` 撰寫 5 個函式的失敗單元測試與邊界測試**

測試案例涵蓋：
1. `calcGChart`：正常高良率間隔與 Benneyan 精確 `ucl`/`lcl`/`clMed` 數值、**亂序 CSV 列須依 `boardOrder` 排序後計算**（Review Focus #1）、總不良 `< 2` 回傳 `insufficient: true`（Review Focus #2）、$LCL=0$ 區間連續 $g_i=0$ 標記 `burst: true`。
2. `calcLaneyUChart`：單焊墊多缺陷累加（`classifyFn` 回傳長度 2 算 2 缺點）、過度離散 $\sigma_z > 1$ 放寬界線、**全板零不良 $\bar{u}=0$ 不產生 `NaN`**（Review Focus #2）。
3. `calcAcfPacf`：已知 AR(1) 序列（$\phi = 0.8$）驗證 `acf[0] > 0.6`、`pacf[0] > 0.6`、`pacf[1]` 接近 0、`lbP < 0.01`；常數序列（方差 0）或 $N < 6$ 回傳 `insufficient: true`。
4. `calcCaCpQuadrant`：4 象限分類正確、**非對稱 `spec.tgt` 時仍以規格中點計算 $Ca$ 保持 $Cpk \equiv Cp(1-|Ca|/100)$**（Review Focus #3）、零變異群組 `cp === null` 且不為 `Infinity`、極端高 `Cp = 30` 觸發 `softYMax` 與 `capped: true`。
5. `calcRollingCpk`：滑動視窗 $W=5$ 準確度與衰退斜率為負、零變異視窗 `cpk === null`、總板數 $< 3$ 回傳 `insufficient: true`。
6. 同步守衛測試：驗證 `spi-spc.html` `<script id="core">` 內的 `@spi-stats-ext` 區塊與 `lib/spi-stats-ext.mjs` 去除 `export` 後逐字一致。

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test tests/spi-stats-ext.test.mjs`
Expected: FAIL（模組尚未建立）

- [ ] **Step 3: 實作 `lib/spi-stats-ext.mjs`（純 JS、無 DOM、單趟 O(N)）**

依規格第 6.1 節公式實作 5 個函式及內部卡方上尾機率 `chi2UpperP(x, df)`（以 regularized upper incomplete gamma 計算，供 Ljung-Box `lbP` 使用）。

- [ ] **Step 4: 實作 `tools/sync-spi-stats-ext.mjs` 並於 `spi-spc.html` `<script id="core">` 插入標記、執行同步並匯出至 `module.exports`**

Run: `node tools/sync-spi-stats-ext.mjs`
Expected: `Synced spi-stats-ext into spi-spc.html (...)`

- [ ] **Step 5: 執行測試驗證全部通過**

Run: `node --test tests/spi-stats-ext.test.mjs`
Expected: PASS（全部測試綠燈）

- [ ] **Step 6: Commit**

```bash
git add lib/spi-stats-ext.mjs tools/sync-spi-stats-ext.mjs spi-spc.html tests/spi-stats-ext.test.mjs
git commit -m "feat(stats): add phase 1 pure statistical engines (G, Laney U', ACF/PACF, Ca×Cp, Rolling Cpk)"
```

---

### Task 2: 管制圖分頁擴充（G 圖、Laney U′ 圖、板序 ACF/PACF 子分頁）

**Files:**
- Modify: `spi-spc.html:1372-1438`（`#p-control` 新增 `自相關` 子分頁、`#selChart` 新增 `g`/`u` 選項、`#ctrlGScale` 切換與 ACF/PACF 雙圖卡片）
- Modify: `spi-spc.html:4304-4360`（`analyzeView` 接入 `u`/`g` 與 Nelson 規則 `na` 處理）
- Modify: `spi-spc.html:8503-8800`（`renderControlPanel`、`isAnalysisScopeTab`、`parseTab`、`tabHashFor`、`setTab`、`chartName`、`drawCtrl`、`renderControl`、`renderAcfUI`、`buildPrintHeadHtml`）
- Test: `tests/spi-stats-ext.test.mjs`（新增 `loadCore()` 整合驗證）& `tests/ui.smoke.test.js`

**Interfaces:**
- Consumes: `calcGChart`, `calcLaneyUChart`, `calcAcfPacf` from Task 1 (`<script id="core">`)
- Produces: `renderAcfUI()`, `getExtStatsCache(key, computeFn)`, `S.controlSub` 支援 `"uni" | "multi" | "acf"`, `S.chart` 支援 `"g" | "u"`

- [ ] **Step 1: 在 `tests/spi-stats-ext.test.mjs` 補上 `loadCore()` 驗證 `analyze()` 切換 `chart: "g"` 與 `chart: "u"` 之輸出與 Nelson 規則 `na` 行為**

驗證：
- `chart: "u"` 產出有效 `A.uc` 與 `A.series`（長度等於板數）。
- `chart: "g"` 產出有效 `A.gc`，且 `A.nel.rules` 僅 Rule 1 有效、Rule 2–8 皆為 `na: true`。

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test tests/spi-stats-ext.test.mjs`
Expected: FAIL（`A.gc` / `A.uc` 尚未接線）

- [ ] **Step 3: 更新 `spi-spc.html` 管制圖 UI、路由與渲染邏輯**

- `#selChart` 新增 `<option value="g">G 圖</option>` 與 `<option value="u">U′ 圖</option>`。
- `#p-control .subtabs` 新增 `<button type="button" class="subtab" data-subnav-control="acf">自相關</button>`，並新增 `<div data-control-sub="acf" hidden>` 卡片（含 `#cAcf`、`#cPacf` 兩張 Chart.js canvas 與 `#acfSub`/`#acfSummary` 純文字摘要）。
- 更新 `isAnalysisScopeTab()` 為 `AN_TABS.has(S.tab) || (S.tab === "control" && S.controlSub !== "multi")`，同步更新 `parseTab`、`tabHashFor`、`setTab`、`setupSubtabs("#p-control .subtabs", ...)`、`buildPrintHeadHtml`。
- 更新 `analyzeView`、`chartName`、`drawCtrl`、`renderControl` 完整支援 `g`（含線性／對數 Y 軸切換、隱藏副圖）與 `u`（每千焊墊階梯界線、隱藏副圖、自動相容總覽 `#cOvCtrl` 與多視角診斷 `#diagControl`）。
- 建立 `extStatsCache`（按 `anKey(st)` 索引）並將 `"extStatsCache"` 加入 `DET_SKIP`。

- [ ] **Step 4: 執行測試確認通過**

Run: `node --test tests/spi-stats-ext.test.mjs tests/ui.smoke.test.js tests/ui-copy.test.mjs tests/mobile-layout.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add spi-spc.html tests/spi-stats-ext.test.mjs
git commit -m "feat(control): add G chart, Laney U' chart, and ACF/PACF subtab"
```

---

### Task 3: 製程能力分頁擴充（Ca × Cp 四象限圖與滑動視窗 Cpk 趨勢圖）

**Files:**
- Modify: `spi-spc.html:1440-1474`（`#p-capability` 新增 `製程能力四象限圖` 與 `滑動視窗 Cpk 趨勢圖` 兩張卡片，含 `#selRollWin` 視窗選擇器 `3/5/10/20`）
- Modify: `spi-spc.html:8848-8990`（`renderCap` 呼叫 `renderCaCpQuadrant()` 與 `renderRollingCpk()`，嚴格使用 `scopeFilter(S)`／`S.A`）
- Modify: `tests/component-scope.test.mjs` & `tests/fixtures/mutations-component-scope.json`

**Interfaces:**
- Consumes: `calcCaCpQuadrant`, `calcRollingCpk` from Task 1; `extStatsCache` from Task 2
- Produces: `renderCaCpQuadrant()`, `renderRollingCpk()`, `buildCaCpChartCfg(res)`, `buildRollingCpkChartCfg(res)`（供 Task 5 分析報告離屏複用）

- [ ] **Step 1: 在 `tests/component-scope.test.mjs` 新增階段一新圖表範圍連動測試，並於 `tests/fixtures/mutations-component-scope.json` 新增對應變異破壞項**

驗證：
- 切換範圍至單一元件群組與單一元件時，`Ca × Cp` 粒度自動下鑽（群組 → 元件 → 焊墊），空範圍時回傳空狀態不退回全板。
- 切換範圍時 `滑動視窗 Cpk` 與 `ACF/PACF` 僅計算範圍內資料。

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test tests/component-scope.test.mjs`
Expected: FAIL（新元件卡片與渲染函式尚未建立）

- [ ] **Step 3: 實作 `#p-capability` 兩張新卡片與 `renderCaCpQuadrant()` / `renderRollingCpk()`**

- `Ca × Cp 四象限圖`：Chart.js 氣泡／散點圖，疊加 $Ca = \pm 25\%$ 垂直線、$Cp = 1.33$ 水平線與 V 字型 $Cpk = 1.33$ 等值曲線，Y 軸採 `res.softYMax` 軟上限並於 Tooltip 顯示完整 $n/Ca/Cp/Cpk$；非對稱 `spec.tgt` 時於 `#cacpSub` 純文字加註。
- `滑動視窗 Cpk 趨勢圖`：Chart.js 雙折線圖（$Cpk$ 實線、$Cp$ 虛線）＋ $1.33$ / $1.00$ 參考線；視窗預設 $W=5$（可切換 `3/5/10/20`），`capDistMode !== "normal"` 時於 `#rollCpkSub` 加註「滑動趨勢採常態估算」。

- [ ] **Step 4: 執行範圍測試與變異檢查確認全綠**

Run: `node --test tests/component-scope.test.mjs && node tools/mutation-check.mjs`
Expected: PASS（全部變異破壞皆被測試攔截）

- [ ] **Step 5: Commit**

```bash
git add spi-spc.html tests/component-scope.test.mjs tests/fixtures/mutations-component-scope.json
git commit -m "feat(capability): add Ca×Cp quadrant and rolling Cpk trend charts with scope filtering"
```

---

### Task 4: 新增 `detectIssues` 規則 `M-22`（ACF 自相關）與 `M-23`（G 圖高良率叢發）並完成 `test:slow` 校準

**Files:**
- Modify: `spi-spc.html:5939-5947`（`focusDomainOf` 新增 `acf → "process"`, `gburst → "spike"`）
- Modify: `spi-spc.html:5994-6820`（`detectIssues` 末尾加入 `M-22`、`M-23`，並寫入 `F.meta.extCore` 支援 Web Worker 回傳）
- Modify: `spi-spc.html:7690-7760`（主執行緒接收 Worker `F.meta.extCore` 寫入 `extStatsCache`）
- Test: `tests/spi-stats-ext.test.mjs`, `tests/verdict-sim.test.mjs`, `tests/golden.test.mjs`, `tests/spi-audit-fixes.test.mjs`

**Interfaces:**
- Consumes: `calcAcfPacf`, `calcGChart` from Task 1
- Produces: `detectIssues` 規則 `M-22`、`M-23` 與 `F.meta.extCore`

- [ ] **Step 1: 在 `tests/spi-stats-ext.test.mjs` 撰寫 `M-22` 與 `M-23` 檢出與不誤報測試**

驗證：
- 明顯 AR(1) 漂移板序（$N=20, \phi=0.85$）觸發 `M-22`（`sig.t === "acf"`, `focusDomainOf(card) === "process"`）。
- 良率 ≥ 99% 且具連續不良叢發觸發 `M-23`（`sig.t === "gburst"`, `focusDomainOf(card) === "spike"`）。
- 兩者均不使用 `cat: "空間分布"`，且在 i.i.d. 穩定資料上不觸發誤報。

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test tests/spi-stats-ext.test.mjs`
Expected: FAIL（`M-22`/`M-23` 尚未實作）

- [ ] **Step 3: 實作 `M-22`、`M-23`、`focusDomainOf` 擴充與 `F.meta.extCore` 傳遞**

- `M-22`：僅當 $N \ge 15$，對受測指標數 $M$ 做 Bonferroni 校正（`lbP < 0.001 / M`）且 `|r_1| >= 0.50` 或週期峰 `|r_k| >= max(0.55, 3.2/√N)` 時觸發 `warn`，清單經 `topList(..., 10)` 截斷。
- `M-23`：僅當全板良率 $\ge 99\%$ 且不良數 $\ge 4$，依 `calcGChart` 結果於連續 $\ge 2$ 個間隔觸發爆發且 Bonferroni 校正 $P(\text{burst}) < 0.002$ 時觸發 `warn`。

- [ ] **Step 4: 執行單元測試、黃金測試與完整 `npm run test:slow` 校準**

Run: `node --test tests/spi-stats-ext.test.mjs tests/golden.test.mjs tests/spi-audit-fixes.test.mjs && npm run test:slow`
Expected: PASS（若有 `verdict-sim-expected.json` 變動，逐 seed 檢查並確認穩定製程誤報率符合名目值）

- [ ] **Step 5: Commit**

```bash
git add spi-spc.html tests/spi-stats-ext.test.mjs
git commit -m "feat(detect): add M-22 ACF autocorrelation and M-23 high-yield G-chart burst rules"
```

---

### Task 5: 分析報告 Ch.4/5/10 嵌入、AI 診斷白名單 `"進階統計診斷"` 與全套驗證

**Files:**
- Modify: `lib/analyze-core.mjs:17-22`（`ALLOWED_KEYS` 加入 `"進階統計診斷"`）
- Modify: `tests/analyze-core.test.mjs`（驗證 `"進階統計診斷"` 通過白名單與深度／大小清理）
- Modify: `spi-spc.html:12202-12230`（`aiPayload()` 加入 `"進階統計診斷"` 精簡摘要）
- Modify: `spi-spc.html:14165-14500`（`renderReport()` Ch.4 補 G/U′/ACF 摘要、Ch.5 以 `renderOffscreenChart()` 嵌入 Ca×Cp 與滑動 Cpk 圖、Ch.10 補數學公式）

**Interfaces:**
- Consumes: `buildCaCpChartCfg`, `buildRollingCpkChartCfg` from Task 3; `extStatsCache` from Task 2
- Produces: Worker 白名單鍵 `"進階統計診斷"` 與報告 Ch.4/5/10 離屏圖表／摘要

- [ ] **Step 1: 在 `tests/analyze-core.test.mjs` 新增 `"進階統計診斷"` 白名單保留測試**

驗證送入含 `"進階統計診斷"`（深度 3 層）之 payload 經 `validatePayload()` 後完整保留且未列白名單之英文鍵仍被丟棄。

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test tests/analyze-core.test.mjs`
Expected: FAIL（`ALLOWED_KEYS` 尚未包含 `"進階統計診斷"`）

- [ ] **Step 3: 更新 `lib/analyze-core.mjs`、`aiPayload()` 與 `renderReport()` Ch.4/5/10**

- `lib/analyze-core.mjs` 的 `ALLOWED_KEYS` 加入 `"進階統計診斷"`。
- `aiPayload()` 填入階段一已就緒欄位：`板序自相關`、`高良率間隔`、`能力四象限重點`（最多 5 群組，巢狀深度 $\le 3$）。
- `renderReport()` 於 Ch.4 補入 G／U′／ACF 讀數摘要表，Ch.5 透過 `renderOffscreenChart()` 嵌入 `Ca × Cp 四象限圖` 與 `滑動視窗 Cpk 趨勢圖`，Ch.10 補上公式附錄。

- [ ] **Step 4: 執行完整驗證關卡（單元、範圍變異、效能、建置與 `release-check`）**

Run:
1. `node --test tests/analyze-core.test.mjs tests/spi-stats-ext.test.mjs tests/ui-copy.test.mjs tests/mobile-layout.test.mjs`
2. `node tools/mutation-check.mjs`
3. `node tools/bench-large.mjs`（驗證 5 萬筆級 `analyze` 與 `detectIssues` 各 <3 秒）
4. `npm run build:cloudflare && npm run build:offline`
5. `npm run release-check`（內含完整 `npm test` + 發布掃描，不重複跑 `npm test`）

Expected: 全數通過，效能 <3 秒，`dist/` 無多餘資產。

- [ ] **Step 5: Commit**

```bash
git add lib/analyze-core.mjs tests/analyze-core.test.mjs spi-spc.html
git commit -m "feat(report,ai): integrate phase 1 statistical charts into report and AI payload"
```
