# 3D 焊墊位置

## Sub-features
切換板號並讀取 3D 場景、HUD 與座標來源警示。

## How to get to it (user POV)
桌面選「3D 錫膏模擬」，手機選「更多 → 3D 錫膏模擬」。具板號的問題卡也可選「看該板 3D」。需要受控座標時，先由資料庫重開原紀錄或走同種受控匯入。

## Driving it with Chrome
執行 `verify.py sim3d`。進入 `[data-tab="sim3d"]`，從 `#selBoard` 改選另一板，核對所選板號、`#view3d` 中的 canvas 與 `#hud`。另以純網格資料確認 `#grid3dWarn` 和 HUD 的示意警語。受控資料核對輸入檔的實際 x/y、元件中心與網格列數及圖上位置。

## Gotchas
內建範例只證明範例場景。空白 D1 缺少受控紀錄；缺 WebGL、缺第二板、缺受控或純網格資料，各自記錄失敗的前提。
