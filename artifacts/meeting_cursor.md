# Cursor 席位 — 統計正確性稽核方法提案（Phase 0）

**專案**：SPI·SPC 分析台（repo `spi-spc-analyst-web`，正式站 https://spi-spc-analyst.chihfu-chen-tw.workers.dev/）  
**日期**：2026-10-29  
**席位**：Cursor Cloud Agent  
**階段**：唯讀稽核 Phase 0（不修改產品程式、不開 PR）

---

## 1. 稽核目標與成功標準

使用者回報「偵測到 260 項問題：嚴重 136、警示 118」，懷疑**數值本身**與**圖表呈現**有誤，且**嚴重度分級**（`ng`／`warn`／`info`）可能把正常判成異常、或把真問題判成可接受。

本席在每輪的判定標準：

| 判定 | 條件 |
|------|------|
| **確認錯誤** | 獨立驗算與程式輸出差異超出容許（見 §4），且至少兩個平台一致（依 BRIEF 收斂規則） |
| **疑似** | 公式選擇或門檻有爭議、或僅能在使用者特定回合重現、證據不足 |
| **誤報（app 假陽性）** | 規則條件在獨立重算下不成立，但卡片仍為 `warn`／`ng` |
| **漏報（app 假陰性）** | 規則條件成立且依規格應出卡，但程式未產生對應卡片或降為 `info` |

**每輪固定範圍**：除統計／圖表外，須檢視 **UI/UX 是否誘導誤判或誤操作**（§11）。與數值 findings 分開列 ID，但同一輪報告一併交付。

Phase 0 僅定方法；第 1 輪起產出 `artifacts/round_<N>_cursor.md`。

---

## 2. 程式與 UI 邊界（驗算入口）

| 層級 | 位置 | 用途 |
|------|------|------|
| 統計核心 | `spi-spc.html`：`analyzeBase`（約 2472 行起）、`detectIssues`（約 4157 行起）、`calcMoranAndLISA`、`computeXbarR`、`nelson` 等 | 與 UI 相同的真實公式 |
| 測試載入 | `tests/_load.js` → `loadCore()` | Node 沙箱執行核心，**首選驗算路徑**（免瀏覽器、可批次） |
| 檢視／圖表 | `analyzeView`、Chart.js／自繪 canvas（含 LISA、3D、熱圖） | 比對「算出的點」vs「畫出的線／軸／圖例」 |
| 後端 | Cloudflare Worker `/api/analyze`（若與前端 payload 一致） | 正式站 API 200 路徑抽樣（登入後），對照 `loadCore` 結果 |

**原則**：先以 `loadCore()` + 固定 `baseState` 驗算；圖表爭議再用 build 產物 + `SPI_TEST_HOOK`／Playwright 讀 DOM／canvas 像素或 data 屬性交叉確認。

---

## 3. 要驗的統計量（依優先序）

### 3.1 描述統計與 σ 估計

- **平均、標準差、分位數**：板平均、焊墊列、群組內／群組間。
- **組內 σ（`sigmaW`）**：板×元件群組 cell 內 pooled within（`analyzeBase` 2483–2492 行）。
- **長期 σ（`sigmaLT`）**：混合群組時扣除群組平均後的 residual SD（2493–2495）。
- **板間 σ（`sB`）**：板平均之移動全距 ÷ 1.128（2496–2498）；用於 X̄／EWMA／CUSUM 界限，**不**等於 `sigmaW/√n̄`。
- **S 圖**：每板 pooled s；CL = `c4(n)·σ̂`，UCL/LCL = CL ± `3σ̂√(1−c4²)`（2499–2501；對照 `tests/stats.test.js`）。
- **X̄–R（可選子群）**：`computeXbarR` 與 `st.xrSize`／`xrMode`（若 UI 有開）。
- **常數表**：`c4(n)`、`d2(n)`（若有 R 圖）— 對照 `tests/core.test.js` 教科書值。

**常見錯誤假設**：用整體 σ 當管制圖 σ、用焊墊數 n 當 Cpk 有效自由度（程式應取**板數** `nb`）。

### 3.2 製程能力與規格

