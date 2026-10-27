# SPI·SPC 分析台 — 專案規則（正本）

本檔是本專案規則的單一正本。`CLAUDE.md` 與 `GEMINI.md` 以匯入方式讀取本檔，不另存副本。
iPhone／行動版 Web UI/UX 標準見 `APPLE_IPHONE_WEB_UI_UX_STANDARD.md`（`GEMINI.md` 入口）。

## 發布與部署

- **合併到 main 就是發布**：main 合併後約 30 秒自動部署正式 Worker。PR 若新增 `cloudflare/migrations/*`，合併前先執行 `npx wrangler d1 migrations list spi-spc --remote`；未套用時先備份（放在 repo 外，release-check 的機密掃描會擋下 repo 內的備份）、在本機副本演練、經使用者核准套用，再合併。
  - 檢查：合併前遠端 migration 清單回報 `No migrations to apply`。
  - 出處：2026-10-24 v10.3.0／v10.3.1 缺 `0007` 導致登入後 503，正式站回退 v10.2.3。
- **部署驗證要走過資料庫路徑**：登入頁顯示新版本只代表靜態資產已更新。至少確認一個登入後的資料庫畫面或 API 回 200；無法登入時回報「資料庫路徑未驗證」，不可寫成部署成功。
  - 檢查：驗收紀錄寫明走過的頁面或 API 與 HTTP 狀態。
  - 出處：同上事故；當時只看登入頁版本即回報成功。
- **合併失敗先自行修復再重試，不等使用者要求**：已核准合併的 PR，`gh pr merge` 失敗時先讀錯誤輸出，依下列分類修正，再重跑本 PR 原本通過的關卡（`npm test`、`npm run release-check`、CI）。全部通過就仍在原核准範圍內，直接重試合併，不需要再問。
  - 與 main 衝突（`gh pr view --json mergeStateStatus` 為 `DIRTY`）：在工作分支 `git merge origin/main`。版本檔（`package.json`、`package-lock.json`、`lib/version.mjs`、`spi-spc.html` 的 `#appVer`、`CHANGELOG.md`；`#appBuilt` 固定為預設值，由 build 注入）先採 main 的內容，再把本 PR 的版本改成 main 版本的下一號，保留本 PR 的 CHANGELOG 條目；`npm test` 通過後 push，再合併。
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

## 統計與問題偵測

- **新增或修改偵測規則時，以穩定製程模擬量測誤報率**：用 i.i.d. 資料、在實際群組大小（焊墊群組常只有 30–100 個）下量測每點誤報，需接近名目值。不可使用只在大樣本成立的漸近門檻（χ²、常態近似標準誤），也不可拿同一份資料推估規格再算 Cpk。
  - 檢查：`npm run test:slow` 通過；更新 `tests/verdict-sim-expected.json` 時逐 seed 說明變動原因。
  - 出處：v9.2.0、v9.13.2（1784 項中 1716 張自我參照 Cpk 誤報）、v10.2.0、v10.2.2（FastMCD χ² 小樣本誤報 25–50 倍）、v10.2.3（Moran's I 標準誤低估約 1.5 倍）。
- **效能重構須結果逐位元相同**：只替換實作（迴圈、緩衝、快取），不改公式、門檻與加總順序。萬筆以上資料避免在巢狀迴圈中建立中間陣列（`.map().filter().reduce()`），改用單趟累加或預先索引；Bootstrap／Monte Carlo 前先過顯著性門檻，非必要時延遲計算。
  - 檢查：`tests/golden.test.mjs`、`npm run test:slow` 不變；`node --test tests/core.test.js` 與 `node tools/bench-large.mjs` 下 5 萬筆級 `analyze`、`detectIssues` 各 **<3 秒**（硬門檻）；本機優化目標 **<1 秒**。
  - 出處：v9.13.0、`docs/spec-perf-large-dataset-rfc.md`、步驟 6 效能除錯紀錄（2026-10-17）。

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

## 驗證

- **UI 改動的驗證矩陣**：以 build 產物（非 dev server）在 1440／820／390／320 四種寬度，各跑明亮與深色，涵蓋 14 個分頁、4 個資料子分頁、「更多」選單、設定面板與全部對話框。每頁檢查整頁橫向溢出（以當下的 `clientWidth` 比較）、觸控熱區 ≥ 44px（含包住核取方塊的 label）、文字對比；在 devicePixelRatio > 1 下同一頁至少進出兩次，抓累積狀態的錯誤。
  - 檢查：驗收紀錄列出每個寬度 × 主題的結果；無法模擬的項目（例如 ≥768px 的觸控）標 `NOT TESTED`。
  - 出處：v10.3.1 巡檢只看單次進入、單一 dpr，漏掉 v10.3.3 修正的 LISA 放大、320px 溢出、核取方塊熱區與深色報告對比。
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

<!-- BEGIN ui-ux-universal (auto-synced; edit C:/Dropbox/AI_Coding_Agent_Governance/Institution/06-ui-ux-universal.md) -->
> UI/UX work: read C:/Dropbox/AI_Coding_Agent_Governance/Institution/06-ui-ux-universal.md.
> Core Git and publication authority: read C:/Dropbox/AI_Coding_Agent_Governance/Institution/00-core-rules.md.
> Auto-deploy applies only to an explicitly authorized project, environment and site after required gates pass.
<!-- END ui-ux-universal -->
