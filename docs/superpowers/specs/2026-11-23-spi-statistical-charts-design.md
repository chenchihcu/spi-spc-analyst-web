# 印刷錫膏量測（SPI）進階統計分析圖表總體設計規格

- **日期**：2026-11-23
- **狀態**：已核准（Approved）
- **專案**：`spi-spc-analyst-web`
- **架構決策**：方案 B — 獨立純統計模組 `lib/spi-stats-ext.mjs`（以 `tools/sync-spi-stats-ext.mjs` 同步至 `spi-spc.html`）＋ 全套 Chart.js 統一渲染與離屏報告輸出
- **交付節奏**：單一總體規格，分 **3 個獨立階段（PR）** 依序實作、測試校準與上線驗證

---

## 1. 背景與設計意圖（Intent & Why）

盤點 [spi-spc.html](file:///home/antigravity/chenchihcu/spi-spc-analyst-web/spi-spc.html) 現有統計圖表後，確認專案已具備單變量管制圖（X̄-S、X̄-R、I-MR、Laney P′、EWMA、CUSUM）、多變量 Hotelling T²、製程能力（常態／Johnson／Box-Cox／ISO 21747、直方圖、Q-Q、各板盒鬚圖、焊墊 Cpk 排行）、空間與製程跡象（面積比×轉移效率、相關矩陣、對位向量、前後行程、擦拭週期、形貌、停線衰退、LISA、規格散點／平行座標／Radar、2D 熱圖／3D 模擬）及改善模組（回合比較、DFM、閉環補償、SPI×AOI、DOE 主效應、簡易 GR&R）。

然而，在 SMT 印刷錫膏製程統計分析（IPC-7525 / AIAG SPC）實務中，仍有 **8 類（共 10 張）高價值統計圖表** 尚未設計，涵蓋「高良率監控、時間序列獨立性檢定、製程能力偏心 vs 變異分流、多層級變異溯源、雙軸偏移背隙、板面邊際梯度、開孔方向物理效應、DOE 雙因子交互作用」。補齊這批圖表並與問題偵測、分析報告及 AI 診斷全面整合，能讓製程工程師直接由現有 SPI 欄位完成從「異常偵測 → 變異歸因 → 調機／修鋼板決策」的閉環。

---

## 2. 目標、非目標與反目標

### 目標（Goals）
1. 補齊 8 類共 10 張 SPI/SPC 統計圖表，全數由專案既有匯入欄位（`board`、`figure`、`comp`、`pkg`、`x/y`、`offx/offy`、`apl/apw`、`padl/padw`、`stroke`、`pressure/speed/sep`）計算，不新增強制匯入欄位。
2. 全面整合進既有系統：
   - 嚴格遵循元件範圍篩選（`scopeFilter(st)`：全部元件 → 元件群組 → 單一元件）。
   - 新增 4 條正交 `detectIssues` 偵測規則，並經 `npm run test:slow` 完成穩定製程誤報率校準。
   - 嵌入既有 10 章節「分析報告」（離屏 Chart.js PNG 與公式附錄）並匯入「AI 診斷」結構化摘要。
3. 維持既有效能、離線單檔建置（`build:offline`）、深淺色對比與行動版（320px／44px 觸控熱區）規範。

### 非目標（Non-Goals）
- 不新增頂層主分頁（維持現有 10 個主分頁）。
- 不新增外部視覺化函式庫（沿用既有的 Chart.js，不引入 D3/Plotly）。
- 不重構現有 D1／R2 資料庫 schema 或雲端 API。

### 反目標（Anti-Goals）
- **不可在資料缺欄或僅有虛擬網格座標時偽造統計結果**：例如無真實座標／受控座標時，板面 X/Y 邊際剖面必須 fail-visible 停用並明示原因，嚴禁把虛擬網格當真實 PCBA 梯度。
- **不可讓 5 萬筆資料的 `analyze()` 退化**：所有新圖表採按需計算與快取，維持 `analyze` 與 `detectIssues` 各 <3 秒（目標 <1 秒）。
- **不可新增與既有規則重複警報的雜訊卡片**：4 條新偵測規則皆須為正交訊號且於穩定製程模擬下維持名目誤報率。
- **不可違反文案與純文字守則**：所有使用者可見標題僅用中文（無「中文（English）」括號譯名），`.textContent` 嚴禁內嵌 HTML 標籤，卡片清單欄位必經 `topList(arr, 10)` 截斷。

---

## 3. 系統約束（Constraints）

依專案正本 [AGENTS.md](file:///home/antigravity/chenchihcu/spi-spc-analyst-web/AGENTS.md) 與 [APPLE_IPHONE_WEB_UI_UX_STANDARD.md](file:///home/antigravity/chenchihcu/spi-spc-analyst-web/APPLE_IPHONE_WEB_UI_UX_STANDARD.md)：
1. **分析範圍一致**：所有新讀取端一律使用 `scopeFilter(st)`（介面端 `inScopeS(r)`）或已篩選之 `S.A`；篩選結果為 0 列時顯示空狀態，不可退回全板資料。須同步於 `tests/fixtures/mutations-component-scope.json` 補齊變異破壞項目並通過 `node tools/mutation-check.mjs`。
2. **效能與單趟演算法**：5 萬筆資料禁止在巢狀迴圈中使用 `.map().filter().reduce()`；散點超過 4,000 點時僅對「畫面繪製點位」做等距／分層抽樣，**統計估計量、信賴橢圓、ANOVA 與檢定 p 值一律以 100% 範圍內資料計算**。
3. **版面與主題**：所有新卡片容器使用 `minmax(0, 1fr)` 與 `min-width: 0`；按鈕與子分頁觸控熱區 ≥ 44px（`@media (pointer:coarse)`）；圖表色彩取自 CSS 變數 token，深淺色與白底報告預覽對比 ≥ 4.5。
4. **Windows CRLF 與跨 Realm 安全**：同步腳本與測試使用 `\r?\n`；VM 沙箱回傳陣列於測試斷言前以 `Array.from()` 轉換。

---

## 4. 架構方案比較與選定（Approaches）

| 方案 | 說明 | 取捨 |
|---|---|---|
| **方案 A：純函式直寫 `spi-spc.html` ＋ Chart.js** | 10 個演算法寫在 `spi-spc.html` 純計算區，全數以 `mk()`／`renderOffscreenChart()` 繪圖。 | 零額外同步步驟，但單檔體積再膨脹約 1,500 行，純數學單元測試須透過 VM 載入整份 HTML。 |
| **方案 B（選定）：獨立 ESM 模組 `lib/spi-stats-ext.mjs` ＋ 同步守衛 ＋ 全套 Chart.js** | 比照 `lib/windows-parity.mjs`，將 10 個純統計演算法抽至 `lib/spi-stats-ext.mjs`，由 `tools/sync-spi-stats-ext.mjs` 同步至 `spi-spc.html` 的 `/* @spi-stats-ext START */ ... /* @spi-stats-ext END */` 區塊，圖表統一用 Chart.js 渲染與離屏輸出報告。 | 多一層同步守衛測試，但純統計演算法與邊界條件可直接以 Node ESM 毫秒級測試、架構清晰、同時保有離線單檔建置與零重複 PDF 報告繪圖優勢。 |
| **方案 C：Chart.js ＋ 自繪 2D Canvas 混合** | 複雜圖表（靶心橢圓、Multi-Vari、Ca×Cp）改手寫 Canvas。 | 需重寫離屏報告繪圖、手動維護 DPR 縮放（易發生重複放大缺陷）且失去 Chart.js 互動 Tooltip。 |

**選定方案 B**：兼顧測試速度、數學模組可維護性、離線單檔相容性與報告 PDF 離屏輸出一致性。

---

## 5. 資訊架構與頁面落點（Navigation & IA）

不新增頂層主分頁（維持現有 10 個主分頁，與 `tests/mobile-layout.test.mjs` 底部分頁列與「更多」選單斷言完全相容），所有圖表按語意併入 4 個既有分頁，並同步更新 `S` 狀態（新增 `deepSub: "var"`）、`isAnalysisScopeTab()`（確保 `control/acf` 顯示頂部指標與元件範圍列）、`parseTab()`、`tabHashFor()`、`setTab()` 與 `buildPrintHeadHtml()` 列印抬頭：

1. **管制圖（`#p-control`）**：
   - 子分頁擴充為 3 個：`單變量`（`control`）｜ `多變量`（`control/multi`）｜ `自相關`（`control/acf`），同步更新 `setTab()` 子路徑解析與 `data-subnav-control`。
   - `單變量` 的 `#selChart` 下拉選單新增：`G 圖`、`U′ 圖`（純中文標題，無括號英文譯名）。
   - `自相關` 子分頁顯示：`板序自相關與偏自相關圖`（ACF 與 PACF 並排／上下雙圖＋Ljung-Box 摘要）；`isAnalysisScopeTab()` 改為 `AN_TABS.has(S.tab) || (S.tab === "control" && S.controlSub !== "multi")` 以保留指標與元件範圍連動。
2. **製程能力（`#p-capability`）**：
   - 在現有卡片區新增 2 張卡片：`製程能力四象限圖`（Ca × Cp）與 `滑動視窗 Cpk 趨勢圖`。
3. **製程跡象（`#p-deep`）**：
   - 比照 `p-control` 與 `p-improve`，沿用既有 CSS 預留之 `.deep-subviews` 容器與 `data-subnav-deep` 慣例（確保 `#cardMorph` 維持在 `#p-deep` 內且無 `.card .card` 巢狀），拆為 3 個子分頁並同步支援 `setTab("deep/var" | "deep/spatial" | "deep/morph")`（僅渲染當前子分頁，避免 14 張卡片超長捲動與效能浪費）：
     - **`變異與開孔`**（預設，`deep/var`）：`變異數分解與多變異圖`、`面積比 × 轉移效率`、`開孔方向效應圖`、`刮刀前 / 後行程比較`、`鋼板擦拭週期`
     - **`空間與偏移`**（`deep/spatial`）：`二維偏移靶心圖`、`板面 X / Y 邊際剖面梯度圖`、`對位分解`、`空間自相關與局部聚類`
     - **`形貌與異常`**（`deep/morph`）：`形貌指標`、`停線時效與鋼板壽命衰退`、`量測項目相關矩陣`、`關係圖`（維持 `#selRelChart` 原有 3 選項不變）、`統計異常點集中清單`、`板號 × 元件群組 不良品矩陣`
4. **比較與行動 → 實驗驗證（`#p-improve` / `lab`）**：
   - 在現有「印刷參數 DOE」卡片的主效應圖下方新增：`雙因子交互作用圖`。

---

## 6. 分階段詳細規格

### 階段一（PR 1）：管制圖與製程能力擴充（100% 通用欄位）

#### 1.1 G 圖（稀有事件間隔管制圖）
- **純函式**：`calcGChart(rows, specs, st, boardOrder)`
- **演算法**：
  - **正規板序保證**：嚴格依 `analyze()` 之正規板序 `boardOrder`（`A.boards`）走訪各板與板內列序（避免原始 CSV 列亂序造成錯誤間隔），以 `classify(r, specs, st).length > 0` 判定不良。
  - 記錄相鄰兩次不良之間的合格焊墊數 $g_i \ge 0$（$i = 1 \dots m$）。總不良數 $< 2$ 時回傳 `insufficient: true` 與明確空狀態（例如「範圍內不良次數少於 2 次，暫無法繪製間隔圖」）。
  - 設平均間隔 $\bar{g} = \frac{1}{m}\sum g_i$，估計單點不良率 $\hat{p} = \frac{1}{\bar{g} + 1}$。
  - **中心線與精確機率界線（Benneyan Geometric Exact Limits, $\alpha = 0.0027$ 雙尾）**：
    - 中位數中心線：$CL_{\text{med}} = \max(0, \frac{\ln 0.5}{\ln(1-\hat{p})} - 1)$，平均中心線：$CL_{\text{mean}} = \bar{g}$
    - 上限（良率顯著改善）：$UCL = \lceil \frac{\ln(\alpha/2)}{\ln(1-\hat{p})} - 1 \rceil$
    - 下限（不良爆發預警）：$LCL = \max\left(0, \lfloor \frac{\ln(1 - \alpha/2)}{\ln(1-\hat{p})} - 1 \rfloor\right)$。
    - **高良率 $LCL = 0$ 區間補強**：當 $0.00135 \le \hat{p} \le 0.01$（良率 99%–99.865%）時，精確 $LCL$ 為 0，另標記「連續不良叢發」（連續 $k \ge 2$ 次 $g_i = 0$，單次機率 $\hat{p}^2 \le 10^{-4}$）。
- **圖表呈現與既有管制圖管線對齊**：`chartName()` 新增 `g: "G 圖"`、隱藏第二張副圖卡片（同 `p/ewma/cusum`）；因 G 圖屬高度右偏幾何分布且 X 軸為不良事件序號而非板序，Nelson 規則僅保留 Rule 1（越界／連續叢發），其餘規則標 `na: true`；Chart.js 折線圖支援切換線性／對數 Y 軸，低於 LCL 或觸發叢發點標紅、高於 UCL 標綠，卡片附整體良率、$\bar{g}$、中位間隔、爆發次數與「以全指標規格判定不良（同 P′ 圖）」說明。

#### 1.2 Laney U′ 圖（每板單位缺點數管制圖）
- **純函式**：`calcLaneyUChart(rows, specs, st)`
- **演算法**：
  - 對每片板 $i$：計算總缺點數 $c_i = \sum_{r \in B_i} \text{classify}(r, \text{specs}, st).\text{length}$（同一焊墊同時觸發多類不良時累加計次），焊墊數 $n_i = |B_i|$，單位缺點率 $u_i = c_i / n_i$（顯示換算為每千焊墊缺點數 $1000 \cdot u_i$）。
  - **零不良邊界防呆**：當全體 $\bar{u} = 0$ 時，直接回傳 `uBar = 0, sigmaZ = 1, UCL = 0, LCL = 0`（絕不除以 0 產生 `NaN`）。
  - 否則：$\bar{u} = \frac{\sum c_i}{\sum n_i}$，$\sigma_{u,i} = \sqrt{\bar{u} / n_i}$，$z_i = (u_i - \bar{u}) / \sigma_{u,i}$，$\sigma_z = \overline{MR}_z / 1.128$（板數 $< 2$ 時回退 $\sigma_z = 1$）。
  - 管制界線：$UCL_i = \bar{u} + 3 \sigma_{u,i} \sigma_z$、$LCL_i = \max(0, \bar{u} - 3 \sigma_{u,i} \sigma_z)$。
- **圖表呈現與既有管制圖管線對齊**：`chartName()` 新增 `u: "U′ 圖"`、隱藏副圖卡片、並比照 `P′` 圖寫入 `A.series` 與 `drawCtrl()`（使「總覽」管制圖摘要 `#cOvCtrl` 與「多視角診斷」`#diagControl` 自動支援 U′ 圖）；階梯狀變動界線與越界紅點，副標顯示 $\bar{u}$（每千焊墊）、$\sigma_z$ 與全指標不良判定口徑。

#### 1.3 板序自相關與偏自相關圖（ACF / PACF）
- **純函式**：`calcAcfPacf(boardMeans, maxLag)`
- **演算法**：
  - 輸入為當前量測指標之板平均序列 $x_1, \dots, x_N$（$N < 6$ 或序列方差 $\le 10^{-12}$ 時顯示空狀態）。
  - 最大落後期 $K = \min(20, \lfloor N / 3 \rfloor)$。
  - ACF：$r_k = \frac{\sum_{t=k+1}^N (x_t - \bar{x})(x_{t-k} - \bar{x})}{\sum_{t=1}^N (x_t - \bar{x})^2}$。
  - PACF：以 Durbin-Levinson 遞迴計算 $\phi_{kk}$。
  - 95% 信賴帶：$\pm 1.96 / \sqrt{N}$；Ljung-Box 檢定統計量 $Q = N(N+2) \sum_{k=1}^K \frac{r_k^2}{N-k} \sim \chi^2_K$（以既有卡方尾端機率函式計算 $p$ 值）。
- **圖表呈現**：上下或左右兩張柱狀圖（ACF 與 PACF），疊加 $\pm 1.96/\sqrt{N}$ 虛線帶，超出信賴帶之柱體標示警示色，卡片標題區顯示 $Q$ 值、$p$ 值與最顯著週期落後期。

#### 1.4 製程能力四象限圖（Ca × Cp）
- **純函式**：`calcCaCpQuadrant(rows, metric, spec, scopeMode)`
- **演算法**：
  - 須具雙邊規格（`lsl != null && usl != null && usl > lsl`），單邊或無規格時顯示明確空狀態。
  - 依範圍自動決定分組粒度：
    - 全部元件 → 按元件群組（`r.group`）
    - 單一元件群組 → 按元件位號（`compKeyOf(r)`）
    - 單一元件 → 按個別焊墊（`r.pad || r.pin`）
  - 每個點計算（有效樣本 $n \ge 5$；若 $s \le 10^{-12}$ 則標註零變異且不繪製 `Infinity`）：
    - **規格中點基準（保證恆等式精確）**：$M = (\text{lsl} + \text{usl})/2$，$H = (\text{usl} - \text{lsl})/2$
    - 帶正負號準度偏移：$Ca = \frac{\bar{x} - M}{H} \times 100\%$（若使用者設定非對稱 `spec.tgt !== M`，於副標加註「Ca 以規格中點計算，與 Cpk 嚴格對應」）
    - 精密度：$Cp = \frac{\text{usl} - \text{lsl}}{6 s}$，$Cpk \equiv Cp \cdot (1 - |Ca|/100)$
  - 象限分類：
    - 健康製程（$Cpk \ge 1.33$）
    - 偏心可調回（$Cp \ge 1.33$ 且 $Cpk < 1.33$）
    - 變異過大（$Cp < 1.33$ 且 $|Ca| \le 25\%$）
    - 雙重失控（$Cp < 1.33$ 且 $|Ca| > 25\%$）
- **圖表呈現**：Chart.js 散點／氣泡圖（點徑反映樣本數對數），疊加 $Ca = \pm 25\%$ 垂直線、$Cp = 1.33$ 水平線與 V 字型 $Cpk = 1.33$ 等值曲線；**極端高 $Cp$ 視覺防呆**：Y 軸採動態軟上限（避免單一超高 $Cp$ 點壓扁 `0.5–2.5` 主區間），超出軟上限之點貼頂標示，Tooltip 顯示完整精確 $Cp/Cpk$ 與歸類建議。

#### 1.5 滑動視窗 Cpk 趨勢圖（Rolling Cpk）
- **純函式**：`calcRollingCpk(boardGroups, spec, windowSize)`
- **演算法**：
  - 預設視窗 $W = 5$ 片板（工具列可切換 `3 / 5 / 10 / 20`；總板數 $< 3$ 時顯示空狀態，總板數 $< W$ 時自動降級為現有板數或提示）。
  - 步長為 1 片板，對每個視窗 $t \in [W, N]$ 彙整該視窗所有量測值，以單趟滑動累加計算標準常態 $Cp_t$ 與 $Cpk_t$（單視窗 $s \le 10^{-12}$ 回傳 `null` 避免 `Infinity`；當 `capDistMode !== "normal"` 時副標明示「滑動趨勢採常態估算」），並以線性迴歸斜率評估製程能力是否持續衰退。
- **圖表呈現**：Chart.js 雙折線圖（$Cpk$ 實線、$Cp$ 虛線），疊加 $1.33$ 合格線與 $1.00$ 警戒線。

#### 1.6 階段一新增 `detectIssues` 規則（2 條，經 `test:slow` 校準；編號避開歷史已移除之 `M-21`，且不使用 `cat: "空間分布"` 以確保無座標測試相容）
1. **`ACF 板序自相關（M-22）`**：全板板平均序列 $N \ge 15$（避開小樣本 Ljung-Box 卡方近似膨脹），對受測指標數 $M$ 做 Bonferroni 校正：當 Ljung-Box $p < 0.001 / M$ 且（$|r_1| \ge 0.50$ 或存在 $|r_k| \ge \max(0.55, 3.2/\sqrt{N})$ 之顯著週期峰）時觸發 `warn`，提醒工程師 Shewhart 獨立性假設受破壞並列出顯著落後期。
2. **`G 圖高良率不良叢發（M-23）`**：當全板良率 $\ge 99\%$ 且不良數 $\ge 4$，出現連續 $\ge 2$ 個間隔觸發爆發條件（$LCL \ge 1$ 時 $g_i \le LCL$；$LCL = 0$ 時 $g_i = 0$ 且經叢發次數 Bonferroni 校正後 $P(\text{burst}) < 0.002$）時觸發 `warn`，補齊 P′ 圖於高良率區的靈敏度缺口。

---

### 階段二（PR 2）：製程跡象重構與 4 張空間／變異圖表

#### 2.1 變異數分解與多變異圖（混合交叉／巢狀變異分解 & Multi-Vari）
- **純函式**：`calcVarianceComponents(rows, metric)`、`calcMultiVari(rows, metric, maxBoards)`
- **演算法（修正交叉 vs 巢狀結構，O(N) 單趟）**：
  - SMT 拼板中「元件群組（`group`）」與「子板（`figure`）」為**交叉因子**（每片子板皆含相同一套群組），而非巢狀關係：
    - **全板範圍（群組數 $> 1$）**：採序列型（群組調整後）變異分解——先計算元件群組效應變異（`群組間`，反映不同封裝開孔設計差異），再將各列扣除所屬群組均值後之殘差 $e_{ij} = y_{ij} - \bar{y}_{g(ij)}$ 進行嚴格巢狀分解：`板間（Board）→ 子板間（Figure-in-Board，同板具 >1 子板時納入）→ 同板同子板同群組內焊墊殘差（Within）`，並確保各層平方和加總嚴格等於總平方和（百分比總和為 100%）。
    - **單一群組／單一元件範圍**：自動省略「群組間」層，直接進行純巢狀 `板間 → 子板間 → 焊墊殘差` 非平衡 EMS 變異數估計（非負截斷 $\hat{\sigma}^2 = \max(0, \hat{\sigma}^2_{\text{raw}})$），並換算佔總變異百分比 $\%\text{Var}$。
  - **多變異圖資料**：按板序（若板數 $> 30$ 則等距抽樣 30 片板代表並註明）計算每板內各分層（子板優先，無子板則取前 3 大群組或空間前/中/後三區）之平均、P10、P90 區間。
- **圖表呈現**：
  - 上半部：Chart.js 水平堆疊百分比條（明確標出各層變異 % 與最大變異來源結論）。
  - 下半部：Chart.js 浮動長條＋平均點（Multi-Vari 視覺），一眼看出板內跨度 vs 板間漂移。

#### 2.2 二維偏移靶心圖與 95% 信賴橢圓（X-Y Offset Bullseye）
- **純函式**：`calcOffsetEllipse(rows, specs, opts)`（支援 `coreOnly: true` 供 `detectIssues` 跳過橢圓多邊形點位與散點抽樣）
- **演算法**：
  - 篩選同時具備有限 `offx` 與 `offy` 之列（不足 5 筆時顯示空狀態）。
  - 對 100% 有效資料計算質心 $(\bar{x}, \bar{y})$ 與 2×2 樣本共變異數矩陣 $\Sigma$；以封閉式特徵分解求得半軸長 $a = \sqrt{5.991 \cdot \lambda_1}$、$b = \sqrt{5.991 \cdot \lambda_2}$ 與旋轉角 $\theta$，生成 64 點橢圓多邊形座標。
  - **奇異矩陣防呆**：當 $\det(\Sigma) \le 10^{-12}$（完全共線或零變異）時跳過逆矩陣與 Hotelling $T^2$（不產出 `NaN`），僅呈現散點、規格框與質心。
  - 若資料具備 `stroke`（前／後行程各 $\ge 5$ 筆），分別計算前行程與後行程 95% 橢圓、背隙距離 $\Delta = \sqrt{(\bar{x}_F - \bar{x}_R)^2 + (\bar{y}_F - \bar{y}_R)^2}$ µm，以及兩組雙變量 Hotelling $T^2$ 檢定 $p$ 值。
  - 散點顯示層超過 4,000 點時按步長抽樣繪點，並於副標明示「顯示抽樣點數／統計採全量 N 筆」。
- **圖表呈現**：Chart.js `scatter` 圖（鎖定 1:1 座標比例），疊加 `offx/offy` 矩形規格框、原點十字線、95% 信賴橢圓（前／後行程分色）與質心標記。

#### 2.3 板面 X / Y 邊際剖面梯度圖（Board X/Y Marginal Profile）
- **純函式**：`calcBoardProfileXY(rows, metric, bins = 10)`
- **演算法與空間誠實守則**：
  - 僅接受真實焊墊物理座標（`realXY(r)`）或受控 CAD 元件座標（`componentX/Y`）；若全板皆為虛擬網格，回傳 `reason: "virtual_grid"` 並於畫面明確顯示「無實際物理座標，無法計算板面邊際梯度」（絕不以虛擬網格偽造）。
  - **單線座標防呆**：當單一軸向跨距 $\le 10^{-6}\text{ mm}$（例如單一元件所有焊墊共線）時，該軸回傳單一區帶且不計算線性斜率（絕不除以 0）。
  - 將有效 X 範圍與 Y 範圍各切為 $K = 10$ 個等寬區帶（可切換 `8 / 10 / 15`），計算每區帶平均 $\bar{y}_b$ 與 95% 信賴區間 $\bar{y}_b \pm t_{0.975, n_b-1} \cdot s_b / \sqrt{n_b}$；若含 `stroke` 可勾選「依前／後行程分線」。
  - 計算 X 軸與 Y 軸全量線性迴歸斜率（單位：每 100 mm 變化量）與斜率顯著性 $p$ 值。
- **圖表呈現**：並排 2 張 Chart.js 折線＋半透明信賴帶圖（左：沿 X 軸左→右剖面；右：沿 Y 軸前→後剖面）。

#### 2.4 鋼板開孔方向效應圖（0° 平行 vs 90° 垂直刮刀）
- **純函式**：`calcApertureOrientation(rows, metric, sqDir)`
- **演算法**：
  - 依序讀取開孔尺寸 `(apl, apw)`，無則退回焊墊尺寸 `(padl, padw)`（兩者皆無時顯示空狀態）。
  - 計算長寬比 $R = \max(L, W) / \min(L, W)$；$R < 1.25$ 歸為「近似方形」，$R \ge 1.25$ 依長邊軸向結合 `sqDir`（刮刀行進方向）分類為「**平行刮刀（0°）**」或「**垂直刮刀（90°）**」。
  - **無方向性欄位防呆**：若所有長方形開孔均落於單一方向（例如部分 SPI 機台匯出之長／寬恆滿足 $L \ge W$ 而非 X／Y 軸向尺寸），不觸發 `M-25` 且顯示明確說明：「僅偵測到單一長軸方向，可能因匯入欄位為不分軸向的長／寬而非 X／Y 軸尺寸」。
  - 計算各組樣本數、平均、標準差、95% CI，並對「平行 vs 垂直」執行 Welch $t$ 檢定與 Cohen's $d$ 效應量；同時按面積比區間（`<0.66`、`0.66–0.75`、`>0.75`）提供分層統計。
- **圖表呈現**：Chart.js 分組柱狀圖＋誤差線（支援切換「全體」或「按面積比區間分層」），卡片附 Welch $t$ 檢定結論。

#### 2.5 階段二新增 `detectIssues` 規則（2 條，經 `test:slow` 校準）
3. **`刮刀雙行程偏移背隙（M-24）`**：全板具 `stroke` 且前／後行程各 $\ge 15$ 筆、共變異數矩陣非奇異，當雙變量 Hotelling $T^2$ $p < 0.005$ 且背隙距離 $\Delta \ge 20\%$ 偏移公差半寬（或無規格時 $\Delta \ge 15\text{ µm}$）時觸發 `warn`。
4. **`開孔方向效應顯著（M-25）`**：全板平行與垂直刮刀開孔各 $\ge 20$ 筆，當體積（或轉移效率）Welch $t$ $p < 0.005$、平均差 $|\Delta| \ge 3\%$ 且 Cohen's $d \ge 0.4$ 時觸發 `warn`。

---

### 階段三（PR 3）：實驗驗證擴充與全系統報告／AI 完整收尾

#### 3.1 DOE 雙因子交互作用圖（2-Way Interaction Plot）
- **純函式**：`calcDoeInteraction(st, resp)`
- **演算法**：
  - 檢查現有 `FACT`（`pressure`、`speed`、`sep`）中具備 $\ge 2$ 水準的因子；若有效因子 $< 2$ 個顯示空狀態。
  - 對每組因子配對 $(A, B)$ 彙整各組合 $(a_i, b_j)$ 的板回應平均與樣本數，並計算 2-Way ANOVA 交互作用 $F$ 統計量與 $p$ 值。
  - **無重複樣本／缺格子防呆**：若組內殘差自由度 `df_err <= 0`（例如 2×2 各僅 1 片試產板）或存在未測試的空組合，不計算 $F/p$（絕不除以 0 產生 `NaN`），直接繪製折線並標註「無重複樣本／部分格子缺資料，僅供視覺判讀」。
- **圖表呈現**：在「印刷參數 DOE」卡片下方自動渲染 1–3 張 Chart.js 多折線交互作用圖（X 軸為因子 A 水準、各折線為因子 B 水準），標題附交互作用 $p$ 值與是否顯著交叉標註。

---

## 7. 分析報告與 AI 診斷整合規格

1. **分析報告（維持既有 10 章編號）**：
   - **Ch.4 管制圖**：補入 G 圖（平均間隔／爆發次數）、Laney U′ 圖（每千焊墊缺點數／$\sigma_z$）與 ACF Ljung-Box 獨立性摘要表。
   - **Ch.5 製程能力**：以 `renderOffscreenChart()` 嵌入 `Ca × Cp 製程能力四象限圖` 與 `滑動視窗 Cpk 趨勢圖`。
   - **Ch.7 交叉驗證與失效模式**：以 `renderOffscreenChart()` 嵌入 `變異數分解百分比圖`、`二維偏移靶心圖`（具偏移欄時）、`板面 X/Y 邊際剖面圖`（具真實座標時），並附開孔方向 0° vs 90° 統計表。
   - **Ch.10 方法附錄**：補上 Benneyan G 圖精確界線、Laney U′、Ljung-Box ACF、Ca×Cp 恆等式、序列型（群組調整後）混合變異數分解、雙變量 $\chi^2$ 信賴橢圓與 2-Way ANOVA 交互作用之簡明公式。
2. **AI 診斷上下文（符合 `lib/analyze-core.mjs` 白名單與深度／大小限制）**：
   - 於 `lib/analyze-core.mjs` 之 `ALLOWED_KEYS` 正式加入中文頂層鍵 `"進階統計診斷"`（巢狀深度嚴格 $\le 3$，總體積 $< 2\text{ KB}$，遠低於 `LIMITS.maxDepth = 5` 與 `LIMITS.maxBytes = 40_000`，並於 `tests/analyze-core.test.mjs` 新增白名單驗證測試），避免 Worker 靜默丟棄：
     - `變異來源佔比`（群組／板間／子板／板內 % 與主因）
     - `能力四象限重點`（最多前 5 個 `Cpk < 1.33` 群組及其分類：偏心可調 vs 變異過大）
     - `板序自相關`（$r_1$、Ljung-Box $p$、顯著週期落後期）
     - `高良率間隔`（平均間隔、爆發次數）
     - `雙行程偏移背隙`（前／後行程背隙 µm 與 $p$ 值）
     - `開孔方向差異`（0° vs 90° 差值 % 與 $p$ 值）
     - `DOE交互作用`（顯著雙因子配對與 $p$ 值）

---

## 8. 效能、快取與驗證計畫

### `<script id="core">`、Web Worker 與快取共算
- **核心腳本落點**：[spi-spc.html](file:///home/antigravity/chenchihcu/spi-spc-analyst-web/spi-spc.html#L7693) 於資料超過 20,000 筆時會將 `<script id="core">` 內容打包進 inline Web Worker 執行 `detectIssues()`。因此 `/* @spi-stats-ext START */ ... /* @spi-stats-ext END */` **必須內嵌於 `<script id="core">` 內**，且 `lib/spi-stats-ext.mjs` 全程不得引用 `window`／`document`／DOM API，以確保在主執行緒、Web Worker 與 `tests/_load.js` VM 沙箱三環境一致執行。
- **跨執行緒快取傳遞**：在 `S` 狀態建立按 `anKey(st)` 索引的延遲快取（`extStatsCache`），並將 `"extStatsCache"` 加入 `DET_SKIP`（避免傳送大型快取物件給 Worker）。4 條 `detectIssues` 規則（`M-22`～`M-25`）僅執行極輕量純統計核心（5 萬筆預估合計 `< 30 ms`），結果直接附掛於 `F.meta.extCore` 隨 Worker `postMessage` 回傳，主執行緒收到後匯入 `extStatsCache` 供畫面圖表複用（算一次、偵測與圖表共用）；其餘 6 項圖表則於切換分頁／子分頁、產生報告或 AI 診斷時按需計算並快取，完全不阻塞 `analyze()` 主路徑。
- **焦點問題與全板歸類對齊**：4 條新增問題卡（`M-22`～`M-25`）皆屬全板層級診斷卡，明確指定 `sig.t` 並同步擴充 `focusDomainOf(x)` 歸類至既有 `FOCUS_DOMAINS`（不落入預設 fallback）：
  - `M-22`（`sig.t: "acf"`）→ `"process"`（錫量趨勢與擦拭／停線）
  - `M-23`（`sig.t: "gburst"`）→ `"spike"`（單板與局部突發異常）
  - `M-24`（`sig.t: "backlash"`）→ `"align"`（印刷對位偏移）
  - `M-25`（`sig.t: "orient"`）→ `"aperture"`（元件開孔與能力不足）
  - 並由 `issueScope()` 歸入全板層級（`globalBatch`），確保與 `buildFocusedProblems()`、`scopedFindings()` 及 `issuesXlsx()`（M-20 匯出）無縫相容。

### 每階段必過驗證關卡
1. **單元與同步測試**：`tests/spi-stats-ext.test.mjs` 直接匯入 `lib/spi-stats-ext.mjs` 驗證所有公式、空值、極端值、單邊規格、虛擬網格防呆，並驗證 `spi-spc.html` `<script id="core">` 內嵌區塊與 `lib/spi-stats-ext.mjs` 逐字一致。
2. **穩定製程誤報率校準**：新增 4 條偵測規則（`M-22`～`M-25`）於階段一、階段二各自執行 `npm run test:slow` 驗證 i.i.d. 誤報率接近名目值，並逐 seed 記錄 `tests/verdict-sim-expected.json` 變動原因。
3. **分析範圍變異檢查**：於 `tests/fixtures/mutations-component-scope.json` 新增對應破壞項，確認 `node --test tests/component-scope.test.mjs` 與 `node tools/mutation-check.mjs` 全綠。
4. **效能與建置驗證**：`node tools/bench-large.mjs` 驗證 5 萬筆級 `analyze` 與 `detectIssues` 各 <3 秒；`npm run build:cloudflare` 與 `npm run build:offline` 通過。
5. **UI／文案／行動版驗證**：`tests/ui-copy.test.mjs`、`tests/mobile-layout.test.mjs`（含 CSS token 定義檢查、`.deep-subviews`、`#cardMorph` 位置、無巢狀 `.card`）、`tests/spi-audit-fixes.test.mjs`、`tests/analyze-core.test.mjs` 通過，並依 `AGENTS.md` 以 build 產物完成 1440／820／390／320 × 明亮／深色驗證（iPhone 真機未實測標記 `NOT TESTED`）。

---

## 9. 交由實作者決定的細節（Left to Builder）
- Chart.js 圓角、點徑、網格線透明度等次要視覺微調（須符合既有 CSS token 與深淺色對比 ≥ 4.5）。
- 報告離屏圖表寬高比微調（預設沿用既有 `1100 × 620`）。
- `tools/sync-spi-stats-ext.mjs` 實作細節（比照 `tools/sync-windows-parity.mjs`）。