- **Cp / Cpk**：分母 = 組內 σ；**Pp / Ppk**：分母 = 長期 σ（2546–2547）。
- **混合群組**：逐群組 `capOf`，整體取**最差群組** Cpk（與 `cap.worst` 一致）。
- **Cpk 95% CI**：NIST 近似 `SE = sqrt(1/(9·nb) + Cpk²/(2·(nb−1)))`（2555–2559；`tests/stats.test.js` 33–50 行）。
- **非常態能力**：Box-Cox／Johnson（`calcNonNormalCapability`）；混合群組應回傳不適用（`NN_MIXED`）。
- **規格來源**：料號規格 `partSpec`／`specsG` 覆寫 vs 預設 `DEF_SPECS`；USL/LSL/Tgt 是否進入 `capOf` 正確。
- **PPM 期望**：與 Cpk／非正態分支一致（若有顯示）。
- **單位**：µm／%、hpct 與高度／鋼板厚度；M-03「規格中心距平均 >10σ」邏輯。

### 3.3 管制圖與判異規則

| 圖種 | 驗算重點 |
|------|----------|
| **X̄（三向 S）** | 每點 `v, cl/ucl/lcl, z`；`<5` 板 reject；`<20` 板 warning |
| **S** | 逐板 `df+1` 的 c4 與界限 |
| **I-MR** | 單焊墊序列；MR̄/1.128 |
| **P / P'（Laney）** | `pbar`、`sigZ`、逐板 `sg` 放大（2514–2516；`tests/stats.test.js` 66–72） |
| **EWMA** | λ=0.2，σ 隨 i 的 EWMA 標準差公式（2517–2520） |
| **CUSUM** | k=0.5·σx̄，h=5·σx̄；中心可為 mean／target 與 >10σ 回退（2524–2537） |
| **Nelson 1–8** | `nelson(z)` on X̄ 的 z；**管制狀態**僅看 X̄（2541–2545） |
| **P'/EWMA 規則範圍** | 規則 5–8 標 NA、不得有觸發 idx（`tests/stats.test.js` 75–80） |

Western Electric 若 UI 有對照表，以 Nelson 實作為準逐條對 idx。

### 3.4 常態性與分布圖

- **Anderson–Darling** 與 p 值（`andersonDarling`；`core.test.js` 31–34）。
- **直方圖**：bin 寬度／邊界、是否含超出規格著色；bin 計數加總 = n。
- **Q-Q 或 ECDF**（若有）：分位點與理論線一致。

### 3.5 進階／問題偵測用統計

- **穩健 z**：`robZThr(n)`、`robZBig(n)` 與 `tests/robustz.test.mjs`、表生成工具 `tools/gen-robustz-table.mjs`。
- **焊墊位置穩健 Cpk**：MAD×1.4826、跨板 min(USL−med, med−LSL)/(3·MAD)（detectIssues 4373 一帶）。
- **FastMCD 2D**（M-18）：Mahalanobis 門檻與 `tests`／`tools/gen-mcd-table.mjs`。
- **Moran's I + LISA**：Cliff–Ord、置換／序列蒙地卡羅 p（3920+ 行）；**整體卡**只依全域 I，LISA 象限僅圖示。
- **空間偏相關、刮刀方向 D-64、擦拭週期自助法**：迴歸係數、p 值、校準 B 與 repo 內 Python/JS 對照腳本（`tests/fixtures/audit/r4/tv.py`、`r6/tv20_r6.py` 等）。
- **Welch t、ANOVA、CUSUM 漂移卡**：與 detectIssues 內 `rule_id` 條件逐條重算。

### 3.6 圖表呈現（非公式但易錯）

- Chart.js：資料集 `data` 與 `analyzeView` 輸出逐點一致；CL/UCL 輔助線 y 值。
- **LISA / 熱圖 / 3D**：CSS 固定 canvas 尺寸（AGENTS.md）；座標用 `componentX/Y` vs 舊 `x/y`（回歸 `tests/step8.test.mjs`）。
- **報告／PDF 預覽**：數字與主畫面 KPI 同源（列印 token 不影響數值）。
- **四捨五五入**：UI `f(x,d)` 位數 vs 內部全精度；僅在 |Δ| > 0.5 ulp(顯示位) 時列為圖表／文案不一致。

