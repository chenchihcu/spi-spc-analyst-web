# SPI·SPC 分析台 — 專案規則（正本）

本檔是本專案規則的單一正本。`CLAUDE.md` 與 `GEMINI.md` 以匯入方式讀取本檔，不另存副本。
iPhone／行動版 Web UI/UX 標準見 `APPLE_IPHONE_WEB_UI_UX_STANDARD.md`（`GEMINI.md` 入口）。

## 發布與部署

- **GitHub main 觸發正式發布**：已核實連接的 repository 為 `chenchihcu/spi-spc-analyst-web`、production branch 為 `main`。經授權 commit／push 或 PR 合併到 main 後，由 Cloudflare Git integration 依序完成完整發布檢查、慢速模擬與 build，再部署正式 Worker；建置耗時不固定，不能以推送成功或等待固定秒數判定部署完成。推送／合併授權仍依本次使用者指示與 `website-ship.md`，本條不新增授權。PR 若新增 `cloudflare/migrations/*`，合併前先執行 `npx wrangler d1 migrations list spi-spc --remote`；未套用時先備份（放在 repo 外，release-check 的機密掃描會擋下 repo 內的備份）、在本機副本演練、經使用者核准套用，再合併。
  - 檢查：合併前遠端 migration 清單回報 `No migrations to apply`。
  - 發布讀回：記錄 Git commit、Cloudflare build 狀態、部署 version／流量、正式 URL／HTTP status；資料庫路徑依下一條驗證。多個提交並行建置時，逐一對應來源，不以較新的手動部署替另一個 Git build 作證。
  - 工具受阻：CLI 在啟動前被政策拒絕代表命令未執行，不是 build 失敗；檢查既有核准入口，或以 Chrome 讀取 Cloudflare 狀態。Chrome 安全檢查中止時停止該路徑，列明 not verified、風險及下一項讀回；不以空提交、改連線設定或手動部署繞過。Actions 因付款／額度未執行時記為無測試結果；依 `website-ship.md` 與實際 required checks 繼續處理。
  - 出處：2026-10-24 migration 事故；2026-11-05 使用者確認 GitHub → Cloudflare 發布方式。#94 Git build 約 18 分鐘；#95 觸發後仍需完成 `release-check && test:slow && build:cloudflare`，更正舊「約 30 秒」說法。

| 重複錯誤類別 | 檢查／執行入口 | 證據 |
|---|---|---|
| 混淆提交、建置、部署與工具執行結果 | 既有 Git integration；從 Cloudflare production build／deployment 讀回同一 commit 的狀態與 version；CLI／瀏覽器中止單列為驗證受阻 | 2026-10-24 只查登入頁而漏掉 DB 503；2026-11-05 #95／#96 並行建置與不同來源部署不可互相作證 |
| CI 紅燈或變更未進 main 就停 | 失敗的 required check 修完再 commit、push；該 check 綠後合併 `main`；讀同一 commit 的 Workers Build，不把 Actions dry-run 當成正式站 | 2026-11-11 #117：`test` 失敗後曾停住；Actions 只有 `wrangler deploy --dry-run`；Workers Build `2dc2af00-961c-40c2-9b2c-3fb78e2c4a47`（`cdfface`）當時仍在 running，正式站停在 v10.15.9 |
- **部署驗證要走過資料庫路徑**：登入頁顯示新版本只代表靜態資產已更新。至少確認一個登入後的資料庫畫面或 API 回 200；無法登入時回報「資料庫路徑未驗證」，不可寫成部署成功。
  - 檢查：驗收紀錄寫明走過的頁面或 API 與 HTTP 狀態。
  - 出處：同上事故；當時只看登入頁版本即回報成功。
