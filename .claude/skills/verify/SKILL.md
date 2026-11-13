---
name: verify
description: How to run SPI·SPC 分析台 locally in a real browser and drive a UI change to where it executes (empty state, sample data, import, spec, each tab). Use when verifying a change to spi-spc.html at runtime.
---

# Verify spi-spc.html at runtime

The app is one file, `spi-spc.html`, plus `vendor/`. Production (Cloudflare Worker + D1/R2) needs a login, so verify UI changes locally. Database or Worker changes still need the production read-back in `AGENTS.md`.

## Launch
- Serve the repo root, read-only: `python3 -m http.server 8799 --bind 127.0.0.1` (run in the background), then open `http://127.0.0.1:8799/spi-spc.html`.
- `/api/*` returns 404 locally. The two console 404s are expected.
- Drive Chromium with a node script fed on stdin (`node - <<'EOF' … EOF`, `require('playwright')`), printing measurements to stdout and saving screenshots to the scratchpad. Don't use the Playwright MCP browser tool: it writes `.playwright-mcp/` into the repo.

## Flows
- **Empty start:** opening the page has no runs. Click `#issList [data-load-sample]` (載入範例資料) to load two sample runs; wait about 3 s.
- **Tabs:** `.tab[data-tab="data|issues|overview|control|capability|sim3d|deep|improve|ai|report"]`. Data sub-tabs: `#p-data .subtab` (0 匯入, 1 規格, 2 回合管理).
- **Control charts:** `#selChart` (xbars, xbarr, imr, p, ewma, cusum). Read the live config with `Chart.getChart('cCtrl1')` / `'cCtrl2'`. `cCtrl2` is hidden for P′/EWMA/CUSUM, so a stale config there is not visible to users.
- **Scope:** type a refdes in `#inComp`, press Enter; `#scopeClear` resets. Metric: `#selMetric` (volume, height, hpct, area, offx, offy).
- **Import your own CSV:** add the init script `window.SPI_OFFLINE=true` (the shipped offline mode; no login, memory only). Steps: fill `#pasteIn`, click `#btnRead`, select `#selSide`=TOP, fill `#inPart` and `#inImpStencil`, click `#btnApply`. Then on 規格 click `#btnSpecSave` (套用到本回合); until then the spec gate (`#p-gate`) locks analysis.
- **Phone:** `devices['iPhone 13']`. Analysis settings live in the sheet behind `#btnRailChip`.
- **Dark theme:** set `document.documentElement.dataset.theme='dark'`, then re-render (e.g. change `#selMetric`).

## Gotchas
- Wide-screen settings bar rules start at 1280px; below that the bar wraps to two rows.
- Export dialog: `#btnOpenExportModal`. Each `label.exp-item-main` toggles its checkbox. Use `{trial:true}` on per-item 匯出 buttons, because they download files.
