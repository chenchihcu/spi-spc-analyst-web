# Round 1 前置：260 項問題清單重現（Cursor）

**日期**：2026-10-29  
**匯出基準**：`user_input.csv`／`user_report.md`（v10.3.7，301-000100124 TOP，匯出文案 **鋼板 90 µm**，260 項＝嚴重 136／警示 118／資訊 6）  
**程式路徑**：`unpivotWide` → `buildRows` → `detectIssues`（`loadCore()`／JSDOM 匯入函式 + 核心 `detectIssues`）  
**Repo 版本**：`main` @ `package.json` **10.11.1**（匯出為 **10.3.7**，見下文差異）

---

## 1. 哪一份 SPI raw 對應匯出清單？

| 檔案 | 列數（含表頭） | 20 板展開後列數 | 焊墊數 | 元件群組數（`group`） | 重現 260 項？ |
|------|----------------|-----------------|--------|------------------------|---------------|
| **`spi_raw_B_2384rows.csv`** | 2384 | **47 660** | **2383** | **656**（見 §2） | **是**（§3） |
| `spi_raw_A_958rows.csv` | 958 | 19 128 | 957 | 263（且與 CAD **0** 配對） | 否 |

**結論**：產生使用者清單的輸入為 **`spi_raw_B_2384rows.csv` + `placement_cad.csv`**。  
`spi_raw_A` 為子集／不同匯出範圍，**不能**重現 260 項。

佐證（B + 正確群組，§2）：

- 立榮橫排：`Component ID` + `PAD ID`，20 板，`Height(%)`／`Volume(%)`／`Area(%)`
- `unpivotWide`：`boards=20`, `pads=2383`, `comps=656`, `thk`＝回合鋼板厚度
- 與匯出卡 #2 內文「2383 焊墊／656 群組」一致（孤立極端卡說明）

---

## 2. 匯入參數（重現用）

| 項目 | 值 |
|------|-----|
| 加工廠格式 | 立榮（`Height(%)n` 橫排） |
| 座標 | `placement_cad.csv`，單位 **mm**，解析面別 **`BOTH`**（檔內含 L1-TOP 與 L6-BOTTOM；量測為 TOP） |
| 量測面 | TOP |
| 規格 | **`artifacts/spec_301-0011001123_v3.json`**（與雲端 資料庫→料號規格 下載一致） |
| 規格 SHA-256 | **`87eec342530a8b1a2a90d94f9360d346e670c485b733a8f3f2462d63eea36fed`**（匯出 metadata 前綴 `87eec342530a` 一致） |
| 規格內容 | `volume`／`area` 70/100/130，`hpct` 75/100/125，`offx`／`offy` −75/0/75，`stencilRef` **120**，`groups: {}` |

### 2.1 關鍵：`group` 必須是位號（656），不是 PartType（60）

`buildRows` 在套用座標後預設 **`r.group = r.pkg`**（`PartType` 欄，約 **60** 種）→ `detectIssues` 僅 **~43** 張卡。

使用者匯出標題為 **`J2`、`R71`、`ED20`…**（位號），且清單規模對應 **656** 個 `group`。  
重現時在 `buildRows` 之後將 **`group ← comp`（位號）**，才得到 **260** 張卡。

| `group` 語意 | 群組數 | 問題卡數 | 嚴重／警示／資訊（鋼板 120 µm，§3.2） |
|----------------|--------|----------|--------------------------------------|
| PartType（`pkg`） | 60 | 43 | 19／17／7 |
| **位號（`comp`）** | **656** | **260** | **136／118／6** |

> **稽核註記**：現行 `spi-spc.html` `buildRows` 在有位號座標時以 **`pkg` 覆写 `group`**。雲端回合若確實綁定座標，理論上應走 PartType 分群；與匯出清單矛盾，Round 1 需釐清（紀錄快照是否為舊版、或匯入時 `group` 已被覆写為位號）。**計數重現以位號分群為準**（與匯出一致）。

### 2.2 座標檔料號歸檔（301-001100123 vs 301-0011001123）

雲端狀態（使用者描述）：

