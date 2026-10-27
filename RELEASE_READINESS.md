# Release Readiness Report

**Project:** SPI·SPC 分析台
**Version:** v10.3.5
**Date:** 2026-10-27（UTC+8）
**Branch:** `work/single-board-calibration`（合併 main 即自動部署正式站）
**Overall Status:** READY（本機關卡）；正式站驗收於合併後進行

## Summary

修正 v10.3.3 code review 找到的問題偵測問題：單板異常門檻改依板數校準（固定 |z| ≥ 3.5 在板數少時誤報為名目 14–36 倍），嚴重度只看偏移量測項目的超規焊墊，Nelson 規則 1 嚴重需通過族系門檻，互相佐證限同一量測項目，問題頁誤報說明註明涵蓋範圍。

## 前一版正式站驗收（v10.3.4，#60，verified 2026-10-27）

- 登入頁與主頁顯示 v10.3.4。
- 資料庫路徑：登入後 `GET /api/records` → 200（內建瀏覽器既有登入狀態，未輸入密碼）。
- 正式站 1024px 分析設定列四個選單可見（241／137／96／230px）。

## Checks（verified：本次實際執行）

| 關卡 | 指令 | 結果 |
|---|---|---|
| 單元與整合測試 | `npm test`（release-check 內） | 344／344 通過（47 個測試檔） |
| 判定模擬 | `npm run test:slow` | 6／6 通過（seed 1–200）；期望檔 16 個 seed 變動，逐一說明於 CHANGELOG v10.3.5 |
| 單板異常誤報 | `tests/verdict-sim.test.mjs` M-19 | 穩定製程 10／25 板 × 40 seed：命中 ≤ 名目上限（20 seed 量測時 0 / 14,000 次） |
| 校準表 | `node tools/gen-robustz-table.mjs` | 1 億點；holdout 每次誤報為名目 0.98–1.02 倍（α = 4.65e-4） |
| 發布檢查 | `npm run release-check` | `Overall: READY`，八類皆 PASS |
| Cloudflare build | `npm run build:cloudflare` | exit 0；`npx wrangler deploy --dry-run` exit 0 |
| D1 migration | — | 本次無新增 migration |

## Not verified / NOT TESTED

- **使用者實際資料**：code review 時的「60 項（嚴重 31）」來自使用者資料，本機無該資料，校準後的數字需使用者重跑確認。
- **iPhone 真機**：未實測。

## Warnings

- INFERENCE：校準以 i.i.d. 常態板平均模擬；真實資料板間變異若有自相關或厚尾，誤報率仍可能偏離名目值。
- FACT：Nelson 規則的族系門檻 z_FW 仍為常態漸近值；卡片已列出依板數模擬的誤報率。
- FACT：主頁與登入頁的「更新」時間仍於提交時寫入，未於 build 時自動注入（06-ui-ux-universal §9），另案處理。
