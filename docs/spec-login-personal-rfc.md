# Feature Spec: 登入頁改版 — SPI·SPC 專屬識別＋回訪使用者個人化

## Context
現行登入頁（`lib/auth-handler.mjs` `loginPage()`，第 120–232 行；送出邏輯 `vendor/login-auth.js`）是通用雙欄版型：Mitcorp 商標、標題、8×6 靜態焊墊格（一顆紅色不良）、一句口號、通用帳密表單。使用者希望它「更個人化、更像 SPI·SPC 應用」。已確認範圍＝**兩者都做**：(1) 更強的 SPI·SPC 領域識別視覺；(2) 在本裝置記住回訪使用者（問候＋預填帳號＋「不是你？」切換）。不改伺服器驗證流程。

## 1. Summary
工程師打開登入頁時，看到的是一張「檢測中的鋼板／焊墊圖＋迷你管制圖」的 SPI·SPC 畫面，而不是通用登入框；在自己的裝置上回訪時，頁面以帳號問候並已填好帳號，只需輸入密碼。成功條件：回訪使用者少一個輸入欄位；畫面一眼可辨識為 SPI·SPC 工具；所有既有登入、安全、行動版與字級測試仍通過。

## 2. Scope
**In scope**
- 品牌區視覺改版：焊墊圖加上「掃描線」檢測動畫＋迷你 X̄ 管制圖（UCL／CL／LCL＋一點越界，標紅對應不良焊墊）。純 inline SVG/CSS，無新相依、無外部資源。
- 回訪使用者：登入成功後在 `localStorage` 記住帳號（僅 email），下次顯示「歡迎回來」＋帳號＋「不是你？」；密碼欄成為主要輸入。
- 「記住此裝置上的帳號」核取方塊（預設勾選），取消勾選則不存、並清除既有記錄。
- 登入頁沿用主程式已存的主題偏好 `spi-theme`（同源 localStorage），避免登入頁明亮、進站後變深色的跳動。
- 刪除口號式靜態文案（依 AGENTS.md 文案規則）。

**Out of scope**
- 任何伺服器端驗證、cookie、PBKDF2、限流、錯誤碼的變更（`handle()`、`deriveD` 不動）。
- 從伺服器取得顯示名稱／頭像／上次登入時間（需新 API）。`[ASSUMPTION]` 名稱僅由 email 本地部分推得。
- 記住密碼、自動登入、SSO、忘記密碼流程。
- 主程式 `spi-spc.html` 的任何改動。
- 多帳號切換清單（只記一個帳號）。

## 3. User Stories
- 身為產線／品保工程師，我在自己的裝置回訪時，希望帳號已填好並看到問候，以便只輸入密碼就進站。
- 身為使用共用電腦的人，我希望能不讓裝置記住我的帳號，或一鍵清除記錄，以免下一位使用者看到我的 email。
- 身為第一次使用者，我希望登入頁一眼就看得出是 SPI 錫膏檢測／SPC 統計工具。

## 4. Functional Requirements
- **FR-1.** 品牌區顯示焊墊圖，含一條沿焊墊格掃過的檢測線動畫；`prefers-reduced-motion: reduce` 時無動畫。
- **FR-2.** 品牌區顯示迷你管制圖：中心線、上下管制線、約 12 個資料點，其中一點越過 UCL 以不良色標示；與焊墊圖的不良焊墊同色。圖為裝飾（`aria-hidden`）。
- **FR-3.** 登入成功（`/__login` 回 `ok`）且「記住」已勾選時，將正規化帳號（trim＋小寫）存入 `localStorage["spi-last-user"]`。
- **FR-4.** 頁面載入時若 `spi-last-user` 存在且為合法 email 格式，顯示問候區「歡迎回來」＋帳號、帳號欄預填該值。
- **FR-5.** 「不是你？」按鈕清除 `spi-last-user`、清空帳號欄、隱藏問候區、顯示一般帳號欄，並將焦點移到帳號欄。
- **FR-6.** 「記住此裝置上的帳號」預設勾選；未勾選時登入成功會刪除 `spi-last-user`。
- **FR-7.** 密碼永不寫入任何儲存（localStorage／sessionStorage／cookie／URL）。
- **FR-8.** 頁面載入時讀取 `localStorage["spi-theme"]`，值為 `dark` 時設 `data-theme="dark"`；其他值或讀取失敗維持 HTML 預設 `light`。
- **FR-9.** 刪除口號句「從數千顆焊墊的統計資料中，把異常抓出來」與其圖例；副標「錫膏印刷檢測 · 統計製程問題偵測」保留（說明產品範圍）。

