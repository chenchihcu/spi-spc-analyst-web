# 雲端記錄庫寫入／開啟／刪除（`records`）

## 目的
驗證非空 Cloudflare D1＋R2 資料庫的完整生命週期，以及受控座標檔導入後 3D 空間佈局優先序。

## 步驟與驗收條件
1. 在 scratch 動態產生兩份精簡確定性測試檔：
   - `verify-place-top.csv`（4 顆元件 `R1, R2, C1, U1` 的 TOP 面 mm 受控座標）。
   - `verify-spi-top.csv`（無焊墊 X/Y 欄位的 3 板 × 8 焊墊 SPI 量測檔）。
2. 以本機臨時管理者帳號開啟記錄庫 → 座標檔 → 登錄受控座標檔，確認 `POST /api/records` 成功且座標檔計數變為 `1`。
3. 切換至匯入資料 → 上傳無 X/Y 的 SPI CSV → 選擇面別 `TOP` 與受控座標檔 → 填入料號／版次／鋼板厚度／製令工單 → 點擊套用匯入，確認 `POST /api/records` 成功且 `#impDoneBanner` 顯示。
4. 進入 3D 錫膏模擬頁籤，確認 `#view3d canvas` 可見、無 `.webgl-fallback`，且 `#grid3dWarn` 維持隱藏（驗證 CAD 受控座標優先於虛擬網格）。
5. 重新整理頁面並再次開啟記錄庫，從清單載入剛存入的 SPI 紀錄，確認 `GET /api/records/...` 回傳 HTTP 200（驗證 D1 中繼資料與 R2 原檔往返）。
6. 透過批次刪除依序刪除 SPI 紀錄與座標檔，確認兩者計數歸零。