- **雲端部署以 Cloudflare 正式環境為準**：重現、除錯與驗收走正式 Worker 的頁面與 API（含 D1／R2）。不用只有靜態檔、沒有 Worker API 的本機預覽代替。本機測試與 `wrangler dev` 可輔助，不能把靜態預覽的結果寫成雲端已驗證。
  - 檢查：驗收紀錄寫明正式站 URL、走過的頁面或 API 與 HTTP 狀態。只開了靜態檔伺服器時寫「雲端路徑未驗證」。
  - 出處：2026-10-29 AI 分析；埠 8770 的靜態預覽沒有 `/api/analyze`，不能代表正式站。
- **產品變更做到 main，CI 紅燈自己修完再推**：使用者要求完成的產品變更，工作樹有差異就 commit 並 push。PR 的 required check 失敗時讀該 check 的失敗測試，修完再 commit、push，不把紅燈留給下一輪。該 check 通過後合併進 `main`。GitHub Actions 的 `wrangler deploy --dry-run` 只證明設定可部署，不是正式站已更新。合併後讀 Cloudflare Workers Builds 裡這個 commit 的 build，等到 `success` 或 `fail`；狀態是 `running` 就繼續等，不另開手動 `wrangler deploy`。正式站登入頁版本對上這個 commit 的 `package.json` 版本後，再走「部署驗證要走過資料庫路徑」。
  - 檢查：報告寫明失敗 check、後續 commit、合併 SHA、Workers Build uuid 與 outcome、正式 URL 的版本。停在未合併的 PR，或正式站仍是上一版，這項工作未完成。
  - 停止條件：使用者明確說不要合併或不要上正式站；migration 未核准；衝突會改變已審查行為（沿用下一條）；同一 CI 錯誤修完再推後原樣重現且沒有新證據。
  - 出處：2026-11-11 #117。
- **合併失敗先自行修復再重試，不等使用者要求**：已核准合併的 PR，`gh pr merge` 失敗時先讀錯誤輸出，依下列分類修正，再重跑因修正而失效的必要關卡；完整測試與 `release-check` 的安排依下方「驗證避免重複」規則。必要關卡通過就仍在原核准範圍內，直接重試合併，不需要再問。
  - 與 main 衝突（`gh pr view --json mergeStateStatus` 為 `DIRTY`）：在工作分支 `git merge origin/main`。版本檔（`package.json`、`package-lock.json`、`lib/version.mjs`、`spi-spc.html` 的 `#appVer`、`CHANGELOG.md`；`#appBuilt` 固定為預設值，由 build 注入）先採 main 的內容，再把本 PR 的版本改成 main 版本的下一號，保留本 PR 的 CHANGELOG 條目；依「驗證避免重複」完成受影響關卡後 push，再合併。
  - `--match-head-commit` 一律用 `gh pr view --json headRefOid` 的完整 40 碼 SHA（短 SHA 會被 GraphQL 拒絕）。
  - 遠端已合併、只有本機收尾失敗（worktree 刪除 Permission denied、main 被其他 worktree 佔用、本機分支刪不掉）：以 `gh pr view --json state` 確認 `MERGED` 後繼續部署驗證，收尾失敗只在報告列出殘留路徑。
  - 重試前先確認 `git status` 沒有 `UU`；不在未解決的合併上再開新的合併。
  - 停止條件：衝突落在邏輯程式碼且解法會改變已審查的行為時，解完把差異給使用者看並重新取得核准；auto mode 分類器或使用者拒絕合併屬授權問題，不改寫指令繞過，回報待執行的指令；同一錯誤修正後重現且沒有新證據時停止。
  - 檢查：報告寫明失敗類型、採取的修正與重試結果，或停在哪一個停止條件。
  - 出處：#40–#46、#51、#55 的合併紀錄（2026-10-22～25，5 個 session）：版本檔衝突、短 SHA、worktree 刪除失敗，每次都停下來，直到使用者主動要求修正；這些修正事後都通過原有驗證，證明本可自行完成。

## 資料庫與雲端架構

