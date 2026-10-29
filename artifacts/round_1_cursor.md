# Round 1 — Cursor 統計／UI 稽核報告

**日期**：2026-10-29  
**依據**：`AGREED.md`（Phase 0 合併）、`meeting/AGREED_007c.md`  
**受測程式**：main @ `4534aa26e22dc67e3583ebc4b04d826b2de4e376`（package **10.11.1**）  
**使用者匯出**：v10.3.7（`user_input_9b4c.csv`，SHA `5de75f2127…`）  
**角色分工**：`loadCore`／JSDOM 路徑＝重現 app 輸出；**numpy 獨立重算**＝不匯入 JS 核心／常數表／校準 JSON。

---

## 0. 基線輸入（SHA-256）

| 檔案 | SHA-256 |
|------|---------|
| `spi_raw_B_2384rows_d310.csv` | `7b2ebd0c54c5eb4b0e041b26e68856e8f92370d39b4d1b83a276353e93098694` |
| `placement_cad_8eab.csv` | `ee17ce0dd6914da67de91fbfd10e7613a9ebda43b4427e8f8aaaa4d85325959b` |
| 料號規格 v3 | `87eec342530a8b1a2a90d94f9360d346e670c485b733a8f3f2462d63eea36fed` |

**重現設定**：立榮 raw B、CAD **BOTH**、真實 v3（`groups: {}`）、**鋼板 120 µm**（90 µm 對照）、**`group ← comp`（位號）**。

**260 卡重現（10.11.1）**：136／118／6；與 v10.3.7 匯出比對 **254／260** 標題鍵一致（見 `replay-301-diff-summary.json`）。

---

## 1. 統計發現摘要

| 類別 | 結論 |
|------|------|
| 焊墊位置穩健 Cpk×237 | **公式與 0.67／1 分級**：numpy 與 app 內部 `mc` 一致；**0** 筆嚴重度對不上 |
| 六項匯出差異 | **版本差異／顯示四捨五入**；非 v10.11.1 統計錯誤 |
| pkg 分群 | 與 comp 匯出矛盾屬 **行為／資料模型**；非本輪「算錯」 |
| 穩定 i.i.d. 200 seeds | **8%** 至少一張 warn/ng；D-30、Nelson 1 等有非零誤報率 → **疑似**（規則校準） |
| Codex 疑似 S01／S03／S05／S09 | 本席獨立證據見下；**均標疑似**（待 Codex 交叉） |

---

## 2. 統計發現明細

### CUR-R1-001 — 焊墊位置穩健 Cpk（237 張）公式

- **位置**：`spi-spc.html` `detectIssues` 4354–4385（`gPads` 每 pad ≥5 板、`robust`、群組內 pad 指標中位數 `mc`）
- **規則**：每 pad：`cpk = min(USL−m, m−LSL)/(3×1.4826×MAD)`；群組卡：`mc = median(pad cpk)`；`mc < 1` 出卡；**`mc < 0.67` → 嚴重，否則警示**
- **程式值**：237 張（嚴重 124、警示 113）；與 `detectIssues` 輸出一致
- **獨立值**（Python numpy，`scratch/cursor-audit/round1_robust_cpk.py`）：237 張；124／113；**237／237** 組 `(g,k)` 的 **完整精度 `mc` 與 app 內部一致**（最大 |Δmc| ≈ **0.005**，來自標題 `f(mc)` 二位小數，見 CUR-R1-002）
- **輸入**：上表 SHA + comp + 120 µm；列資料經 `round1-export-rows.mjs` 展開（含 `hpct` 換算）
- **判定**：**未發現確認錯誤**（條件 A 算對）
- **證據**：`artifacts/round1-data.json`、`artifacts/round1-py-summary.json`；`node scratch/cursor-audit/round1-export-rows.mjs && python3 scratch/cursor-audit/round1_robust_cpk.py`

### CUR-R1-002 — 小樣本（每 pad ≥5 板）與指標命名

- **位置**：同上 `gPads` 過濾 `p.rows.length >= 5`；`P.length < 2` 不出卡
- **現況**：20 板資料下，多數位號僅 **2–4 個焊墊位置** 參與中位數（pad 數 ≥2 即可）
- **獨立值**：numpy 重算與 app 相同門檻；237 卡嚴重度 **0** 不一致
- **判定**：**疑似（政策）** — 5 板即估 MAD 穩定性有限，屬產品規則而非實作 bug；AGREED §3 要求標出 0.67／1 為產品政策
- **證據**：規則文字「每個焊墊位置跨 20 板」；實際為 **≥5 非空值** 即納入

### CUR-R1-003 — 六項 v10.3.7 匯出差異（D-30 + 5 張 Cpk 標題）

