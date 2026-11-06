# 管制圖

## Sub-features
查看每板平均及離散管制圖、中心線摘要和 Nelson 規則。

## How to get to it (user POV)
在預設示範回合，從分析導覽選「管制圖」。手機可從底部管制圖入口進入。焊墊熱圖、進階能力散點圖、焊墊 Cpk 圖也可點選單一焊墊，開啟該焊墊的 I–MR；此路徑另驗。

## Driving it with Chrome
執行 `verify.py control`。選可見的 `[data-tab="control"]`，等待 `#p-control`、`#cCtrl1` 與 `#ctrlSub`。核對圖名、CL 數值與 `#nelsonTbl`，保留畫面。

## Gotchas
資料及規格決定可用圖型和統計量。僅憑 canvas 存在不能證明有資料；畫面驗證的範圍是目前選取的回合與圖型。