## 5. Acceptance Criteria
### FR-1
- **Given** 一般動態設定 **When** 載入登入頁 **Then** 掃描線在焊墊圖上週期移動。
- **Given** `prefers-reduced-motion: reduce` **When** 載入 **Then** 掃描線靜止（無 animation）。
### FR-2
- **Given** 明亮與深色主題 **When** 載入 **Then** 管制圖越界點與不良焊墊為同一 `--paste-bad` 色，螢幕閱讀器讀不到該圖。
### FR-3 / FR-6
- **Given** 「記住」勾選 **When** 以 `Alice@X.com` 登入成功 **Then** `spi-last-user` 為 `alice@x.com`。
- **Given** 「記住」勾選 **When** 登入失敗（帳密錯、429、503） **Then** `spi-last-user` 不變。
- **Given** 已存在 `spi-last-user` 且「記住」未勾選 **When** 登入成功 **Then** `spi-last-user` 被刪除。
### FR-4
- **Given** `spi-last-user=alice@x.com` **When** 載入 **Then** 顯示「歡迎回來」與 `alice@x.com`，帳號欄值為 `alice@x.com`。
- **Given** 無記錄 **When** 載入 **Then** 不顯示問候區，畫面與首次使用相同。
- **Given** `spi-last-user` 內容不是 email（例如 `<script>`） **When** 載入 **Then** 不顯示問候、刪除該值，且內容不以 HTML 插入（只用 `textContent`）。
### FR-5
- **Given** 問候區顯示中 **When** 按「不是你？」 **Then** 記錄被刪除、帳號欄為空且取得焦點、問候區隱藏。
### FR-7
- **Given** 任一次登入嘗試 **When** 檢查 localStorage／sessionStorage／document.cookie（非 HttpOnly 部分）與 URL **Then** 找不到密碼或 `d`。
### FR-8
- **Given** `spi-theme=dark` **When** 載入 **Then** `<html data-theme="dark">` 且無先亮後暗閃爍（腳本放在 `<head>` 尾端）。
- **Given** localStorage 被封鎖（無痕／例外） **When** 載入 **Then** 頁面正常、明亮主題、無問候、可正常登入。

## 6. Edge Cases and Failure Modes
- **Case:** localStorage 拋例外（Safari 無痕、站台資料封鎖）。**Behavior:** 所有讀寫包 `try/catch`；當作無記錄；「記住」核取方塊仍顯示但無作用，登入流程不受影響。
- **Case:** 記住的帳號已被停用。**Behavior:** 與一般帳密錯誤相同訊息；記錄保留，使用者可按「不是你？」。
- **Case:** 很長的 email。**Behavior:** 問候區帳號 `overflow-wrap:anywhere`，320px 寬不造成整頁橫向溢出。
- **Case:** 限流設定缺失（`limiterMissing`）。**Behavior:** 既有橫幅與停用送出鈕維持不變，問候區照常顯示。
- **Case:** 瀏覽器自動填入另一帳號。**Behavior:** 不強制覆蓋使用者手動輸入；預填只在載入時一次。
- **Case:** 手機寬度 ≤720px。**Behavior:** 品牌區仍 ≤160px 高；管制圖在窄版隱藏，只留縮小焊墊圖＋掃描線。

## 7. Non-Functional Requirements
- **Security & privacy.** 只存 email；不存密碼或衍生值；使用者可關閉與清除。CSP 不變（inline script/style 已允許，`lib/security-headers.mjs`）。無外部請求。
- **Performance.** 不新增網路請求或字型；HTML 增量 < 6 KB；動畫只用 `transform`。
- **Accessibility.** WCAG 2.1 AA：文字對比 ≥ 4.5（兩種主題）；「不是你？」、核取方塊含 label 觸控熱區 ≥ 44px；裝飾圖 `aria-hidden`；問候區不搶 `autofocus`（行動鍵盤遮擋規則）。
- **Compatibility.** 沿用現有 token、字級 token（`--fs-*`）、只用 400/700 字重；1440／820／390／320 四寬度 × 明亮／深色無橫向溢出。
- **文案.** 只用中文，不附英文譯名；不新增教學副標。

