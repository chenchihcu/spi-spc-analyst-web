---
name: verify-spi-spc
description: "在 SPI·SPC 分析台專案用隔離的本機 Cloudflare Worker、D1 與 Google Chrome 驗證使用者流程，取得登入、資料庫、管制圖、3D 與報告預覽的操作證據。"
---

# SPI·SPC 分析台本機驗證

## Launch
從 Git 工作樹根目錄用 Windows PowerShell 執行。需要 Node ≥22、依 lockfile 安裝的 Wrangler、Google Chrome、Python 3、playwright 與 psutil。本次可重現的環境使用 Node 24.22.2、Playwright 1.58.0、psutil 7.2.2。先檢查環境。

```powershell
node --version
python -c "import playwright, psutil"
Test-Path node_modules/wrangler/bin/wrangler.js
$verify = '.agents/skills/verify-spi-spc/scripts/verify.py'
python -B $verify database
```

命令自動完成建置、啟動、登入、健檢、操作及清理。每次建立獨立的 `.wrangler/verify-*` 目錄，複製 Worker 程式碼，以專案 build 產生資產與版本，用 `tools/hash-password.mjs` 的演算法建立臨時帳號。專案 auth 設定、瀏覽器登入、既有資料庫與 managed Cloudflare 資源均在本次操作範圍之外。

Helper 在該次目錄中執行 `wrangler d1 migrations apply spi-spc --config wrangler.json --local --persist-to state`，再以相同設定執行 `wrangler dev` 並指定獨立的 loopback 與 inspector 埠。本機配置保留 Worker 入口、相容日期、assets 與登入速率限制，產生臨時 D1 ID、R2 bucket 與帳號，停用 AI 及排程。預設空庫，圖表使用 SPA 自帶的示範回合。

## Doctor
`python -B $verify doctor` 重建一個乾淨實例並透過 `#loginForm` 登入。每次 drive 在同一個執行中的實例亦自動執行 doctor。確認埠的擁有程序、登入頁和主頁的版本及建置時間、相同 Chrome session 的 `/__me` 帳號及 `/api/records` HTTP 200 和 records 陣列。失敗時讀 events.jsonl；修正原因後重新執行。技能僅接受本機自建實例。

## Drive
`python -B $verify database` 跑空資料庫分頁與選擇器。以 `control`、`sim3d`、`report` 各跑單項，或 `python -B $verify all` 在一次登入中依序跑四項。實際入口與驗收條件見 [功能地圖](features/README.md)。以可見控制項操作，不透過 SPI_TEST_HOOK、狀態注入或模擬回應。

## Evidence
結果在 `%LOCALAPPDATA%\spi-spc-verify\evidence\<run-id>\`。events.jsonl 分開列 doctor 與 UI 點擊觸發的 GET、狀態和回應摘要。檢查功能前後 PNG；3D 場景需開圖確認板面與焊墊。證明新增、下載或寄送等其他流程時，另驗其實際副作用。只報告實際跑過的入口、資料來源與環境；同次成功的刷新也無法證明既有量測或 R2 原檔可開啟。

## Cleanup
每個入口成功或失敗都會關閉自建 Chrome、終止其 Wrangler 程序樹、清除本次 scratch，再檢查埠和證據檔。缺少 cleanup 事件時查看該次程序與路徑，不動其他執行個體。保留 events.jsonl 與 PNG，禁止匯出 Cookie、密碼、未遮罩的 HAR 或憑證。

## Helpers
執行入口是 `python -B $verify all`。它自行呼叫 `prepare.mjs` 建置並設定一次性帳號，再用 `journeys.py` 操作 Chrome。私有模組的中間輸出僅供父程序讀取。
