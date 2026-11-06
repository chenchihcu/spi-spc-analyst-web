# 分析報告預覽

## Sub-features
檢視分析報告，調整章節並核對預覽內容。

## How to get to it (user POV)
桌面從導覽選「分析報告」，手機從「更多」選「分析報告」。在示範回合勾選或取消「執行摘要」。從報告開啟 Email 草稿後，亦可用返回按鈕回到前頁；此入口依賴導覽歷史。

## Driving it with Chrome
執行 `verify.py report`。選 `[data-tab="report"]`，等候 `#reportPreview` 的封面與摘要。取消 `#chkRep2`，確認摘要不再顯示、封面仍在，再勾選並確認摘要回來。

## Gotchas
空回合顯示「尚未載入分析資料」。預覽測試只涵蓋 DOM 章節變更；PDF 下載與實體列印需另外操作並檢查產物。
