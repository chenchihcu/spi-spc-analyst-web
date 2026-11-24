# SPI 進階統計分析圖表 — 階段二（製程跡象重構與 4 張變異／空間／偏移圖表）實作計畫

> **For agentic workers:** Native inline execution per approved master spec.

**Goal:** 完成階段二（PR 2）全部交付：`lib/spi-stats-ext.mjs` 新增 5 個純統計函式（變異數分解、多變異圖、2D 偏移靶心與 95% 信賴橢圓、板面 X/Y 邊際剖面、開孔方向 0° vs 90°）、`#p-deep` 拆分為 3 個子分頁（`變異與開孔`／`空間與偏移`／`形貌與異常`）、新增正交偵測規則 `M-24`／`M-25` 並通過 `test:slow` 校準、整合分析報告 Ch.7/10 與 AI `"進階統計診斷"`。

**Spec:** [docs/superpowers/specs/2026-11-23-spi-statistical-charts-design.md](../specs/2026-11-23-spi-statistical-charts-design.md)

## Tasks
- [ ] **Task 1**: 擴充 `lib/spi-stats-ext.mjs`（`calcVarianceComponents`、`calcMultiVari`、`calcOffsetEllipse`、`calcBoardProfileXY`、`calcApertureOrientation`），同步至 `spi-spc.html` `<script id="core">` 與 `module.exports`，TDD 單元測試覆蓋所有數學與邊界防呆（交叉 vs 巢狀、奇異矩陣、虛擬網格防呆、單線座標、無方向性長寬欄位）。
- [ ] **Task 2**: `#p-deep` 拆為 3 個子分頁（`.deep-subviews`、`data-subnav-deep="var|spatial|morph"`、`S.deepSub`、`parseTabTarget`/`tabHashFor`/`setTab`/`buildPrintHeadHtml`）並實作 4 張圖表渲染與 `scopeFilter` 變異守衛。
- [ ] **Task 3**: `detectIssues` 新增 `M-24`（雙行程偏移背隙）與 `M-25`（開孔方向效應）並完成 `npm run test:slow` 校準。
- [ ] **Task 4**: 報告 Ch.7/10 離屏圖表與公式嵌入、`extDiagnosticsSummary()` 擴充、全套測試與建置驗證。
