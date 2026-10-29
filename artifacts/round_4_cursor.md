# SPI-AUDIT 第 4 輪 — Cursor 交叉驗算（R4）

- **角色**：Cursor 席，**只讀**；不修改 app 程式、不開 PR。
- **受測 SHA**：`db17c7bae687ec141511ee52828b2ad61fd50606`（v10.11.2）
- **Codex 對照**：`uploads/codex_bb05.md`（R3 全文）
- **交件時間（台北）**：2026-10-30 00:18（與本 commit 的 `AuthorDate` 核對；UTC commit 為同日 16:18Z 左右）
- **方法**：自 `git show db17c7ba:spi-spc.html` 抽出 `/tmp/spi-db17c7ba.html`，以 `loadCoreFromHtml` + JSDOM 重放；統計以 Python/NumPy/SciPy 獨立重算。行號以下皆指該快照。

## 狀態總表

| ID | 狀態 | 一句話 |
|---|---|---|
| **X1** CX-R3-010 | **CONFIRMED** | M-03 文案含 `\|Cpk\|>50`，條件僅 >10σ；\|Cpk\|≈638 不觸發、>10σ 偏移觸發。 |
| **X2** CX-R3-011 | **CONFIRMED** | 橋接/拉尖/停線 ev 小圖為合成常數序列，非逐板實測。 |
| **X3** CX-R3-012 | **CONFIRMED** | 僅規則 7 命中 15 點時，交叉驗證仍寫「8 條規則皆未觸發」。 |
| **X4a** CX-R3-013 | **CONFIRMED** | 同一多重集合不同排列，AD 抽樣 p 由 ≈1 變 ≈0。 |
| **X4b** CX-R3-014 | **CONFIRMED** | 置中後用 N−2 的 t 檢定；FE 模型 df=19 不達 p<0.001（含置換邊界）。 |
| **T4** CX-R3-016 | **CONFIRMED**（**最終立場：圖卡契約錯誤**） | 圖中心 `gMean`（`:2484`）≠ 卡中心 `mean(boardMeans)`（`:4684`）；25 板反例圖觸發 1/2/5/6/8、Nelson 卡僅 1 張。 |
| **T5** CX-R3-017 UI | **CONFIRMED**（來源 + 有限瀏覽器） | canvas 固定 `#10b981`；圖例用 `var(--ok)`；手動 `data-theme=dark` 缺 `--lisa-*`（實測 LISA 仍為明亮 token）。 |
| **D-30** 70 vs 69 | **NOT VERIFIED**（單筆歸因） | 同輸入在 db17c7ba 重算 **69**（120 µm）／**71**（90 µm）；使用者匯出標題 **70**，無法鎖定唯一離群 pad。 |

證據根目錄：`artifacts/round4-data.json`、`artifacts/round4-d30-diff.json`、`artifacts/r4-ui/`；腳本 `scratch/cursor-audit/round4_probe.mjs`、`round4_ref.py`、`round4_d30_diff.mjs`。

---

## X1 — CX-R3-010（M-03）

**位置**：`spi-spc.html:4230–4242`（快照行號）

**程式**：條件為 `|specCenter − mean(all pads)| > 10·sd(all pads)`（及 σ=0 特例）；`rule_name` 另寫「或 \|Cpk\|>50」（`:4238`）。

**獨立正反例**（`round4_probe.mjs` → `round4-data.json` → `m03`）：

| 案例 | 板均（6 板×2 pad） | 規格 | 全 pad Cpk（獨立） | 中心距/σ | M-03 卡 |
|---|---|---|---:|---:|---|
| 寬規格 | 0/1 交替 | −1000～1000 | **637.93** | 1.05 | **0** |
| 窄規格偏移 | 99/100 交替 | 0～20 | 極大 \|Cpk\| | **>10σ** | **1** |

**判定**：**CONFIRMED** — 規則名與實作不一致；第一例足以否定「\|Cpk\|>50 為觸發條件」。

---

## X2 — CX-R3-011（證據小圖）

**位置**：橋接 `:4735`、拉尖 `:4755`、停線 `:4773`（`evSeries(..., boards.map(()=>badBm.length))` 等）

**重現**（合成 6 板）：