| 項目 | 匯出 (v10.3.7) | app 10.11.1 (120 µm) | 獨立／根因 |
|------|----------------|----------------------|------------|
| D-30 高度%厚 | **70** 處 | **69** 處（`sig.rows.length`） | 孤立極端候選剔除／Poisson 分級邊界 1  pad；**版本差異** |
| R281 hpct 標題 | 0.**46** | 0.**47** | 完整 mc **0.4687** → 四捨五入 0.47；匯出較像舊版 `f()` 或舊資料 |
| ED4 | 0.64 | 0.62 | 標題取位差；**等級同為嚴重** |
| C94 / ED16 / L17 | 0.80／0.81／0.92 | 0.81／0.82／0.89 | 同上；**等級同為警示** |

- **判定**：**版本差異**（非 v10.11.1 重算錯誤）；D-30 若需確認錯誤需 v10.3.7 物件或 Codex 同路徑重現
- **證據**：`artifacts/replay-301-diff-summary.json` `runs.120.compare`；R281 numpy mc 見內部演算 0.46868…

### CUR-R1-004 — PartType（`pkg`）分群 vs 匯出（comp）

- **位置**：`buildRows` 預設 `r.group = r.pkg`（約 **60** 群）；匯出標題為位號（656 群）
- **程式值**：**pkg + 120 µm** → **43** 張（19／17／7）；穩健 Cpk 規則僅 **20** 張
- **comp + 120 µm** → **260** 張（136／118／6）
- **獨立值**：同一 raw／CAD；僅改 `group` 指派
- **判定**：**疑似（行為不一致）** — UI 預設 pkg 與使用者匯出 comp 矛盾；非統計公式錯
- **證據**：`artifacts/round1-data.json` → `pkg120`

### CUR-R1-005 — 穩定製程 200 seeds 誤報率（rule_id）

- **位置**：`detectIssues` 全規則；資料 `tools/gen-stable.mjs`（25 板 shift 0）
- **程式值**（200 seeds）：**8.0%** 資料集至少 1 張 warn/ng；逐 rule 觸發率（每 seed 最多計 1 次）：D-30 **3%**、Nelson 1 **5%**、CUSUM **0.5%**、D-64 **1%**
- **獨立值**：同 `loadCore` 批次（重現 app）；**非**宣稱 0 誤報
- **判定**：**疑似** — 穩定 i.i.d. 下部分規則仍常出卡；需與 `verdict-sim`／附錄 C 對照（整體 verdict 仍 mostly ok）
- **證據**：`artifacts/round1-data.json` → `stableSim`

### CUR-R1-006 — Nelson 規則 8（Codex S01）

- **位置**：`spi-spc.html` `nelson()` 2007–2007：`8 點皆 |z|>1` 即觸發，**未要求正負兩側皆有點**
- **程式值**：全正 z 序列 → **觸發**；正負交替且皆 |z|>1 → **亦觸發**
- **獨立值**（Nelson 1984 常見表述：8 點在 1σ 外且**兩側**）：全正序列 → **不觸發**；交替序列 → **觸發**
- **判定**：**疑似** — app 可能比文獻寬鬆；待 Codex 與文獻頁碼交叉
- **證據**：`round1-data.json` → `nelsonRule8Probe`；`round1-py-summary.json` → `nelsonRule8`

### CUR-R1-007 — X̄ 圖中心（Codex S03）

- **位置**：`analyzeBase` 2481–2500：`gMean = mean(all pad values)`；`z = (boardMean − gMean) / sB`
- **程式值**：焊墊列**未按板數加權**的全域平均
- **獨立值**：若改為 `mean(byBoard.mean)` 一般會不同 → **未在此回合改寫**；僅記載定義
- **判定**：**疑似** — 是否為刻意設計待 Codex／文件
- **證據**：程式碼 2481–2500 行

### CUR-R1-008 — Cpk 95% CI 有效 n（Codex S05）

- **位置**：`analyzeBase` 2555–2560：`ne = min(n, nb)`，`SE = sqrt(1/(9·ne) + Cpk²/(2·(ne−1)))`
- **程式值**（301 回合 hpct 整體）：Cpk ≈ **−0.528**；CI **[−0.751, −0.306]**；**ne = 20 板**
- **獨立值**（Python NIST 公式，同上 ne）：CI **逐位相同**（Δ = 0）
- **判定**：**未發現確認錯誤**（在「以板數為 ne」前提下）
- **證據**：`round1-data.json` → `capHpct`

### CUR-R1-009 — Poisson p 顯示（Codex S09）

- **位置**：D-30 組卡 4490：`pv < .0001` → `toExponential(2)`，否則 `f(pv,4)`
- **程式值**：pv = **3×10⁻⁵** → 指數 **`3.00e-5`**，非 `0.0000`
- **獨立值**：`poissonSf` 與 Python `math` 級數一致（本席未逐 pad 重跑 D-30 Poisson）
- **判定**：**疑似** — 若 UI 見 `0.0000` 可能來自**其他欄位四捨五入**或舊版；10.11.1 程式碼傾向指數
- **證據**：`round1-py-summary.json` → `poissonDisplay`；4490 行