- 新的量測、座標與規格紀錄只寫入 Cloudflare D1＋R2。未登入或離線時 `RecDB.create` 直接拋錯（fail-closed），不得重新引入本機寫入回退。既有的瀏覽器 IndexedDB 舊資料（`LocalRec`）只供查閱。
  - 檢查：`RecDB.create` 在 `mode!=="cloud"` 時拋錯；`tests/records.test.mjs` 通過。
  - 出處：v10.3.0；原 GEMINI.md 寫「不設在地 IndexedDB」與現況不符，2026-10-26 依程式更正。
- **改變列欄位語意（改名、不再填值）時，同一個 PR 更新所有讀取端**：先 grep 該欄位的全部讀取處（統計、3D、報表 3D、匯出），沒有更新的讀取端要有 fail-visible 處理，不可靜默算出 NaN。
  - 檢查：該匯入路徑有一條測試串過 `buildRows` 到各讀取端（例：`tests/step8.test.mjs`「受控座標匯入 → buildRows → 3D 示意位置皆為有限值」）。
  - 出處：PR #53（座標改寫 `componentX/Y`，3D 仍讀 `r.x/r.y`）→ 2026-10-28 正式站 3D 空白。
- **3D 空間佈局優先序與虛擬網格 Fail-Visible 守則**：焊墊 3D 位置解析（`pos3D`）必須嚴格遵守三階優先序：真實焊墊物理座標（`realXY(r)`）優先 $\to$ CAD 受控元件中心（`componentX/Y`）展開次之 $\to$ 虛擬格狀回退（`gridPos`）保底。虛擬網格座標不得搶先覆蓋 CAD 元件座標；全板僅有虛擬網格時，HUD 與工具列必須以醒目標示（`grid: true`、HUD 警示文字、`#grid3dWarn` 橫幅）明確揭露「無實際座標，為排列示意網格」，嚴禁靜默展示為真實 PCBA 佈局以防誤導檢驗判讀。
  - 檢查：`node --test tests/step8.test.mjs`「3D 座標優先順序與虛擬格狀警示」通過。
  - 出處：PR #98（2026-11-05，缺少焊墊座標時 `pos3D` 誤將 49×49 網格覆蓋 CAD 元件座標致 3D 佈局失真，且無任何示意警語）。

## 統計與問題偵測

| 重複錯誤類別 | 強制檢查 | 歷史證據 |
|---|---|---|
| 用縮小樣本測試代替完整穩定製程校準 | CI 的 `npm run test:slow` 執行完整 seed／群組大小模擬；`tests/release-check.test.js` 阻擋移除或重複此關卡 | #51 FastMCD 小樣本誤報 25–50 倍；#52 Moran's I 標準誤低估造成誤報 |

- **新增或修改偵測規則時，以穩定製程模擬量測誤報率**：用 i.i.d. 資料、在實際群組大小（焊墊群組常只有 30–100 個）下量測每點誤報，需接近名目值。不可使用只在大樣本成立的漸近門檻（χ²、常態近似標準誤），也不可拿同一份資料推估規格再算 Cpk。
  - 檢查：`npm run test:slow` 通過；更新 `tests/verdict-sim-expected.json` 時逐 seed 說明變動原因。
  - 出處：v9.2.0、v9.13.2（1784 項中 1716 張自我參照 Cpk 誤報）、v10.2.0、v10.2.2（FastMCD χ² 小樣本誤報 25–50 倍）、v10.2.3（Moran's I 標準誤低估約 1.5 倍）。
- **效能重構須結果逐位元相同**：只替換實作（迴圈、緩衝、快取），不改公式、門檻與加總順序。萬筆以上資料避免在巢狀迴圈中建立中間陣列（`.map().filter().reduce()`），改用單趟累加或預先索引；Bootstrap／Monte Carlo 前先過顯著性門檻，非必要時延遲計算。
  - 檢查：`tests/golden.test.mjs`、`npm run test:slow` 不變；`node --test tests/core.test.js` 與 `node tools/bench-large.mjs` 下 5 萬筆級 `analyze`、`detectIssues` 各 **<3 秒**（硬門檻）；本機優化目標 **<1 秒**。
  - 出處：v9.13.0、`docs/spec-perf-large-dataset-rfc.md`、步驟 6 效能除錯紀錄（2026-10-17）。
