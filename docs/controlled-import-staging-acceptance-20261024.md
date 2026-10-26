# 受控匯入驗收紀錄（2026-10-24 至 2026-10-25，UTC+8）

## 2026-10-25 當次基準與環境

- `verified`：2026-10-25 19:54–20:02 UTC+8，`origin/main` 與本次工作分支起點同為 `6faeff2a3deddcdc6581d4f99f12256b96896244`；PR #55 已合併，其最新 head `92905ed` 的 GitHub Actions `Test & Build` 為 Success。正式 Worker 仍是 100% 版本 `820ca8b8-616f-4f51-90d5-aae3ea8545ea`；正式與 staging D1 的 `migrations list --remote` 均回報 `No migrations to apply`。兩環境的 `AUTH_USERS`、`AUTH_PEPPER`、`AUTH_SECRET`、`INITIAL_ADMIN_USER` 名稱存在；未讀取 secret 值。
- `verified`：本機 `npm run release-check` 為 `Overall: READY`，45 個測試檔共 334 項通過且八類檢查全 PASS；`npm run build:cloudflare` exit 0，`dist/index.html` 為 814327 bytes、SHA-256 `6511A392847620430B417FD1459BD7D5A0D04B7F81B9C298494B52E288245EE7`。`wrangler deploy --dry-run --config wrangler.staging.jsonc` exit 0，顯示 `spi-spc-staging` D1、`spi-spc-record-staging` R2、AI 停用。
- `verified`：只部署 `spi-spc-analyst-staging`，`deployments status --config wrangler.staging.jsonc` 讀回 100% 版本 `2a53182c-eabf-42e1-820e-b25ad7a6f2e3`（訊息 `UAT-20261025-1949`）。精確網址 <https://spi-spc-analyst-staging.chihfu-chen-tw.workers.dev/> 未登入時 303 轉到登入頁，最終 HTTP 200；登入頁顯示 v10.3.2。版本與本機來源、產物雜湊分別記錄；部署讀回不等於遠端 bitwise 產物驗證。

## 2026-10-25 staging 合成匯入驗收

- `verified`：使用 repo 外的私人腳本副本及獨立 `UAT-20261025-1949-*` 料號。管理者角色 API 200、一般使用者 403、一般使用者上傳座標 403。座標首次上傳／同檔沿用／同範圍不同內容分別為 201／200／409；未對應位號未確認 422、確認後 201；量測重複檔 409、同工單新檔 202 `pending_review`；管理者修正後新檔 `active`、舊檔 `superseded`。封存座標退出新匯入選取，歷史量測的座標連結不變。
- `verified`：三份合成原檔的下載 bytes 與 SHA-256 均與上傳前一致。並行座標衝突為 201／409，D1 只有一份；30,000 位號檔（722717 raw bytes、208040 gzip bytes）讀回一致；4395667 gzip bytes 的請求回 413。
- `verified`：伺服器不採信客戶端 `999` 計數，座標元件數為 1、量測為 2 板／1 焊墊／2 點。通用格式混合有效列與全空白列、僅部分量測欄有值，得到 2／2／2；橫排格式混合有效與空白列得到 1／1／1；兩種全空量測檔均回 422 `empty`。API 清單與 staging D1 `SELECT` 的 `meta.boards/pads/rows` 讀回一致，D1 查詢 `rows_written: 0`。全空檔未建立紀錄。
- `blocked`：本次 staging 瀏覽器資料庫畫面的計數、封存與歷史讀取尚待核對。2026-10-25 晚間登入頁曾暫停登入至 20:25:38（UTC+8）；2026-10-26 再查可控制的 Chrome「智富」設定檔，其中一頁顯示帳號或網路位置暫停登入至 09:20:41（UTC+8）。該時間過後，新開 staging 分頁已顯示沒有鎖定提示的登入表單；使用者確認使用「智富」設定檔，但本次仍未讀到已登入的 staging 畫面。待既有合成管理者帳號登入後，再核對畫面。API/D1 與原檔驗收不能代替瀏覽器驗收。

