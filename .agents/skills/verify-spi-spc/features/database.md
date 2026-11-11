# 資料庫瀏覽

## Sub-features
瀏覽量測紀錄、座標與料號規格，從資料庫選擇器搜尋或重新整理。首輪使用空白 D1；帶資料重新開啟分析須另有合適的量測紀錄。

## How to get to it (user POV)
記錄庫在頁首「記錄庫」、手機「更多」與匯入頁「從資料庫選取」。量測膠囊與座標膠囊只顯示狀態；沒有未對位號時點它們不開記錄庫。`#stateSpi` 僅在回合有未對位號時開啟位號清單。座標分頁由 `#btnSelectPlace` 打開。

## Driving it with Chrome
執行 `verify.py database`。從頁首 `#btnOpenRecModal` 開啟 `#recPickerModal`，點 `#recPickerReload`。空庫通知含「量測紀錄 0 筆」與「座標檔 0 筆」，並各產生 `kind=spi` 與 `kind=place` 的 GET。`#stateSpi` 為 `aria-disabled`，`#statePlace` 為 `role=status`；點擊後 `#recPickerModal` 仍隱藏。匯入頁 `#btnSelectPlace` 開座標分頁。手機為 `#mBtnOpenRecModal`。

## Gotchas
選擇器重新整理應產生兩個新的 GET，分別為 `kind=spi` 與 `kind=place`。空庫兩者都應回 200、`records=[]`、`next=null`，並與「0 筆」相符。手機入口以 390px Chrome 視窗驗證。未對位號清單及重開既有紀錄需另備資料。