- **大量群組/焊墊清單字串膨脹阻斷（Array String Explosion Guard）**：問題偵測清單組裝卡片時（`detectIssues`），全板級規則（子板、單位、漂移、梯度、刮刀、擦拭、對位、量測等 8 處）與 M-09 重複不良卡之清單欄位（`group`、`refdes`、`p`、`pads`），嚴禁直接使用無界限的 `.join("; ")`。必須統一經由 `topList(arr, 10)` 截斷保底（超過 10 項時自動顯示 `另 N 個/項`），避免多元件基板導致 UI DOM 渲染卡頓與 Markdown/CSV/XLSX 報表幾何級數膨脹。
  - 檢查：`node --test tests/spi-audit-fixes.test.mjs` 全板級與重複不良卡 group 支援 topList 截斷測試通過。
  - 出處：v10.14.3（2026-11-09，656 個元件群組單卡傾印逾 4,000 字元）。

## 版面與 CSS

- **同權重 CSS 後者勝**：`@media (pointer:coarse)` 的 44px 覆寫要放在基礎規則之後；按鈕不寫行內 `min-height`（會蓋過觸控規則）。
  - 檢查：`tests/mobile-layout.test.mjs` 測試 7。
  - 出處：v10.3.1 F1、F3、F5。
- **grid／flex 不可被內容撐寬**：grid 欄寬用 `minmax(0,1fr)`（隱式 `auto` 欄會被最小內容撐開，子項 `max-width` 單獨無效）；flex 子項含長文字時加 `min-width:0`；`select` 設 `max-width:100%`。
  - 檢查：`tests/mobile-layout.test.mjs` 測試 7b、8b；320px 下 `scrollWidth === clientWidth`。
  - 出處：#31、#32、v10.3.1 F2、v10.3.3（製程能力與匯入頁 320px 溢出）。
- **自繪 canvas 的 CSS 尺寸要固定**：依 `getBoundingClientRect` 設 `canvas.width = W*dpr` 時，canvas 必須有 CSS `width`／`height`，否則每次重畫放大 dpr 倍。
  - 檢查：同一頁進出 3 次寬度不變；`tests/mobile-layout.test.mjs` 測試 8a。
  - 出處：v10.3.3 LISA 圖在 dpr 2 下 1200 → 2400 → 4800px。
- **固定白底區塊要固定 token**：列印用的白紙（`.report-preview`）裡的行內 `var(--*)` 會跟著深色主題變深；在該範圍重新宣告明亮 token。圖例文字用一般字色，系列色只放在符號上。
  - 檢查：深色模式下報告頁文字對比 ≥ 4.5；`tests/mobile-layout.test.mjs` 測試 8d、8e。
  - 出處：v10.3.3（深色模式報告判定框對比 1.2）。
- **使用者可見文案只用中文標題、不附英文譯名**：介面、報告預覽、PDF 與匯出標題中，「中文（English）」或「中文 (English)」只保留中文部分。無括號的專名、單位、標準號、檔名保留（例如 Cpk、DFM、SPI、CSV、Johnson、ISO 21747、µm）。不新增「怎麼看」或只重複標題的教學副標；計算結果列、空狀態、錯誤與會改變判讀的警示句保留。
  - 檢查：`tests/ui-copy.test.mjs` 掃描 `spi-spc.html` 禁止 `Executive Summary`、`Closed-Loop Correction`、`<summary>怎麼看</summary>` 等禁用模式。
  - 契約：`docs/spec-ui-copy-rfc.md`。