| 卡 | 獨立逐板計數 | app `ev.values` | 單位 |
|---|---|---|---|
| 橋接 | `[3,0,0,0,0,0]` | `[3,3,3,3,3,3]` | `%`（應為「個」） |
| 拉尖 | `[0,3,0,0,0,0]` | `[3,3,3,3,3,3]` | `µm` |
| 停線 | 板均 `[150,120,90,130,110,100]` | `[100,100,73.8,100,100,100]` | 合成「穩態=100%」正規化 |

**判定**：**CONFIRMED** — 與 Codex 一致；不宣稱 raw B 260 卡皆受影響。

---

## X3 — CX-R3-012（規則 7 vs 摘要）

**位置**：規則 7 不進 `flag`（`:2012`）；`crossValidate` 只計 `id!==7`（`:2703–2706`）。

**重現**：15 板板均 `100+[1,-1,…,1]`，每板 2 pad ±0.1 → `rule7Hits=15`，`stable=true`，`flagSize=0`，交叉驗證文案 **「X̄ 圖 8 條規則皆未觸發」**。

**判定**：**CONFIRMED** — 摘要語句可證偽；排除規則 7 影響 `stable` 可以是政策，但不能寫「八條皆未觸發」。

---

## X4a — CX-R3-013（AD 抽樣）

**位置**：`:2606–2607`（>4000 列時 `i % step === 0` 抽樣）

**重現**（Python `round4_ref.py` → `ad_py`，與 Codex 數值一致）：

| | A² | p |
|---|---:|---:|
| 交錯排列抽樣 | 0.000574 | **0.999998** |
| 排序後抽樣 | 64.230 | **≈4.32×10⁻¹²⁶** |
| 全量 6000 點 | 128.489 | ≈0 |

**判定**：**CONFIRMED** — 非末位誤差，是抽樣順序改變常態結論。

---

## X4b — CX-R3-014（空間 t 自由度）

**位置**：`:4574–4575` — `tP(..., P.length−2)`。

**重現**：30 點、10 群、群組內置中後 **r≈0.601**（Python 構造，`round4-data.json` → `spatial_py`）：

| 方法 | df | t | 雙尾 p | p<0.001 出卡？ |
|---|---:|---:|---:|---|
| app 公式 N−2 | 28 | 3.975 | **0.000450** | 是 |
| 群組截距 + 共同斜率 OLS | **19** | 3.274 | **0.00399** | **否** |
| 群組內置換（999 次） | — | — | 邊界 **≈1.0** | FE 結論不依賴置換 |

**判定**：**CONFIRMED** — 與 Codex 跨門檻反例一致；**已做置換**（全為弱相關 null 下極端 t 仍可出現，但 FE 已足以否定 app p）。

---

## T4 — CX-R3-016（S03 圖 vs 卡）

**程式契約**：

- 圖／`nelX`：`gMean = mean(全部 pad)`（`:2484`、`:2502`）
- Nelson **問題卡**：`mu = mean(boardMeans)`（`:4684`）

**六板加權**（Codex 原例）：圖中心 **102.333**，卡中心 **101**（`center6`）。

**25 板反例**（seed 44293 類構造，B10 加權 n=1000）：

| | 值 |
|---|---:|
| 圖中心 gMean | 104.778 |
| 卡中心 mean(bm) | 100.338 |
| 圖 `nel` 觸發（≠7） | **1, 2, 5, 6, 8** |
| `detectIssues` Nelson 卡 | **僅 1 張**（Nelson 規則 1 / B10） |
| `stable` | **false** |

Codex 宣稱「圖 1/2/6、**零** Nelson 卡」；本席重現 **圖比卡多觸發多條規則**（含 1/2/6），零卡極端例在有限搜尋內 **未重現**，但不影響契約矛盾結論。

**R3 vs R4 最終立場**：由「設計選擇需揭露」改為 **CONFIRMED 圖卡契約錯誤** — 同一「X̄／Nelson」敘述下兩套中心已造成 **圖示判異與問題清單不一致**；若刻意雙中心，須分名稱與 UI 說明，不能維持同一判讀文案。

---

## T5 — CX-R3-017（UI/UX）

### CX-UX-R3-009 — 截面 canvas 固定色 vs 主題圖例

