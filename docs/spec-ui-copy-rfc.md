# RFC-SPI-UI-COPY-20261029：分析頁文案收斂與中文名稱

**文件編號**：RFC-SPI-UI-COPY-20261029  
**狀態**：已發布（**v10.10.1**，2026-10-29；`main` `0ccab90`／`1ea272c`）  
**範圍**：[`spi-spc.html`](../spi-spc.html) 使用者可見字串；不含統計核心、API、程式註解。

## 1. 目標與非目標

**目標**

- 移除各分析頁教學折疊與重複標題的靜態副標、點擊提示。
- 標題上的英文譯名改為僅中文；報告 HTML 與 PDF 章名同步。

**非目標**

- 不改公式、門檻、欄位語意、匯入契約。
- 不改 CHANGELOG 歷史條目、測試描述中的英文專名。

## 2. 刪除

- `details.how` 教學：`偵測邏輯`、`怎麼看`、`怎麼用`、`怎麼設定`、`判定方式`、`風險分數怎麼算`。
- 管制圖 `#ctrlHow` 及其腳本賦值。
- 靜態 `<small>` 教學句（問題地圖、柏拉圖、盒鬚圖、失效模式說明等）。
- `.click-hint` 點擊教學。
- 問題頁有結果時 `#issSub` 長段排序／誤報講義（標題已含計數）。

## 3. 保留

- 動態 `<small id="*Sub">` 只顯示 n、界限、不良率、擬合結果等。
- 空狀態、載入、錯誤、`role="alert"`。
- 會改變判讀的單句（3D 示意、估算尺寸、開孔來源）。
- 匯入表單必填與格式後果（`aria-describedby`、`.note` 在欄位旁）。
- 功能折疊：問題卡、失效模式明細、稽核紀錄、預覽送出內容。

## 4. 英文譯名 → 僅中文

| 原 | 改 |
|---|---|
| `執行摘要 (Executive Summary)` | `執行摘要` |
| `統計製程管制圖 (Control Charts)` | `統計製程管制圖` |
| `製程能力分析 (Process Capability)` | `製程能力分析` |
| `不良類型柏拉圖 (Pareto Analysis)` | `不良類型柏拉圖` |
| `交叉驗證… (Cross Validation)` | 去掉括號英文 |
| `DFM 開孔建議 (DFM Recommendations)` | `DFM 開孔建議` |
| `資料範圍揭露… (Data Scope & Exclusions)` | 去掉括號英文 |
| `方法附錄… (Methodology Appendix)` | 去掉括號英文 |
| `空間自相關與局部聚類 (Moran's I & LISA)` | `空間自相關與局部聚類` |
| `不良品矩陣 (Pass/Fail)` | `不良品矩陣` |
| `印刷機閉環補償建議 (Closed-Loop Correction)` | `印刷機閉環補償建議` |
| `(OOC)` / `(Shift)` / `(Drift)` 在副標 | 只留中文 |
| `體積 Volume` | `體積` |
| 問題標題 `Bridge Margin` 等 | 已有中文術語 |

**保留括號內容（非譯名）**：`Johnson / Box-Cox / 常態`、`ISO 21747`、`P′ 圖（Laney）`、`X̄-S（每板為子群組）`。

## 5. 驗收

- `node --test tests/ui-copy.test.mjs tests/type-scale.test.mjs tests/ui.smoke.test.js`
- 上述測試只擋已知禁用字串。通過之後仍逐句看靜態標籤：拿掉後合格、數值、範圍或必做動作的判讀不變，就刪。與所在頁籤同名的前綴、口號、把輸入框已寫的欄位再列一次、只寫對象稱謂的說明屬此類。
- build 產物目視：問題偵測、進階分析、分析報告無教學段、章名無英文譯名。計算結果列、空狀態、錯誤與會改變判讀的警示句仍在。

## 6. 收斂紀錄

- 正式站登入頁已顯示 v10.10.1（build 注入時間）；D1 遠端 migration 無待套用。
- 發版前曾移除 `analyzeViaApi` 殘留本機除錯 `fetch`（語法錯誤導致 jsdom 整頁初始化失敗）。
- 登入後資料庫畫面／API 200：發版當次 **NOT TESTED**（無帳密）；未登入 `/api/records` 為 401。