- 使用中座標 **`X3000 V5座標檔.csv`** 掛在料號 **301-001100123**（少一個 `1`）
- 同檔副本在 **301-0011001123** 下為**封存**

**對 `group=comp` 的影響**：幾乎無。位號群組來自 SPI **`Component ID`**（refdes），與 D1 上座標列綁在哪個料號無關，只要載入的是同一份 CAD 內容。

**對 `group=pkg` 的影響**：可能有。`pkg`／`PartType` 來自**座標檔**欄位；若 UI 預設載入「301-001100123 使用中」而非「301-0011001123 封存」的檔，且兩份 CSV 內容或版本不同，PartType 對照會變 → **pkg 分群與 DFM 開孔路徑**會變，但不會解釋本次匯出（656 群組、位號標題）— 匯出行為仍指向 **comp 分群**。

---

## 3. 鋼板厚度：`stencilRef`、匯出 90 µm、重現 120 µm

| 來源 | 鋼板 µm | 說明 |
|------|---------|------|
| 匯出 CSV／報告文案 | **90** | 回合 metadata |
| 規格檔 `stencilRef` | **120** | 存檔時參考厚度，**不單獨驅動分析** |
| 重現（§3.1–3.2） | **90 或 120** | 須與 `unpivotWide(..., thk)`、`S.stencil` 一致 |

**程式行為（10.11.1）**：

- `partSpecToState(spec, stencil)` 用**回合** `stencil` 把 `hpct` 窗換成 `height` µm LSL／USL（`hpctToH`）。
- `unpivotWide` 用 `thk` 把 `Height(%)` 換成 `height` µm：`height_um = pct/100 × thk`。
- `detectIssues` 中 **`hpct = height / padThk(r, st) × 100`**；若 import 與 `st.stencil` 相同，**hpct 等於 SPI 的 Height(%)**（例：J2 B01 在 90 與 120 下皆 **67.7%**；`height_um` 為 60.97 vs 81.29）。
- **`stencilRef` 不進上述公式**；僅寫入規格 blob、匯入精靈預填、以及 `spec_source` 文案（若 `stencilRef ≠ S.stencil` 會註記兩者）。

因此：**改 `stencilRef` 欄位本身不改重算結果**；改**回合**鋼板厚度會改 µm 規格窗與部分 defect／邊界，但 **hpct 規則與 SPI % 仍對齊**（在 import／analyze 厚度一致時）。

---

## 4. 與 `user_input.csv` 的比對（真實 v3 規格）

**固定組合**：`spi_raw_B` + `placement_cad` + **`spec_301-0011001123_v3.json`** + **`group=comp`**

詳細差異：`artifacts/replay-301-diff-summary.json`（`scratch/cursor-audit/compare-export.mjs`，未入庫）。

### 4.1 依回合鋼板厚度的總計

| 回合 `stencil` µm | 總卡 | 嚴重 | 警示 | 資訊 | Δ vs 匯出 (136/118/6) | 標題完全一致 `(level, rule_id, title)` |
|-------------------|------|------|------|------|------------------------|----------------------------------------|
| **90**（匯出文案） | 260 | **135** | **119** | 6 | 嚴重 −1、警示 +1 | **232 / 260（89.2%）** |
| **120**（規格 `stencilRef`） | 260 | **136** | **118** | 6 | **0** | **254 / 260（97.7%）** |

**解讀**：

- **等級總數 136/118/6** 與 **10.11.1 重算在 stencil=120** 完全一致，與 **stencil=90** 差 ±1 嚴重／警示（多為 Cpk 邊界在 µm 窗下的 ng／warn 對調）。
- 匯出**文字**寫 90 µm，但** histogram 更像分析時用了 120 µm**（或匯出 metadata 紀錄錯誤、或 v10.3.7 與現行在 90 µm 路徑上仍有 ±1 差）。Round 1 應對 D1 回合快照查 **`S.stencil`** 與 import `thk`，勿只信 CSV 表頭。

**真實 v3 vs 先前 synthetic spec**：在相同 `stencil` 與 `groups: {}` 下，**計數與比對結果相同**（全域窗與 synthetic 一致）。