### CUR-R1-010 — 圖表資料 vs 渲染

- **位置**：build 產物 + `SPI_TEST_HOOK`
- **現況**：`node --test tests/ui.smoke.test.js` **通過**（含 XSS smoke）；**未**做 14 分頁 × 四寬度圖表逐點比對
- **判定**：**NOT TESTED**（本輪未做完整 AGENTS 驗證矩陣）
- **證據**：smoke 2/2 pass

---

## 3. UI／UX

### CUR-UX-R1-001 — 報告表頭鋼板厚度（UX-0a）

- **位置**：報告預覽 `#repSec1`、匯出 `reportMd`／`issuesMd`（`S.stencil` 單值）
- **現況**：匯出 metadata **90 µm**；重現 136/118/6 需 **120 µm**；表頭只顯示單一厚度
- **為何誤導**：使用者以為判定依 90 µm，與重算／可能實際分析厚度不一致
- **建議**：並列「匯入換算厚度／目前分析厚度」；不一致時警示
- **嚴重度**：**導致錯誤結論**
- **判定**：**疑似**（需正式站回合快照驗證）；程式路徑已確認僅顯示 `S.stencil`

### CUR-UX-R1-002 — 規格下載檔名 `vundefined`（UX-0b）

- **位置**：資料庫下載 `spi-spc.html` ~9104：`料號規格_${part}_v${rec.ver}.json`
- **現況**：`rec.ver` 缺漏時檔名 **`vundefined`**
- **為何誤導**：版本追溯失敗、易混用規格檔
- **建議**：API 保證 `ver` 或 fallback／禁止下載
- **嚴重度**：**易誤操作**
- **判定**：**疑似**（程式路徑確認；本席未登入 D1 實點）

### CUR-UX-R1-003 — 座標檔掛錯料號（UX-0c）

- **位置**：資料庫 → 座標檔（`placePart` 分桶）；匯入 `placeId`
- **現況**：使用中 `X3000 V5座標檔.csv` 在 **301-001100123**；正確料號 **301-0011001123** 為封存
- **為何誤導**：預設載入錯桶 → **PartType／pkg** 路徑與座標證明混淆
- **建議**：與 `specSrcText` 類似之料號不一致警告；active 僅完全匹配
- **嚴重度**：**易誤操作**（走 pkg 時升級為錯誤結論）
- **判定**：**疑似**（營運事實 + 程式結構；未改雲端資料）

### CUR-UX-R1-004 — 預設群組語意

- **位置**：資料匯入後 `buildRows` → **`group = pkg`**
- **現況**：與 260 張**位號**匯出清單不一致；預設 UI 可能只見 ~43 卡
- **建議**：有 CAD 時明示「目前群組：封裝／位號」並與匯出一致
- **嚴重度**：**導致錯誤結論**（若使用者未改群組）
- **判定**：**疑似**

---

## 4. 交叉確認

| 項目 | Codex R1 | Cursor R1 | 備註 |
|------|----------|-----------|------|
| raw B + 120 µm + comp 260 卡 | **未交件** | 已重現 | 待 `rounds/R1/codex.md` |
| 237 穩健 Cpk 公式 | 未驗 | numpy 237/237 mc 一致 | 待 Codex 獨立 Python |
| 六項匯出差異 | 未驗 | **版本差異** | 需 v10.3.7 或 Codex 重現 |
| S01 Nelson 8 | 疑似 | **疑似**（較寬） | 需文獻頁碼 |
| S05 Cpk CI | 疑似 | **公式一致**（ne=板數） | 待 Codex |
| UX-0a/b/c | 未驗 | **疑似**（程式＋營運描述） | 正式站 NOT TESTED |

**確認錯誤**：本輪 **0** 項（兩席一致門檻未達）。  
**本席單獨**：以上 **疑似**／**版本差異** 均待 Codex  corroborate。

---

## 5. 重跑指令（唯讀）

```bash
node scratch/cursor-audit/round1-export-rows.mjs
node scratch/cursor-audit/round1-export.mjs
python3 scratch/cursor-audit/round1_robust_cpk.py
node scratch/cursor-audit/compare-export.mjs
```

---

## 6. 下一輪建議

1. Codex 對 237 張抽 10 張 pad 級中間量獨立重算。  
2. 取得 **v10.3.7** bundle 重跑 D-30 計數 70 vs 69。  
3. 正式站登入驗 UX-0a（`S.stencil` vs 紀錄 `stencil` 欄）與 UX-0b 實際下載檔名。  
4. 圖表逐點：build + `SPI_TEST_HOOK` 對 X̄／S／P′ 至少一組 301 資料。

*本檔為 Cursor Round 1 交件；統計修正 PR 依 AGREED 待使用者核准後另開。*