---

## 4. 獨立參考實作

### 4.1 主要工具

| 工具 | 用途 |
|------|------|
| **Python 3** + `numpy` + `scipy.stats` | Cp/Cpk、t/F 檢定、AD（若自寫）、直方圖、線性迴歸、置換檢定 |
| **Node** + `loadCore()` | 與產品逐位元比對 golden；批次跑 detectIssues |
| **手算／教科書** | Montgomery SPC；NIST SEMATECH e-Handbook（Cpk CI、P 圖） |
| **Repo 既有** | `tests/golden.test.mjs`、`tests/stats.test.js`、`tests/verdict-sim.test.mjs`、`tests/fixtures/audit/**` |

### 4.2 容許誤差

- 能力指標、σ、界限：**相对误差 ≤ 1e−9**（或 abs ≤ 1e−12）與 `stats.test.js` 一致。
-  p 值、CI：**≤ 0.001** 絕對差（Monte Carlo 規則除外）。
-  Monte Carlo／置換：**固定 seed**，與程式種子一致時 p／計數應相同；不一致時報「實作差異」而非直接判 bug。
-  圖表像素：CL 線與 tooltip 數值 **≤ 1 display unit**（四捨五入後一致即 pass）。

### 4.3  scratch 腳本（唯讀階段）

允許在 `scratch/cursor-audit/`（不進 `dist/`、不 push 產品路徑）撰寫：

- `recompute_cap.py`：從 CSV 讀取 → numpy 算 Cp/Cpk/Pp/Ppk。
- `replay_detect.mjs`：載入 CSV → `detectIssues` → 輸出每卡 `rule_id` 與中間量 JSON。
- `compare_nelson.py`：z 序列雙邊對照。

---

## 5. 測試與輸入資料策略

### 5.1 Repo 內建（無客戶資料）

| 資料 | 目的 |
|------|------|
| `tests/fixtures/stable-25.csv` + `tools/gen-stable.mjs` | 穩定製程應 **0** warn/ng（`verdict-sim.test.mjs`） |
| `tests/fixtures/verdict-sim-expected.json` | 200 seeds × shift 0/3；量測**誤報率**與附錄 C 一致率 ≥85% |
| `c.sampleData()` | 8 類埋入問題應全抓到（`core.test.js` 53–57） |
| `tests/stats.test.js` 合成器 | 能力、S 圖、P'、規則 NA 等已知答案 |
| `tests/fixtures/golden/*.csv` | 匯入／座標／時間戳 alias 不回歸 |
| `tests/fixtures/audit/audit3|4/testdata/*.csv` | 第三、四輪合成（群組、孤立極端、GRR 等） |
| `tests/fixtures/audit/r6/*.json` | Nelson／模擬輸出對照 |

### 5.2 合成資料（已知 ground truth）

- i.i.d. 高斯焊墊 × 25–50 板：**期望零張 warn/ng 卡**（對照 AGENTS.md 統計門檻）。
- 注入單一效應：一步 shift、線性 drift、單板 offset、固定 pad 重複 NG、2D 離群 — 各對應一條 `rule_id`。
- **小樣本邊界**：4 板、9 焊墊、單群組 n=10、σ=0 — 確認 NaN／reject 理由字串正確。

### 5.3 使用者「260 項」回合（第 1 輪起，需資料來源）

依 AGENTS.md：**與使用者相同來源** — 雲端紀錄 ID 重新開啟，或同匯入路徑重建 CSV；**不用**僅範例資料代替。

稽核步驟：

1. 匯出該回合量測 CSV + 截圖問題清單計數。
2. `replay_detect.mjs` 離線重跑 → 比對 260／136／118 是否可重現。
3. 分層抽樣：每個 `cat` × `lv` 至少 2 張卡，重算 `rule_id` 條件與 `sig` 內中間量。
4. 若離線與正式站不一致 → 查版本、`#appVer`、API vs 前端 bundle。

---

## 6. 如何稽核「判定規則本身」是否正確

規則分兩層：**(A) 統計條件是否算對**；**(B) 條件成立時 severity 對不對**。

### 6.1 條件是否成立（A）

