# 分析範圍連動（`scope`）

## 目的
驗證「全部元件 → 元件群組 → 單一元件 → 清除範圍」跨分頁狀態一致性。

## 步驟與驗收條件
1. 在問題偵測頁透過 `#selGroup` 選取非空元件群組，確認 `#scopeBar` 顯示且 `#scopeText` 包含群組名稱。
2. 若 `#compField` 可見，透過 `#inComp` 與 `#compList` 選取單一元件，確認 `#scopeText` 更新。
3. 切換至 `control`、`capability`、`report` 分頁，確認 `#scopeBar` 持續顯示不遺失。
4. 點擊 `#scopeClear` 清除範圍，確認 `#scopeBar` 隱藏。