## 8. Dependencies
- 主程式 `spi-theme` 的值域（`dark`/`light`，`spi-spc.html:13112`）。已就緒。
- 無外部系統。

## 9. Risks and Mitigations
- **Risk:** 共用電腦洩露上一位使用者的 email。**Mitigation:** 「記住」可取消＋「不是你？」一鍵清除；`[OPEN_QUESTION]` 預設是否應改為不勾選。
- **Risk:** 既有正則測試綁定 CSS 字串（`.brand{…max-height:160px}`、`--fs-*`、`.toggle`、`.submit` 字重）。**Mitigation:** 保留這些規則字串；改版後先跑 `tests/mobile-layout.test.mjs`、`tests/type-scale.test.mjs`、`tests/auth*.test.mjs`、`tests/build-info.test.mjs`。

## 10. Open Questions
- `[OPEN_QUESTION]` 「記住此裝置上的帳號」預設勾選（便利）或不勾選（共用產線電腦較安全）？本規格預設勾選。
- `[OPEN_QUESTION]` 問候是否要顯示 email 本地部分（例「歡迎回來，alice」）而非完整 email？本規格顯示完整 email，避免名稱推斷錯誤。

## 11. Success Metrics
- **Leading:** 回訪登入只需一個輸入欄位；`spi-last-user` 在成功登入後存在（本機驗證）。
- **Lagging:** 使用者回饋登入頁「像這套工具」；無與記住帳號相關的隱私抱怨。

---

## Implementation plan（核准後執行）
**檔案**
- `lib/auth-handler.mjs` — `padArt()` 與 `loginPage()` 的 HTML/CSS/inline script：
  - 新增 `chartArt()` 產生迷你管制圖 SVG（固定點位，`currentColor`／token 配色）。
  - `.art` 外層加 `.scan` 偽元素／span，`@keyframes scan` 只動 `transform`；加入 reduced-motion 規則。
  - `<head>` 尾端小段 inline script 讀 `spi-theme`（FR-8）。
  - 表單：問候區 `<div id="who" hidden>`（`歡迎回來`＋`<span id="whoUser">`＋`<button type="button" id="notMe">不是你？</button>`），核取方塊 `<label class="remember"><input type="checkbox" id="remember" checked>記住此裝置上的帳號</label>`；移除口號 `.legend`。
  - 保留：`--fs-*`、`--logo-ink`、`.toggle` 44px、`input` 字級、`.submit` 700、手機 `.brand{…max-height:160px…}`、safe-area、無 `autofocus`。
- `vendor/login-auth.js` — 在 `resp.ok && res.ok` 分支、`location.replace` 前依 `#remember` 寫入或刪除 `spi-last-user`（try/catch）。`deriveD` 與 POST 內容不變。
- 版本檔依專案慣例遞增（`package.json`、`package-lock.json`、`lib/version.mjs`、`spi-spc.html #appVer`、`CHANGELOG.md`）。
- 新測試 `tests/login-personal.test.mjs`：靜態 HTML 斷言（管制圖存在且 `aria-hidden`、reduced-motion 規則、核取方塊與「不是你？」存在、口號已刪、沒有任何寫入 `pass`／`d` 到 storage 的程式碼）；以 jsdom 驅動 FR-4／FR-5／FR-8 與非 email 記錄清除。

**Verification**
1. `node --test tests/login-personal.test.mjs tests/mobile-layout.test.mjs tests/type-scale.test.mjs tests/auth.test.mjs tests/auth-lock.test.mjs tests/build-info.test.mjs tests/cloudflare.test.mjs tests/ui-copy.test.mjs`。
2. Playwright 以 `loginPage()` 輸出的 HTML（含 stub `/__login` 回 `{ok:true}`）在 1440／820／390／320 × 明亮／深色截圖：無橫向溢出、觸控熱區 ≥44px、對比 ≥4.5；驗證回訪流程（登入→重載→問候→不是你？）。
3. 完整 `npm test` 由 `release-check` 一次滿足；正式站驗收依 AGENTS.md（未授權推送前標 NOT DEPLOYED）。