| 項目 | 內容 |
|---|---|
| **位置** | 截面繪製 `:7008–7070`（`#10b981`、`#f59e0b` 等）；3D/板面圖例 `:7127`（`var(--ok)` 等） |
| **現況** | 手動深色下 `--ok` 計算為 **#55BE84**（`r4-ui/computed-tokens.json`），canvas 實測線仍 **#10b981**（`:7065`） |
| **為何誤導** | 圖例「實測截面」色與圖中線條不一致，深色模式更明顯 |
| **建議** | 截面 canvas 改讀 `--ok`／圖表 token，與 `#csLegend` 同源 |
| **嚴重度** | 體驗改善（不直接改變統計結論） |
| **驗收** | 來源 **CONFIRMED**；`artifacts/r4-ui/app-manual-dark-overview.png`（build 快照頁全頁，**非** 1440×320 矩陣） |

### CX-UX-R3-010 — 手動深色缺 LISA token

| 項目 | 內容 |
|---|---|
| **位置** | 明亮 `:27`；系統深色 `@media` `:52`；手動 `[data-theme=dark]` `:55–61` **無** `--lisa-*` |
| **現況** | Playwright 設 `data-theme=dark` 後 `--lisa-hh` 仍 **#EF4444**（明亮預設），非系統深色 **#F87171** |
| **為何誤導** | 同一「深色」路徑下 LISA 熱點配色與系統深色不一致 |
| **建議** | 在 `:55–61` 補齊與 `:47–54` 相同 LISA token |
| **嚴重度** | 體驗改善 |
| **驗收** | **CONFIRMED**（token 計算）；LISA 圖面像素 **NOT TESTED** |

---

## D-30：使用者匯出 70 筆 vs 重算 69 筆

**可確認事實**（raw B + CAD + v3 規格 + TOP + 位號 + **120 µm**，db17c7ba）：

- 問題卡標題：**69**（`round4-data.json` → `d30Hpct`；與 R3/Codex 鏈一致）
- 使用者 `user_input_9b4c.csv` 標題：**70**
- 換 **90 µm** 重算標題：**71**（非 70）

**無法在本輪鎖定者**：

- 匯出 CSV 的 `pads` 欄位僅列前若干 +「另 60 個」，**無法還原完整 70 集合**（`round4-d30-diff.json`）
- 70 介於 69（120 µm）與 71（90 µm）之間，**單一 pad 歸因**需當次 app 精確 SHA、stencil、hpct 量化路徑或完整匯出 offender 列表 — 本席 **NOT VERIFIED**

**合理假設（未證實）**：不同 stencil 路徑、舊版次重算、或 hpct/厚度換算邊界上一 pad 進出 D-30 門檻。

---

## 與 Codex R3 對照

| 項目 | Codex | Cursor R4 |
|---|---|---|
| X1–X3、X4a–b | 疑似待交叉 | **CONFIRMED** |
| T4 定性 | 圖卡契約錯誤 | **同意**（並以 25 板反例補強） |
| T5 UI | 來源疑似 | **CONFIRMED** + 有限截圖 |
| D-30 70 | 未解釋 | **NOT VERIFIED**（補充 90→71、120→69） |

---

## 證據路徑索引

| 路徑 | 內容 |
|---|---|
| `artifacts/round_4_cursor.md` | 本報告 |
| `artifacts/round4-data.json` | X1–X4、T4、AD、D-30 標題 |
| `artifacts/round4-d30-diff.json` | 匯出 vs 重算 pads 欄位比對限制 |
| `artifacts/r4-ui/computed-tokens.json` | 手動深色 `--ok` / `--lisa-hh` |
| `artifacts/r4-ui/app-manual-dark-overview.png` | 瀏覽器全頁（db17c7ba 快照 served） |
| `scratch/cursor-audit/round4_probe.mjs` | JS 重現主腳本 |
| `scratch/cursor-audit/round4_ref.py` | AD 抽樣 |
| `scratch/cursor-audit/round4_spatial.py` | 空間 FE（併入 data 之 spatial_py） |
| `uploads/codex_bb05.md` | Codex R3 全文 |
| `/tmp/spi-db17c7ba.html` | v10.11.2 行號基準 |

**未執行**：正式站登入、build 矩陣 UI 驗收、iPhone 真機、Codex「零 Nelson 卡」極端列舉搜尋完盡。