對每張問題卡：

1. 讀 `rule_id`、`rule_name`、`sig`、`metric`。
2. 從 `sig` 還原母體（板、群組、焊墊列表、量測 k）。
3. 依 `rule_name` 文字重寫最小重算器（或 grep `spi-spc.html` 對應區塊）。
4. 比對：觸發與否、z/Cpk/p/計數、observed 字串中的數字。

### 6.2 嚴重度是否合乎規格（B）

- 解析 `add({ lv: ... })` 分支（例如整板偏移：`noos` 才 `ng`，否則 `warn` — 4324 行）。
- 建立 **severity truth table**：`(rule_id, 中間量組合) → 期望 lv`。
- 用 `tests/single-board-severity.test.mjs`、`tests/severity-clarity.test.mjs` 既有案例擴充。
- **族系誤報率**：對穩定 i.i.d. 資料跑 200+ seeds（`verdict-sim` 方法），逐 `rule_id` 統計 warn/ng 率；與程式內標稱 α（如 FastMCD 10⁻⁴）比較。若穩定製程下某規則 >1% 出 ng → 優先列為「規則過嚴／σ 低估」。

### 6.3 整體判定（6.1 區塊）

- `meta.verdict.level` 由 ng/warn 卡數 + 最差群組 Cpk + AD（4862+ 行）決定。
- 獨立重算：統計 ng/warn 卡數、取 analyze 的 worst Cpk 與 AD p，核對是否應為 ok/warn/ng。

### 6.4 圖表與卡片一致性

- Nelson 觸發點索引應能在 X̄ 圖上點出；CUSUM 卡應與 `cusum.pts` 越界一致。
- 能力頁 Cpk 與問題卡「系統性能力」同 metric 同群組時數值一致（允許顯示位四捨五入）。

---

## 7. 第 1 輪執行計畫（待 AGREED.md 對齊後）

1. **基線**：`npm test` + `npm run test:slow` 全綠；記錄版本。
2. **核心公式掃描**：對 `analyzeBase` 輸出欄位建 checklist，用 stable-25 + sampleData 逐欄 Python/Node 對拍。
3. **detectIssues 覆蓋**：grep 全部 `rule_id`，建表（約 40+ 條）；優先 **高計數 cat**（單板異常、焊墊位置、系統性能力、孤立極端、空間）。
4. **圖表抽測**：build 產物 1440/390 寬，X̄/S/P'/EWMA/CUSUM/直方圖/LISA 各 1 組，讀 hook 或 tooltip。
5. **使用者回合**：取得紀錄後重跑 §5.3；若無資料則標 `BLOCKED`，先交合成資料 findings。
6. **UI/UX 走查**：依 §11 模板複核匯出／報告／資料庫路徑（含 Round 0 已知候選項是否仍成立）。

---

## 8. 產出格式（第 N 輪）

檔案：`artifacts/round_<N>_cursor.md`

每項（統計）：

```text
ID: CUR-R<N>-###
位置: spi-spc.html:行號 或 UI「問題偵測／管制圖／能力」+ 圖名
規則/欄位: rule_id 或 sigmaW / cap.cpk / nel.rules[1].idx …
程式值: …
獨立值: …（工具與公式一句）
輸入: stable-25.csv | sampleData | 紀錄 ID …
判定: 確認錯誤 | 疑似 | 誤報 | 漏報
證據: 指令、差異量、截圖或 JSON 片段
```

UI/UX 項另用 §11 模板（前綴 `CUR-UX-R<N>-`）。

---

## 9. 風險與限制

- **無登入憑證**時無法在正式 Worker 驗 D1 路徑；靜態預覽無 `/api/analyze`（AGENTS.md：不得寫成雲端已驗證）。
- **Web Worker 背景 `anWork`** 與主執行緒 `analyze` 應一致；若懷疑 race，用同步路徑驗算。
- **260 項**可能含大量同根因（例如 σ 或 z 門檻一錯全連鎖）；會先做**根因分群**再列 ID，避免 260 條重複 findings。
- 三平台一致才標「確認錯誤」；本席單獨只標「疑似」或「待他席 corroborate」。

---

## 10. 與其他席位分工建議

