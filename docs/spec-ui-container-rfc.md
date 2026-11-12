# RFC：分析頁容器歸位與空殼移除

**文件編號**：RFC-SPI-UI-CONTAINER-20261112  
**狀態**：已實作（v10.18.5）  
**範圍**：[`spi-spc.html`](../spi-spc.html) 靜態殼的區塊歸屬。不含統計、API、D1、hash 路由與文案。

## 1. Problem Statement & Goals

**Problem**：HTML5 解析後，`.wrap`（`max-width:1280px`）在問題頁就被多出來的 `</div>` 關掉。總覽到郵件各頁、以及頁籤列以下的內容，變成 `body` 的直接子節點，頁籤仍在 1280px 欄內、下方內容滿版。另外，`div[data-sub=runs]` 被包在 `div[data-sub=settings]` 裡；`setSub` 隱藏規格容器時，回合表跟著不可見。現有測試只讀 `#runTbl` 的文字，發現不了。

**Goals**

- `#p-overview` 到 `#p-mail` 的父節點是 `.wrap`。對話框與底部導覽仍在 `.wrap` 外。
- `[data-sub=runs]` 與匯入、規格並列，父節點是 `#p-data`。切到回合管理後 `#runTbl` 的 `offsetParent` 不為 null。
- 多變量區沒有空的 `.grid2`。問題地圖不再套一層 `.card`。`.iss-top` 不再多包一層匿名 `div`。

**Non-goals**

- 不改公式、門檻、`/api`、D1、hash 路由。
- 不刪 3D 近似說明、虛擬網格警示、匯入後果句、柏拉圖處數說明。
- 不改按鈕文案或匯出項目說明。
- 不拆匯入頁整張卡、`.deep-body`、匯出中心群組框、AI 設定裡的內層表面，也不合併記錄庫的桌面表與手機卡。

## 2. System Architecture

靜態殼由瀏覽器依 HTML5 規則組樹，不經額外元件。`.wrap` 只負責寬度；`.issues-subviews`、`.control-subviews`、`.improve-subviews` 負責子視圖顯示；`.report-preview-wrap`、`.tbl`、`.chartbox` 負責捲動或畫布尺寸，保留。

`setSub` 對 `#p-data [data-sub]` 設定 `hidden`。子頁必須是 `#p-data` 的直接子節點，不能互相包住。

## 3. Data Model & Interfaces

沒有新的資料實體或 API。DOM 契約：

- `.wrap` 包住頁首、設定列、頁籤，以及 `#p-issues` 到 `#p-mail`。
- `#p-data` 的三個內容區是 `[data-sub=import|settings|runs]`，彼此為兄弟。
- `#pmap` 的父節點是 `#pmapDetails`，不是 `.card`。
- `#p-control [data-control-sub=multi]` 底下沒有 `.grid2`。

## 4. Security, Performance & Rollout

沒有新的權限或資料外洩路徑。DOM 變淺，不改計算。沒有 feature flag：這是結構修正，隨版本一起出。回退是還原這次的標籤，不需要資料遷移。

## 5. 驗收

- jsdom 檢查上一節的父節點。
- 開啟資料頁並點回合管理後，`#runTbl.offsetParent` 不為 null（祖先 `hidden` 則為 null）。
- `node --test tests/ui.smoke.test.js tests/records-ui.test.mjs tests/severity-clarity.test.mjs tests/mobile-layout.test.mjs`。
- build 產物上，總覽與資料頁的頁籤與內容同在 1280px 欄內；320px 無整頁橫向溢出。雲端登入路徑不在本次範圍。
