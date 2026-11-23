# 多視窗與深色模式 UI 矩陣（`ui-matrix`）

## 目的
對應 `AGENTS.md`「UI 改動的驗證矩陣」，在 `devicePixelRatio = 2` 下一次掃描全部寬度 × 主題組合，收集所有違規並輸出於 `summary.json`／`summary.md`。

## 涵蓋範圍
- **視窗寬度**：`1440×900`（桌面）、`820×1024`（平板）、`390×844`（手機，`has_touch=True`）、`320×640`（小螢幕手機，`has_touch=True`）。
- **主題**：明亮（`light`）與深色（`dark`），透過介面設定按鈕實際切換。
- **頁面與對話框**：全部 10 個主要分頁、3 個資料子分頁、記錄庫／匯出中心／介面設定對話框，以及行動版底部選單與設定抽屜。

## 檢查項目（跑完全套後統一彙報）
1. **整頁橫向溢出**：`documentElement.scrollWidth <= documentElement.clientWidth`。
2. **dpr=2 重進畫布穩定性**：兩次進入 `control` 與 `deep` 分頁，確認畫布 CSS 寬度不隨 dpr 累積放大。
3. **手機觸控熱區 ≥ 44px**：在 `390`／`320` 粗指標情境檢查可見按鈕、選單、輸入框與核取方塊 `label.row` 高度。
4. **深色模式報告白紙對比 ≥ 4.5**：深色主題下檢查 `#reportPreview` 文字與實際底色的 WCAG 對比度。

預設保留代表性分頁與失敗分頁截圖；需要全部寬度 × 主題 × 分頁 PNG 時可加 `--all-screenshots`。
