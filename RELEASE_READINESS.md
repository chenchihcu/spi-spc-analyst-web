# Release Readiness Report

**Project:** SPI·SPC 分析台
**Version:** v10.3.3
**Date:** 2026-10-27（UTC+8）
**Branch:** `work/final-release-debug`（未合併；合併 main 即自動部署正式站）
**Overall Status:** READY（本機關卡）；正式站驗收待合併後進行

## Summary

最終發布前於 Windows 本機重跑全部關卡，並以 build 產物逐頁巡檢 UI。巡檢發現 6 項缺陷，皆已修正並補回歸測試；修正後全部關卡再跑一次通過。

## Checks（verified：本次實際執行）

| 關卡 | 指令 | 結果 |
|---|---|---|
| 單元與整合測試 | `npm test` | 335／335 通過（修正前基線 334／334） |
| 判定模擬 | `npm run test:slow` | 修正前基線 5／5 通過（seed 1–200）；本次修正未改偵測邏輯，修正後未重跑 |
| 發布檢查 | `npm run release-check` | `Overall: READY`，八類（version、changelog、debug、docs、deps、tests、secrets、a11y）皆 PASS |
| Cloudflare build | `npm run build:cloudflare` | exit 0，產物僅 `index.html`、`vendor/`、`_headers` |
| Worker 設定 | `npx wrangler deploy --dry-run` | exit 0 |
| D1 migration | — | 本次無新增 migration，合併不需先套用 |

## UI 巡檢（verified：內建瀏覽器，本次 build 產物）

範圍：14 個分頁、4 個資料子分頁、「更多」選單、設定面板、6 個對話框（共 25 個畫面）× 寬度 1440／820／390／320 × 明亮／深色。每頁檢查整頁橫向溢出、元素超出畫面、觸控熱區 ≥ 44px（390／320 觸控模擬）、文字對比 ≥ 3。

| 缺陷 | 修正 | 證據 |
|---|---|---|
| LISA 圖每次進入進階分析頁放大 dpr 倍（1200 → 2400 → 4800px） | 畫布固定 CSS 尺寸 | 進出 3 次維持 405px；測試 8a |
| 320px 製程能力頁、匯入頁橫向溢出 29–59px | `.panel`／`.vendor` 欄寬 `minmax(0,1fr)`、`select{max-width:100%}` | 320px 無溢出；測試 8b |
| 深色模式報告判定框對比 1.2 | 報告紙張範圍固定明亮 token | 深色截圖可讀；測試 8d |
| 3D 剖面圖例文字對比 2.1–2.5 | 文字用一般字色，系列色只在符號 | 測試 8e |
| 核取方塊 label 觸控熱區 30px | `label.row:has(>input[type=checkbox])` 44px | 390／320 無 < 44px；測試 8c |
| 稽核紀錄指紋顯示 `undefined…`（2026-10-25 正式唯讀驗收 not pass） | 缺值顯示「舊紀錄未記錄」 | `tests/part-spec-ui.test.mjs` |

修正後 4 寬度 × 2 主題全數無溢出、無熱區不足、無低對比文字。剩餘標記為 3D 剖面圖例的線條符號（非文字，需與圖上線色一致），接受。

## Not verified / NOT TESTED

- **820px 觸控**：內建瀏覽器只在 < 768px 模擬觸控；820 僅測滑鼠模式，觸控規則由靜態 CSS 測試涵蓋。
- **對話框內容**：以移除 `hidden` 檢查版面，未填入實際資料流程。
- **稽核指紋欄畫面**：本機無缺指紋的稽核資料，僅以 jsdom 測試驗證輸出。
- **iPhone 真機**：未實測。
- **正式站**：合併後需依 `AGENTS.md`「部署驗證要走過資料庫路徑」確認登入後資料庫頁；正式站瀏覽器原檔下載與重新載入分析仍未核對（沿用 2026-10-25 驗收紀錄的 not verified）。
- **CI**：runner 改為 `windows-latest`，首次結果以本 PR 的 GitHub Actions 為準。

## Warnings

- INFERENCE：問題偵測門檻以模擬資料校正（v10.2.2、v10.2.3 已改小樣本校準與置換檢定）；真實試產資料雜訊結構不同時，誤報率可能偏離名目值。
- FACT：新紀錄只寫入 Cloudflare D1＋R2，未登入時建立紀錄直接拒絕；既有本機 IndexedDB 舊資料只供查閱。
