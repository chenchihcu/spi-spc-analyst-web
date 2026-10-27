# Release Readiness Report

**Project:** SPI·SPC 分析台
**Version:** v10.3.4
**Date:** 2026-10-27（UTC+8）
**Branch:** `work/desktop-rail-fix`（合併 main 即自動部署正式站）
**Overall Status:** READY（本機關卡）；正式站驗收於合併後記錄在下一版

## Summary

修正 v10.3.3 code review 找到的介面問題：桌機與平板看不到分析設定列（v9.11.0 起）、未定義的 CSS 變數讓錯誤提示失去紅色、階梯鋼板區域表的選取單選鈕觸控熱區 24px，以及會遮蔽快取未命中的效能測試寫法。偵測邏輯未改動（單板異常誤報校準在下一版處理）。

## 前一版狀態

- v10.3.3（#57）已合併並自動部署；正式站登入頁顯示 v10.3.3（code review 時以 curl 確認）。
- 登入後的資料庫路徑：repo 內沒有 v10.3.3 的驗收紀錄，屬**未驗證**。
- main CI：#58 因計時測試失敗；#59 改計時方式後通過。

## Checks（verified：本次實際執行）

| 關卡 | 指令 | 結果 |
|---|---|---|
| 單元與整合測試 | `npm test` | 336／336 通過（基線 335） |
| 判定模擬 | `npm run test:slow` | 未跑：本版未改偵測邏輯 |
| 發布檢查 | `npm run release-check` | `Overall: READY`，八類皆 PASS |
| Cloudflare build | `npm run build:cloudflare` | exit 0，產物僅 `index.html`、`vendor/`、`_headers` |
| Worker 設定 | `npx wrangler deploy --dry-run` | exit 0 |
| D1 migration | — | 本次無新增 migration |

## UI 巡檢（verified：內建瀏覽器，本次 build 產物，devicePixelRatio 2）

範圍：14 個分頁 × 2 次進出 + 4 個資料子分頁、「更多」選單／底部 sheet、分析設定（桌機 rail／手機 sheet）、5 個資料庫對話框。檢查整頁橫向溢出、元素超出畫面、觸控熱區 ≥ 44px（390／320 觸控模擬）、文字對比 ≥ 3。

| 寬度 | 明亮 | 深色 | 分析設定列 |
|---|---|---|---|
| 1440 | 無溢出、無低對比文字 | 同左 | 四個選單寬 241／137／96／230px |
| 1024 | 無溢出（僅明亮） | NOT TESTED | 同上；手機開關 sheet 後放大到 1024 仍顯示 |
| 820 | 無溢出、無低對比文字 | 同左 | 同上，分兩行 |
| 390 | 無溢出、熱區皆 ≥ 44px | 同左 | 收合為設定鈕；開啟為 flex、焦點在關閉鈕；關閉後隱藏 |
| 320 | 同 390 | 同左 | 同 390 |

| 缺陷 | 修正 | 證據 |
|---|---|---|
| 桌機／平板分析設定列寬度 0 | `.rail-sheet-modal,.rail-sheet-modal[hidden]{display:contents!important}` | 上表；測試 9a |
| 錯誤提示、階梯「⚠️ 0」不顯示紅色（`var(--bad)` 等未定義） | 改用既有 token | 收件人錯誤提示顏色 = `--ng`（#B83A2C）；測試 9b |
| 階梯區域選取單選鈕觸控熱區 24px | 包進 `label.row`（觸控 44×44） | 390 下 44×45，點色塊可選取；測試 9c |

剩餘標記：3D 剖面圖例的線條符號「──」「---」（非文字，需與圖上線色一致），沿用 v10.3.3 判定接受。

## Not verified / NOT TESTED

- **820px 觸控**：內建瀏覽器只在 < 768px 模擬觸控；820 僅測滑鼠模式。
- **對話框內容**：以移除 `hidden` 檢查版面，未填入實際資料流程。
- **iPhone 真機**：未實測。
- **正式站**：合併後確認登入頁版本；登入後資料庫路徑需登入，無登入狀態時標記未驗證。

## Warnings

- FACT：單板異常的 |z| ≥ 3.5 門檻在板數少時誤報偏高（i.i.d. 模擬：20 板約名目 14 倍、10 板約 36 倍），問題偵測頁「預期約 N 次誤報」低估；下一版改為依板數校準。
- FACT：主頁與登入頁的「更新」時間仍於提交時寫入，未於 build 時自動注入（06-ui-ux-universal §9），另案處理。
- FACT：新紀錄只寫入 Cloudflare D1＋R2，未登入時建立紀錄直接拒絕；既有本機 IndexedDB 舊資料只供查閱。
