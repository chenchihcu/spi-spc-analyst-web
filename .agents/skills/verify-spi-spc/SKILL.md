---
name: verify-spi-spc
description: SPI·SPC 分析台本機 Worker、D1 與 Chrome 流程驗證。Use when 以隔離 Worker、D1 與 verify.py 驗證登入、記錄庫、管制圖、3D 與報告預覽。Do NOT use for 跨專案 Playwright（用 automate-playwright-browser）、桌面截圖（用 capture-desktop-screenshot）或發布閘門（用 validate-production-release）。
---
# SPI·SPC 分析台本機驗證

## Launch
從 Git 工作樹根目錄用 Windows PowerShell 或 Linux／雲端 VM 的 bash 執行。需要 Node ≥22、依 lockfile 安裝的 Wrangler、Google Chrome（或 Playwright Chromium）、Python 3、playwright 與 psutil。先檢查環境：

```powershell
node --version
python -c "import playwright, psutil"
Test-Path node_modules/wrangler/bin/wrangler.js
$verify = '.agents/skills/verify-spi-spc/scripts/verify.py'
python -B $verify all
```

Linux / bash：
```bash
node --version
python3 -c "import playwright, psutil"
test -f node_modules/wrangler/bin/wrangler.js
python3 -B .agents/skills/verify-spi-spc/scripts/verify.py all
```

常用選項：
- `--headed`：開啟可視瀏覽器視窗（預設為無頭模式；Linux 無頭模式自動啟用 SwiftShader 軟體 WebGL）。
- `--all-screenshots`：執行 `ui-matrix` 時保留每一個寬度 × 主題 × 分頁的截圖（預設僅保留代表性與失敗截圖）。
- `--allow-console-errors`：將瀏覽器 `console.error`／`pageerror` 記為警告而不直接判失敗（預設有未捕捉錯誤即失敗）。

命令自動完成建置、啟動、登入、健檢、操作及清理。每次建立獨立的 `.wrangler/verify-*` 目錄，複製 Worker 程式碼，以專案 build 產生資產與版本，用 `tools/hash-password.mjs` 的演算法建立臨時帳號（並於隔離 D1 設為 `INITIAL_ADMIN_USER` 以支援受控座標與刪除驗證）。專案 auth 設定、瀏覽器登入、既有資料庫與 managed Cloudflare 資源均在本次操作範圍之外。

## Doctor
`python3 -B $verify doctor` 重建一個乾淨實例並透過 `#loginForm` 登入。每次功能流程在同一個執行中的實例亦自動執行 doctor。確認埠的擁有程序、登入頁和主頁的版本及建置時間、相同 Chrome session 的 `/__me` 帳號及 `/api/records` HTTP 200 和 records 陣列。

## Drive
- 單項功能：`database`、`records`、`accuracy`、`control`、`sim3d`、`tabs`、`scope`、`export`、`report`
- 全部功能流程：`python3 -B $verify all`
- 多視窗與深色模式 UI 矩陣：`python3 -B $verify ui-matrix`
- 全套驗證（全部功能＋UI 矩陣）：`python3 -B $verify full`

實際入口與驗收條件見 [功能地圖](features/README.md)。以可見控制項操作，不透過 `SPI_TEST_HOOK`、狀態注入或模擬回應。

## Evidence
結果在 `%LOCALAPPDATA%\spi-spc-verify\evidence\<run-id>\`（Linux 為 `$XDG_STATE_HOME/spi-spc-verify/evidence/<run-id>/` 或 `~/.local/state/spi-spc-verify/evidence/<run-id>/`）。每次執行皆產出：
- `summary.md` 與 `summary.json`：版本、執行耗時、各流程通過／失敗、UI 矩陣結果與瀏覽器錯誤清單。
- `events.jsonl`：doctor、UI 操作、API 回應摘要、瀏覽器錯誤與 cleanup 事件。
- 各流程與失敗／代表性截圖（PNG）。

只報告實際跑過的入口、資料來源與環境；禁止匯出 Cookie、密碼、未遮罩的 HAR 或憑證。

## Cleanup
每個入口成功或失敗都會關閉自建 Chrome、終止其 Wrangler 程序樹、清除本次 scratch，再檢查埠和證據檔。

## Helpers
執行入口是 `verify.py`。它自行呼叫 `prepare.mjs` 建置並設定一次性帳號，再呼叫 `journeys.py` 與 `ui_matrix.py` 操作瀏覽器。