- **純文字節點嚴禁內嵌 HTML 標籤（Plain Text Integrity Guard）**：指派給 `.textContent` 的所有變數（如 `#ctrlSub.textContent` 管制圖副標、狀態摘要列等），其下游格式化函式與條件警告（`subgroupWarning`、`reason` 等）必須嚴格維持純文字字串，嚴禁包裝 `<span class="...">` 或 `<div ...>` 原始標籤以防 HTML 洩漏至畫面。
  - 檢查：`node --test tests/spi-audit-fixes.test.mjs` 管制圖小樣本副標測試通過。
  - 出處：v10.14.3（2026-11-09，X̄-S 管制圖副標 raw HTML 標籤外露）。

## 驗證

- **驗證避免重複**：安排關卡前先讀 `package.json` 與包裝腳本，確認是否內含相同測試。發布需跑 `npm run release-check` 時，直接以其內含的完整測試滿足 `npm test` 關卡，不先另跑一遍；統計變更所需的 `test:slow`、build 與 UI 驗收仍各自執行。同一份受測內容、相依與環境已有通過證據時，只因相關變更、失敗或具體未解疑慮重跑；commit／push 本身不使結果失效。
  - 已先完成 `npm test` 時：保留其命令、結果與受測版本／工作樹差異證據；內容、相依與環境未使結果失效時，使用 `npm run release-check:scans`。此入口保留全部發布掃描，測試明列 `not-run`，整體為 `SCAN ONLY`（失敗為 `BLOCKED`）；須另附有效測試證據，不把掃描成功當成完整發布通過。
  - 檢查：驗收紀錄列出每個必要關卡由哪次執行滿足；同套測試再次執行時註明失效原因或既有腳本綁定限制。版本、機密掃描與本機測試、遠端 CI 分別報告。
  - 覆蓋範圍：一般測試中的 `[slow]` 案例使用縮小樣本，不能代替 `RUN_SLOW=1` 的完整模擬；build、Worker dry-run、實際 UI 與部署後資料庫路徑各有不同目的，不能互相冒充。聚焦 smoke 可作修正後快速回饋，完整套件已覆蓋且未失效時不另重跑。遠端 CI 的乾淨環境驗證保留，但同一 job 內不安排兩次相同完整套件；遵守實際 required checks。
  - 結果判讀：`release-check` exit 0 仍可能是 `NEEDS REVIEW`，須讀取各項狀態並記錄警告判讀；不得宣稱 `READY`。`BLOCKED` 停止發布。`npm test`／發布掃描通過不代表慢速模擬、UI 矩陣或正式環境已驗證。
  - 出處：2026-11-04 本次 SPI 稽核對話；完整測試 460 項通過耗時約 12.7 分鐘，後續 `release-check` 仍內含同套測試。

- **UI 改動的驗證矩陣**：以 build 產物（非 dev server）在 1440／820／390／320 四種寬度，各跑明亮與深色，涵蓋 14 個分頁、4 個資料子分頁、「更多」選單、設定面板與全部對話框。每頁檢查整頁橫向溢出（以當下的 `clientWidth` 比較）、觸控熱區 ≥ 44px（含包住核取方塊的 label）、文字對比；在 devicePixelRatio > 1 下同一頁至少進出兩次，抓累積狀態的錯誤。
  - 檢查：驗收紀錄列出每個寬度 × 主題的結果；無法模擬的項目（例如 ≥768px 的觸控）標 `NOT TESTED`。
  - 出處：v10.3.1 巡檢只看單次進入、單一 dpr，漏掉 v10.3.3 修正的 LISA 放大、320px 溢出、核取方塊熱區與深色報告對比。