## 2026-10-25 正式環境唯讀驗收

- `verified`：精確網址 <https://spi-spc-analyst.chihfu-chen-tw.workers.dev/> 在既有授權 session 下顯示 v10.3.2。資料庫畫面讀到量測 1 筆、座標 1 筆、料號規格 3 個版本、管理者角色區塊及稽核 8 筆；量測與座標原始檔下載入口可見。已檢視的清單與稽核流程未出現 HTTP 503，且未執行正式寫入。
- `verified`：以既有授權的唯讀 CLI 重新匯出正式 D1 至 repo 外私人資料夾（10790 bytes，SHA-256 `FB3BFC567A518210F40D643135903B4E66CB8D110230D83EAB4878CE1557568A`），依當次清單下載 5／5 個正式 R2 原檔，解壓後 bytes 與 D1 中各筆 SHA-256 均一致。D1 export 曾提示匯出期間資料庫可能暫不可查；完成後精確正式 URL 未登入流程最終 HTTP 200，migration 再次讀回 `No migrations to apply`。
- `verified`：用當次正式原檔私人副本與目前 `lib/controlled-import.mjs` 本機解析，得到座標 1,000 元件、量測 20 板／2,383 焊墊／47,660 點、7 個未對應位號。這是本機解析器驗證，不能代替正式站瀏覽器重新載入分析的操作驗收。
- `not verified`：正式站瀏覽器的原檔下載功能及由正式紀錄重新載入的本機分析尚未完成核對；瀏覽器下載事件逾時，沒有可核對的瀏覽器下載檔。CLI 的原檔核對不能代替這兩項畫面流程。
- `not pass`（稽核欄位呈現）：正式站「資料與規格 → 資料庫 → 稽核紀錄」中，部分舊「設為預設」列的指紋顯示 `undefined…`；稽核清單本身可讀，但該欄不能視為有效指紋。需核對 API 與舊資料欄位後再決定呈現修正，不在正式環境寫入。
- `not verified`：正式寫入 UAT 與實體 iPhone 驗收不在本次授權範圍；以上唯讀結果不能宣稱完整正式 UAT 通過。

## 2026-10-24 歷史事故與切換紀錄

- 當時建立獨立 `spi-spc-analyst-staging` Worker、`spi-spc-staging` D1、`spi-spc-record-staging` R2；staging `0001`–`0007` 已套用，AI 停用，未複製正式資料。舊 staging 100% 版本為 `f7536cb9-6184-4bb0-aed3-f999237485e0`，早於 PR #55 最後的空白量測列計數修正；本次已由上列新版本取代。
- 正式 Worker 曾在新版部署後讓資料庫與稽核讀取回 HTTP 503；獲授權後曾將 100% 流量回退至 `633d5cbf-2fed-47a4-91e7-9d45c4ddfbcb`，登入後清單恢復可讀。這是歷史事故，不代表本次正式版本仍為回退版。
- 切換前正式 D1 匯出 8522 bytes，SHA-256 `75A4BF07BA4426C695B147474B2114ABD4A6E6EB2E0F91FFF09ADDE3BEB6BF16`；依清單下載的 5 個 R2 原檔與 SHA-256 核對一致，備份在 repo 外。本機 D1 副本套用 `0007` 通過，原有 5 筆紀錄欄位不變。2026-10-25 12:20 UTC+8 正式重新備份與 Time Travel 書籤完成後套用 `0007`，當時讀回 5 筆 legacy 紀錄、8 筆稽核及 3 張新表；本次遠端 migration 讀回再次確認沒有待套用項目。
- 舊 staging 驗收涵蓋受控匯入、3 份原檔核對、並行座標衝突、4 MiB gzip 上限與瀏覽器 v10.3.2 畫面；這些是 2026-10-24 的歷史證據，不能替代上列當次驗收。當時修正前匯入的合成紀錄沒有計數回填，仍顯示 `—`。
