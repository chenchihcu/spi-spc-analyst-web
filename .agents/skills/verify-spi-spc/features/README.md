# SPI·SPC 使用者操作地圖

| 功能 | 本機種子與可觀察結果 |
|---|---|
| [資料庫瀏覽](database.md) | 空白 D1。記錄庫選擇器顯示空狀態，重新整理觸發成功的資料查詢。狀態膠囊不開選擇器。 |
| [記錄庫讀寫與受控座標](records.md) | 動態產生受控座標 CSV 與無 X/Y SPI CSV：存入 D1＋R2 → 3D 驗證 CAD 佈局（無虛擬網格警示）→ 重整重開 → 刪除歸零。 |
| [管制圖](control.md) | 示範回合。主管制圖與 CL 摘要可讀。 |
| [3D 焊墊位置](sim3d.md) | 示範回合切板與 HUD。受控座標佈局由 `records` 另行驗證。 |
| [主要分析分頁](tabs.md) | 示範回合。逐一巡檢總覽、問題偵測、製程能力、製程跡象、比較與行動、AI 診斷與資料子分頁。 |
| [分析範圍連動](scope.md) | 示範回合。全部 → 元件群組 → 單一元件跨分頁連動與清除。 |
| [匯出中心下載](export.md) | 示範回合。實際下載 CSV、XLSX（ZIP 檔頭）與 Markdown 報告。 |
| [分析報告預覽](report.md) | 示範回合切換章節，預覽隨之更新。 |
| [多視窗與深色 UI 矩陣](ui-matrix.md) | 1440／820／390／320 × 明亮／深色（dpr=2）：溢出、重進畫布穩定性、手機觸控 ≥44px 與深色報告對比 ≥4.5。 |

- `verify.py all`：在單一登入工作階段依序跑全部 8 項功能流程（`database`、`records`、`control`、`sim3d`、`tabs`、`scope`、`export`、`report`）。
- `verify.py ui-matrix`：跑 4 寬度 × 2 主題 UI 矩陣。
- `verify.py full`：跑 `all` 加上 `ui-matrix`。