- **重現或驗收使用者回報的問題時，用與使用者相同來源的資料**：同名回合不代表同一份資料。從雲端紀錄重新開啟，或用同一種匯入路徑（受控座標／一般格式）重建；只用範例資料或另一個瀏覽器的本機回合，只能證明那份資料沒問題。
  - 檢查：驗收紀錄寫明資料來源（紀錄 ID 或匯入方式），並附資料特徵比對（有限 x/y 列數、`gridPos` 列數、`componentX` 列數）與使用者環境一致。
  - 出處：2026-10-28 3D 空白（PR #65 用內建瀏覽器本機 `gridPos` 回合驗證；使用者為受控座標回合，x/y 全空）。
- 完成開發不等於完成 iPhone 真機驗收；未實測標記 `NOT TESTED`。

## 測試環境

- **跨行 regex 一律寫 `\r?\n`**：本 repo 在 Windows 以 `core.autocrlf=true` 檢出為 CRLF。CI 使用 `windows-latest`，只接受 `\n` 的斷言會在 CI 失敗。
  - 檢查：`npm test` 在 Windows 本機與 CI 皆通過。
  - 出處：v10.3.2（v10.3.1 新增的版面測試在 Windows 失敗）。
- **SPA 啟動路徑完整性**：修改 `analyze()`、`loadExample()` 或頂層計算邏輯時，不可遺漏區域變數宣告或造成執行期例外；頁面初始化失敗會讓 `<script>` 尾端的 `window.SPI_TEST_HOOK` 沒有掛上，後續測試連鎖失敗。
  - 檢查：先跑 `node --test tests/ui.smoke.test.js`。
  - 出處：步驟 14 除錯紀錄（2026-10-17）。
- **VM 沙箱二進位物件**：`tests/_load.js` 的 `loadCore()` 沙箱需提供 `TextEncoder`、`TextDecoder`、`Uint8Array`、`DataView`、`ArrayBuffer`。
  - 檢查：`tests/step14.test.mjs` 無 `ReferenceError: TextEncoder is not defined`。
  - 出處：步驟 14 M-20 OpenXML 匯出除錯紀錄（2026-10-17）。
- **非同步測試不用固定休眠**：等待 IndexedDB 交易或非同步 DOM 渲染時，用帶逾時的條件輪詢，不用 `await setTimeout(200)` 之類的固定等待。
  - 檢查：測試中等待非同步狀態處皆為條件輪詢。
  - 出處：步驟 6 除錯紀錄（2026-10-17）。
- **build 產物守衛**：`dist/` 只能有 `tools/build-cloudflare.mjs` 允許的檔案，暫存腳本不要放進 `dist/`。
  - 檢查：`npm run build:cloudflare` 不出現 `Unexpected deploy asset`。
- **SPA 多腳本區塊全域變數跨閉包讀取守衛**：在 `<script id="core">`（匯出核心、計算邏輯）存取全域版本或狀態時，不可假定第二個 `<script>` IIFE 閉包內的 `APP` 物件已完成宣告。讀取處必須優先採用安全回退架構（優先讀取 DOM `#appVer` / `#appBuilt`，次之讀取全域 `APP`），確保在 Node.js 沙箱（`_load.js`）與瀏覽器獨立匯出時均能取得正確版本。
  - 檢查：`node --test tests/spi-audit-fixes.test.mjs` issuesMd 匯出與版本更新時間整合測試通過。
  - 出處：v10.14.3（2026-11-09，issuesMd 跨閉包讀取失敗致版本號空白）。

<!-- BEGIN ui-ux-universal (auto-synced; edit C:/Dropbox/AI_Coding_Agent_Governance/Institution/06-ui-ux-universal.md) -->
> UI/UX work: read C:/Dropbox/AI_Coding_Agent_Governance/Institution/06-ui-ux-universal.md.
> Core Git and publication authority: read C:/Dropbox/AI_Coding_Agent_Governance/Institution/00-core-rules.md.
> Auto-deploy applies only to an explicitly authorized project, environment and site after required gates pass.
<!-- END ui-ux-universal -->