| 區塊 | Cursor 側重 |
|------|-------------|
| `loadCore` 批次 + repo fixtures | ✓ 主力 |
| Python scipy 獨立重算 | ✓ |
| 正式站 GUI／登入後回合 | 需憑證或使用者匯出 |
| Miniflare D1（r13–r15） | 非統計主線，僅必要時 |
| UI/UX 誤導／誤操作 | ✓ 每輪 §11 |

---

## 11. UI/UX 稽核（每輪固定）

**目的**：找出會讓使用者**得出錯誤結論**、**在錯誤前提下操作**，或**掩蓋分析前提**的介面設計；不等同於版面 polish，但 polish 若造成誤讀仍要列。

**走查範圍（至少）**：頂部狀態列、資料與規格（匯入／規格表／資料庫）、問題清單與匯出 CSV/MD、報告預覽／PDF、能力／管制圖圖例與單位、深色模式報告可讀性（對照 AGENTS.md 驗證矩陣抽樣）。

**每項必含欄位**：

| 欄位 | 說明 |
|------|------|
| 位置 | 分頁／元件（例：報告預覽表頭 `#repSec1`、資料庫下載鈕） |
| 現況 | 使用者實際看到或得到的行為 |
| 為何誤導 | 與真實分析前提或操作後果的落差 |
| 建議修正 | 文案／雙欄揭露／阻擋／預設對齊（本稽核階段僅建議，不改程式） |
| 嚴重度 | **導致錯誤結論** ／ **易誤操作** ／ **UX 優化** |

**Round 0 已知候選（301 回合，待 Round 1 在正式 UI 再驗）**：

| ID | 位置 | 現況 | 為何誤導 | 建議修正 | 嚴重度 |
|----|------|------|----------|----------|--------|
| UX-0a | 報告預覽／匯出 MD（`renderReport` `#repSec1`、`reportMd`／`issuesMd` 鋼板行） | 表頭與清單顯示 **`S.stencil` µm**（例：匯出寫 **90 µm**） | 離線重現顯示：若匯入曾用 90 記 `hPctThk` 後改厚度、或紀錄 metadata 與現行 `S.stencil` 不一致，**文案仍只顯示單一厚度**；使用者會以為判定依 90 µm，而重算 136/118/6 更像 **120 µm** 分析路徑 | 表頭並列 **「匯入換算厚度」與「目前分析厚度」**；若兩者不同顯示警示；`specSrcText` 已有 stencilRef≠回合時文案，報告表頭應同源 | **導致錯誤結論** |
| UX-0b | 資料庫 → 料號規格 → 下載（`recPicker` `act==="dl"`，`料號規格_${part}_v${rec.ver}.json`） | 檔名出現 **`vundefined`**（`rec.ver` 未帶入） | 版本追溯失敗、與雲端「v3」認知不一致，易混用錯版規格檔 | 下載檔名 fallback `ver \|\| 0` 或從列表 API 保證 `ver`；缺值時禁止下載並提示 | **易誤操作** |
| UX-0c | 資料庫 → 座標檔（依 **`placePart`／料號** 分桶；匯入綁 `placeId`） | 使用中 **`X3000 V5座標檔.csv`** 掛在 **301-001100123**（ typo ），正確料號 **301-0011001123** 下為封存 | 依料號選檔時可能載到**不同生命週期**的座標；**PartType→`group=pkg`** 路徑會變；報告「已套用座標檔：part rev」可能與量測料號不一致，難以發現歸檔錯誤 | 料號不一致時強提示（比照 `specSrcText` 規格料號≠回合料號）；座標預設僅 **active** 且 part 完全匹配；封存跨料號複本需明示 | **易誤操作**（若走 pkg 分群則升級為 **導致錯誤結論**） |

**備註**：`stencilRef` 在規格 JSON 內**不單獨驅動 hpct 公式**（見 `round_1_prep_cursor.md` §3）；UI 若只強調規格檔 120 µm 而回合顯示 90 µm，會加劇 UX-0a。

---

*Phase 0 完成；UI/UX 常規已併入 §11。等候 `meeting/AGREED.md` 合併計畫後進入 Round 1（統計驗算 + §11 走查）。*
