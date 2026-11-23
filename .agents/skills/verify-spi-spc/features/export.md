# 匯出中心下載驗證（`export`）

## 目的
驗證匯出中心（`#exportCenterModal`）實際觸發瀏覽器下載並產出有效檔案。

## 步驟與驗收條件
1. 點擊 `#btnOpenExportModal` 開啟匯出中心，確認摘要顯示焊墊筆數。
2. 依序點擊下載按鈕並以 Playwright `expect_download` 驗證三種格式：
   - `iss-csv`：副檔名 `.csv`，UTF-8 解碼後非空。
   - `iss-xlsx`：副檔名 `.xlsx`，二進位檔頭為 `PK\x03\x04`（有效 OpenXML ZIP）。
   - `rep-md`：副檔名 `.md`，UTF-8 解碼後非空。
3. 關閉匯出中心對話框。
