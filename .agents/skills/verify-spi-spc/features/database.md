# 資料庫瀏覽

## Sub-features
瀏覽量測紀錄、座標與料號規格，從資料庫選擇器搜尋或重新整理。首輪使用空白 D1；帶資料重新開啟分析須另有合適的量測紀錄。

## How to get to it (user POV)
桌面選「資料與規格 → 資料庫」。選擇器入口包含頁首資料庫按鈕、啟動橫幅、手機「更多」內的資料庫按鈕、匯入頁的座標選擇，以及頁首量測與座標狀態按鈕。`#stateSpi` 在回合有未匹配位號時開啟位號清單；`#statePlace` 與 `#btnSelectPlace` 預選座標檔。

## Driving it with Chrome
執行 `verify.py database`。選可見的 `[data-tab="data"]` 和 `button[data-sub="records"]`，在 `#recCard` 點 `#recReload`。比對該操作的 GET 回應、`#recSpiSub` 的筆數與 `#recSpi` 的「尚無量測紀錄」。從頁首 `#btnOpenRecModal` 開啟 `#recPickerModal`，點 `#recPickerReload` 再查一次。橫幅為 `#btnBannerLoadDb`，手機為 `#mBtnOpenRecModal`，座標入口為 `#btnSelectPlace`。

## Gotchas
分頁可讀快取。分頁與選擇器的重新整理各應產生兩個新的 GET 請求，分別為 `kind=spi` 與 `kind=place`。空庫兩者都應回 200、`records=[]`、`next=null`，並與畫面零筆相符。手機入口以 390px Chrome 視窗驗證。未匹配位號及重開既有紀錄需另備資料。
