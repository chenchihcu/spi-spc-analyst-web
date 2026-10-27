# 上市前驗收摘要 001（2026-10-27）— 去識別

**候選 SHA：** `f85a5c4d32f68bf57e7127c662930a6b07064991` · v10.3.10  
**工作分支：** `work/pre-release-debug-001`  
**完整 trace／截圖：** repo 外 `spi-spc-release-evidence\001-20261027\`

## 關卡狀態

| 關卡 | 標記 |
|------|------|
| UI smoke、release-check（354 測試）、test:slow、core 5 萬筆 &lt;3 s、bench-large | **verified** |
| build:cloudflare + wrangler dry-run（staging／prod 配置） | **verified** |
| mobile-layout jsdom；build 產物 Playwright 1440／820 × 亮／暗（14 分頁無橫向溢出） | **verified** |
| build 產物 390／320 自動巡檢「&lt;44px」 | **not pass**（量測原生 input；`label.row` 觸控規則已存在，待 coarse 媒體巡檢） |
| Staging 部署 Version `ddc402be-…`；登入頁 v10.3.10 | **verified** |
| Staging UAT 寫入／D1 對帳 | **blocked**（無授權登入憑證） |
| 正式站登入後 DB 路徑 | **not verified** |
| iPhone 真機 | **NOT TESTED** |

## 本 PR 程式變更

- `AGENTS.md`：5 萬筆效能檢查句與 `core.test.js`／`bench-large` 對齊（3 s 硬門檻、1 s 優化目標）。

## 合併核准

**不具備**完整上市驗收完成宣告；具備「文件門檻同步 + 候選版自動關卡通過 + staging 靜態部署讀回」之合併討論條件。合併後須另做登入後驗證與 UAT 對帳。
