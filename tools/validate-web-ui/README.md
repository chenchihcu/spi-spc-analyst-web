# validate-web-ui runner (vendored)

正本：`~/.agents/skills/validate-web-ui/scripts/`（規格 2026-11-27-03）。

本目錄讓 CI 與本機在無 skill 路徑時仍可執行 `npm run verify:ui`。**放在 `tools/` 而非 `vendor/`**，避免觸發 `.ui-gate.json` 的 `vendor/**` watch。變更 skill 腳本時請同步此處兩檔：

- `scripts/ui-gate.mjs`
- `scripts/gate-browser.mjs`