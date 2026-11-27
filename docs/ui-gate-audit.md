# Web UI 驗收稽核（validate-web-ui × SPI·SPC）

## 現況（稽核摘要）

| 層級 | 機制 | 涵蓋 | 缺口 |
| --- | --- | --- | --- |
| 單元／結構 | `tests/mobile-layout.test.mjs`、`tests/ui-copy.test.mjs`、`tests/type-scale.test.mjs` 等 | CSS 字串、viewport meta、44px 規則、對比 token | 無真實 Chromium；不檢 L1–L8 幾何、無 `pageerror`／網路 |
| jsdom 冒煙 | `tests/ui.smoke.test.js`、各 `layout-*.test.mjs` | 全分頁 `SPI_TEST_HOOK` 流程 | 非 build 產物、無 Worker／登入真實路徑 |
| 本機 E2E | `.agents/skills/verify-spi-spc`（Python + Playwright） | 隔離 D1、登入、`ui-matrix` 多寬度／深色 | 未掛 PR hook；與 `git push` 無綁定 |
| **UI gate（新增）** | `node $G/ui-gate.mjs` + `.ui-gate.json` | G0–G6：fresh build、隔離 Worker、G2 runtime、G3 版面、G5 流程 | G4 baseline 待核准；主應用頁截圖仍以流程末端狀態為主 |

## 優化決策

1. **隔離 Worker 與 verify 對齊**：`tools/ui-gate-stage.mjs` 複用 verify 的 stage／`prepare` 模式（臨時帳密、本地 D1 migration），避免污染開發者 `.dev.vars`。
2. **watch 範圍收窄**：僅 `spi-spc.html`、`vendor/**`、`lib/auth-handler.mjs`，版面與登入頁變更才觸發 gate，不把全 repo 算進 tree hash。
3. **額外 viewport**：在 gate 預設 390／768／1280 之外加入 `320`、`852`（與 AGENTS／duo RFC 對齊）。
4. **流程取代 hook 冒煙（第一階段）**：`tests/flows/login.flow.spec.mjs`、`app-tabs.flow.spec.mjs` 以真實 `#loginForm` 與底欄分頁操作，補 jsdom 無法覆蓋的 G2／G3。
5. **G4 策略**：登入頁 baseline 需使用者明示核准後 `--init-baseline`；變更視覺前須 `--lock-intent`。

## 操作入口

```bash
npm install
npm run verify:ui              # 完整 gate（含 G4 baseline）
npm run verify:ui:core         # G0–G3 + G5（略過 G4，迭代用）
node /path/to/skills/validate-web-ui/scripts/ui-gate.mjs --repo . --check --json
```

Gate 腳本正本：`~/.agents/skills/validate-web-ui/scripts/ui-gate.mjs`（雲端：`/cursor/stores/user/skills/validate-web-ui/scripts/ui-gate.mjs`）。

## 與既有 AGENTS 驗證矩陣的關係

- **不取代** `verify-spi-spc full`／14 分頁 × 亮暗手動矩陣；UI gate 是 PR 前輕量真瀏覽器閘門。
- **互補** `mobile-layout`：gate G3 在 Chromium 量測橫向捲動與觸控尺寸；jsdom 測試仍保留快速回歸。
- 發布到 Cloudflare 仍以 AGENTS「部署驗證要走過資料庫路徑」為準。

## 待辦（需人決策）

- [ ] 使用者核准後執行 `--init-baseline` 建立 `tests/ui-baseline/login.*.png`
- [ ] 是否將 `.ui-gate/result.json` 納入 release-check（建議：watch 有變更時 CLI 提示 `npm run verify:ui`）
- [ ] 第二階段：更多 `tests/flows/*.flow.spec.mjs` 對應 AC 與 14 分頁（可逐步從 verify journeys 移植）
- [ ] **duo-landscape（852×393）**：目前登入後 `#appVer` 未出現，flow 以 `test.skip` 標記；需對照 `docs/spec-iphone-duo-rfc.md` 補專用 flow 或修登入橫向版面

## 驗收紀錄（2026-11-27 台北時間）

`npm run verify:ui:core` → G0–G3、G5 **PASS**（約 23 s；6 viewport 中 duo-landscape flow 為 intentional skip）。報告：`.ui-gate/report/2026-11-27T05-36-02-943Z/`。