### 4.2 剩餘差異（stencil=120，6+6 標題鍵）

僅 **6** 張「只在匯出」與 **6** 張「只在重算」，規則分布：**D-30 ×1**、**焊墊位置穩健 Cpk<1.00 ×5**。

| 類型 | 匯出（onlyUser） | 重算（onlyGen） | 可能原因 |
|------|------------------|-----------------|----------|
| D-30 高度%厚彙總 | **70** 處孤立極端 | **69** 處 | 邊界焊墊在 10.3.7 vs 10.11.1 的 ng／warn 或 D-30 計數差 1 |
| Cpk 標題（同元件、不同顯示值） | R281 **0.46**、ED4 **0.64**、C94 **0.80**、ED16 **0.81**、L17 **0.92** | R281 **0.47**、ED4 **0.62**、C94 **0.81**、ED16 **0.82**、L17 **0.89** | 穩健 Cpk／中位數**四捨五入或公式微差**（版本）；嚴重度在 120 µm 下總計已對齊，故多為**標題字串**而非等級桶位移 |
| 同鍵欄位微差 | — | — | 另有 **5** 筆 matched 列的 `z`／`observed` 文案差（例 J12 z −8.3 vs −8.4），不影響 `(level,rule_id,title)` 鍵 |

stencil=90 時另有 **28+28** 標題鍵不重合，幾乎全為 **Cpk 嚴重↔警示對調** + D-30 **70 vs 71** 彙總；見 diff JSON `runs.90`。

### 4.3 前三張卡（重算 vs 匯出 CSV 順序）

重算（`group=comp`，stencil=120）：

1. 314 焊墊 M-09（嚴重）— 與匯出一致  
2. 體積孤立極端 D-30（嚴重）— 與匯出 CSV 第 2 列同類  
3. J2 高度%厚 穩健 Cpk −0.74（嚴重）— 與匯出一致  

（`user_report.md` 與 CSV 的 **排序／標題用字** 略有不同；**以 CSV 為準**。）

---

## 5. 重現指令（可重跑）

```bash
npm install   # 需 devDependency jsdom
node scratch/cursor-audit/replay-301.mjs      # 掃 A/B × 規格 × groupBy
node scratch/cursor-audit/compare-export.mjs  # 產出 replay-301-diff-summary.json
```

輸入路徑預設：`/home/ubuntu/.cursor/projects/workspace/uploads/`（含 `spec_301-0011001123_v3_a3ca.json`）。

---

## 6. Round 1 待辦（AGREED 計畫後）

1. ~~取得 **301-0011001123 v3** 原檔~~ → **已完成**（SHA 見 §2）。  
2. 釐清 **`group=comp` vs `pkg`** 與雲端紀錄；並確認使用中座標是否掛錯料號（§2.2）。  
3. 對 **stencil=120 剩餘 6 對**標題鍵做獨立驗算（D-30 計數、Cpk 中位數／顯示四捨五入）。  
4. 在 **v10.3.7** 建置產物上重跑同一 pipeline（B + CAD BOTH + v3 + comp + stencil 90/120），確認 90 µm metadata 與 120 µm 等級吻合之原因。

---

## 7. 判定（本階段）

| 項目 | 判定 |
|------|------|
| 輸入檔識別 | **確認**：B raw + placement |
| 規格 | **確認**：v3 原檔 SHA 與匯出一致；`groups` 空 |
| 260 項計數 vs 匯出 | **stencil=120：完全一致**（136/118/6）；stencil=90：135/119/6 |
| 清單逐項 `(level,rule_id,title)` | **stencil=120：254/260（97.7%）**；stencil=90：232/260（89.2%） |
| `stencilRef` 120 vs 匯出 90 文案 | **不直接改 hpct**；**等級總數以回合 stencil=120 最貼匯出** |
| 程式 bug | **本輪未驗算**（屬 Phase 1 統計驗算範圍） |

---

*腳本目錄：`scratch/cursor-audit/`（可不入庫）。已入庫：`artifacts/round_1_prep_cursor.md`、`artifacts/replay-301-diff-summary.json`、`artifacts/spec_301-0011001123_v3.json`。*
