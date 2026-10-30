# RFC-SPI-UI-UX-ALL-PAGES-20261029：分析台全分頁 UI/UX 與無障礙系統性優化規格書

**文件編號**：RFC-SPI-UI-UX-ALL-PAGES-20261029  
**版本**：v1.4
**日期**：2026-10-30
**狀態**：草案 (Draft / For Review)  
**作者**：Antigravity Agent  
**審查對象**：前端維護者、QE／SPC 使用者代表、SMT 製程工程師  

---

## 1. 問題陳述與目標 (Problem Statement & Goals)

### 1.1 背景、審核範圍與證據
本版將原 v1.0 的全站缺口清單視為待重驗項目，不再把未附逐項現況證據的表格、ARIA、色碼或圖示敘述當成已確認缺陷。本次聚焦量測資產生命週期與 `#issues` 的可操作性，目標是改善現有專案的辨識、選取與判讀流程。

- **FACT**：唯讀檢視本機 `spi-spc.html`、`docs/rfc-controlled-coordinate-import.md`、`docs/spec-part-spec-rfc.md`，並以瀏覽器檢視正式站資料與規格、資料庫、記錄選取及問題偵測畫面。正式站頁面標示 v10.11.2；此標籤不證明目前 Worker 與本機原始碼的位元或提交一致。
- **FACT**：正式站檢視僅瀏覽畫面，未上傳、載入、修改、刪除或寫入任何紀錄；沒有用真實業務資料內容作為文件例子。
- **INFERENCE**：欄位與狀態雖已存在，資料分散於匯入／規格、資料庫與選取視窗；若標籤與關聯來源未在操作當下集中呈現，使用者仍需自行比對料號、版次、面別、單位及狀態。
- **VERIFY**：本次未執行完整視口／主題／鍵盤／輔助技術巡檢，亦未取得瀏覽器效能 trace；版面缺陷及 LCP／CLS／INP 數值均未驗證。

本 RFC 以 **FACT**（可由目前程式／規格或本次唯讀畫面確認）、**INFERENCE**（依現有結構推導的使用風險）、**PROPOSAL**（建議改善）和 **VERIFY**（需進一步取證）區分證據強度。除本次列出的資料與問題偵測範圍外，表格其他分頁的 v1.0 清單仍須逐項對照現行程式與 build 才能作為實作缺口。

### 1.2 目標 (Goals)
1. 讓座標檔、量測紀錄及料號規格在上傳、選取、載入、檢索與版本管理各步驟中清楚呈現其身份、狀態及來源。
2. 減少匯入、資料庫與選取視窗之間的來回比對，降低同料號不同版次／面別／單位的誤選風險。
3. 保留現行資料正確性、權限、稽核與 fail-closed 契約；介面不得把待覆核紀錄當成有效分析資料，也不得讓使用者誤以為新預設規格就是歷史量測原始規格。
4. 提供可執行的後續視覺、鍵盤、行動版及效能驗收條件；本次僅完成文件審核，不代表相關實作或驗收已通過。

### 1.3 非目標 (Non-goals)
- 不變更任何統計演算法、Nelson 判異規則、Cpk 計算或偵測門檻。
- 不新增或修改 Cloudflare D1 migrations 與資料庫 schema（維持 0007 正本）。
- 不破壞登入驗證、Fail-Closed 機制與 Cloudflare R2 物件讀寫邏輯。
- 不引入外部肥大前端框架（如 React/Vue/Tailwind），維持單檔 SPA 架構。

---

## 2. 系統架構與各分頁優化清單

### 2.1 主分頁與子頁對照與優化清單

> 本表為 v1.0 全站待審項目索引。除本次列明的 `#p-issues`、`#p-data` 與選取視窗外，其餘分頁項目未在本次逐項驗證，請先取證再決定是否實作。

| 分頁 ID | 中文名稱 | UI/UX 改善項目 | 驗收依據 |
|---|---|---|---|
| `#p-issues` | 問題偵測 | 保留既有嚴重度／面向篩選、問題地圖、證據卡與分批顯示；評估問題地圖預設密度及行動版篩選順序，見 §2.3 | §2.3；視口與觸控驗收 |
| `#p-overview` | 總覽 | 為 `#cSumCtrl` 與 `#cSumPareto` 補全 `role="img"` 與 `aria-label` | IOS-11 |
| `#p-control` | 管制圖 | `<table id="nelsonTbl">` 包裹 `.tbl-wrap`；畫布補齊 `role="img"` 與 `aria-label` | IOS-03, IOS-11 |
| `#p-capability` | 製程能力 | `<table id="capGrpTbl">` 包裹 `.tbl-wrap`；直方圖/QQ/盒鬚畫布補齊 `role="img"` 與 `aria-label` | IOS-03, IOS-11 |
| `#p-sim3d` | 3D 錫膏模擬 | 移除 `#0d1117` 寫死背景，改用 Token；`chkGhost`、`chkBridgeWarn` 補齊 `aria-label`；`<table id="boardDefTbl">` 包裹 `.tbl-wrap` | IOS-03, IOS-11, IOS-15 |
| `#p-cross` | 交叉驗證 | `<table id="xvTbl">` 包裹 `.tbl-wrap`；3 個畫布補齊 `role="img"` 與 `aria-label` | IOS-03, IOS-11 |
| `#p-adv` | 進階分析 | 移除 5 處寫死 hex 顏色（`#ef4444`, `#3b82f6` 等）；5 個表格全部包裹 `.tbl-wrap`；8 個畫布補齊 `role="img"` 與 `aria-label` | IOS-03, IOS-11, IOS-15 |
| `#p-stats` | 統計資料 | `<table id="statsTbl">` 與 `<table id="matrixTbl">` 包裹 `.tbl-wrap` | IOS-03 |
| `#p-compare` | 試產比較 | `<table id="cmpTbl">` 包裹 `.tbl-wrap`；2 個畫布補齊 `role="img"` 與 `aria-label` | IOS-03, IOS-11 |
| `#p-dfm` | DFM 建議 | `<table id="dfmTbl">` 與 `<table id="dfmPads">` 包裹 `.tbl-wrap`；`#cDfmRisk` 補齊 `aria-label` | IOS-03, IOS-11 |
| `#p-lab` | 實驗驗證 | 為 `aoiFile` 與 `grrFile` 添加顯式 `aria-label`；`#cLab` 補齊 `role="img"` 與 `aria-label` | IOS-11 |
| `#p-ai` | AI 分析 | 補齊 `aiAnon` 之 `aria-label`；收斂按鈕 Focus Ring 與窄螢幕間距適配 | IOS-04, IOS-11 |
| `#p-report` | 分析報告 | 匯出章節核取方塊 `chkRep1`~`chkRep10` 建立顯式 `for` 關聯與 `aria-label`；響應式網格間距優化 | IOS-04, IOS-11 |
| `#p-gate` | 放行閘門 | 提升引導按鈕之對比度與觸控熱區 (>= 44px) | IOS-04, IOS-12 |
| `#p-data` | 資料與規格 | 流程、來源、生命週期與搜尋範圍的可辨識度改善；不假定現有表格、標籤或狀態功能缺失，見 §2.2 | §2.2；資料生命週期驗收 |
| `#p-share` | 建立分享 | 確保分享按鈕在行動端具備足夠觸控邊距與清晰狀態回饋 | IOS-04 |
| `#p-shares` | 我的分享 | `<table id="mySharesTbl">` 包裹 `.tbl-wrap` | IOS-03 |
| `#p-mail` | 轉寄報告 | 郵件章節核取方塊 `chkMailRep1`~`chkMailRep10` 補齊 `for` 關聯；受控座標上傳 `upPlaceFile` 補齊 `aria-label` | IOS-04, IOS-11 |
| 模態對話框 | 記錄選取中樞等 | 對齊資料庫與選取視窗的搜尋範圍說明；明確分辨選取歷史檔與登錄新座標檔，並說明不可用狀態原因，見 §2.2 | §2.2；鍵盤焦點與局部捲動驗收 |

### 2.2 量測資產生命週期審核（2026-10-30）

#### 現況證據

本節程式證據見 [`spi-spc.html`](../spi-spc.html) 的資料與規格、`#recCard`、`#recPickerModal`、`renderRecords()` 與 `openRecord()`；業務契約依 [受控座標匯入規格](rfc-controlled-coordinate-import.md) 及 [料號規格規格書](spec-part-spec-rfc.md) 核對。

- **FACT — 匯入與規格**：資料與規格頁已有匯入欄位、格式／欄位對應、預覽與資料中繼資料流程；同頁另有規格草稿、建立不可變版本、捨棄草稿、版本清單與設定預設版本操作。這些是現有能力，不列為待補功能。
- **FACT — 座標檔**：受控座標註冊與歷史座標選取已存在；座標識別涉及料號、使用者明確輸入的正式版次、面別及單位。版次不可依檔名或上傳次序猜測；原始 CSV 與伺服器驗證狀態依受控匯入規格管理。
- **FACT — 選取與資料庫**：記錄庫有量測紀錄與座標檔分頁；選取視窗也有對應分頁及篩選。兩處搜尋提示文字對可搜尋欄位的描述不一致，而實際搜尋會匹配提示未列全的欄位，容易造成使用者對搜尋範圍的錯誤預期。
- **FACT — 狀態與權限**：現有紀錄已區分有效、待覆核、已被取代、舊資料／不可用等狀態；待覆核量測不應作為正式分析輸入，座標選取要求有效且經伺服器驗證。資料庫也已有依角色顯示的管理操作、規格版本與稽核資訊。
- **FACT — 歷史座標脈絡**：重開量測紀錄會驗證原始檔指紋，並使用該筆紀錄當時引用的座標；沒有原座標關聯時不套用目前選取座標，避免位置與分群改變。此行為須保留。
- **FACT — 版面實作**：資料庫在手機和桌面有各自的呈現方式；本次瀏覽只檢視桌面畫面，手機呈現與鍵盤、螢幕閱讀器行為未作視覺驗收。
- **VERIFY — 規格歷史引用**：`spec-part-spec-rfc.md` 描述開啟資料庫量測時可套用目前預設規格；本次無法從只讀畫面確認每筆雲端量測是否持久保存當時的規格版本 ID／雜湊快照。實作前須核對此資料契約，不能把「目前預設」標成「原量測規格」，也不能靜默替歷史資料改寫原始規格脈絡。

#### 推論與優先改善建議

1. **P1 — 載入前集中呈現身份與來源（PROPOSAL）**：在確認載入／分析前提供一份可掃讀的來源摘要：批號、料號、正式版次、面別、量測時間／工單、原始檔名與指紋、座標檔識別及狀態、規格來源及版本。將「歷史快照／引用」和「目前預設」明確分開；缺少原座標或版本資訊時說明限制，不以目前資料補猜。待覆核紀錄應維持不能進入有效分析的狀態，並顯示原因。
2. **P1 — 梳理匯入的漸進式步驟（PROPOSAL）**：將現有欄位與預覽排成「檔案／格式 → 欄位對應 → 料號與正式版次／面別／單位 → 座標關聯 → 必填中繼資料 → 驗證摘要」的清楚順序；每一步標明必填、選填、未完成或驗證失敗。保留現行正式版次、登入／權限及受控檔案要求，不以簡化 UI 為由放寬規則。
3. **P1 — 統一搜尋語意（FACT + PROPOSAL）**：記錄庫及選取視窗以一致的篩選範圍標籤、搜尋提示和清除篩選操作，或各自清楚列出只支援的欄位；篩選結果應讓目前的料號、面別、狀態及查詢條件可見。不得藉由改標籤改變後端搜尋或權限。
4. **P2 — 讓資料與規格狀態一眼可辨（PROPOSAL）**：沿用現有功能，以一致的狀態文字／標記呈現草稿、已存版本、目前預設、有效、待覆核、已封存及舊資料；在規格版本列表中顯示版本識別及預設狀態，並讓上傳新檔、選取歷史檔與管理檔案的操作名稱互不混淆。
5. **P2 — 完成小螢幕與輔助技術驗收（VERIFY）**：使用 build 產物檢查資料表格的局部捲動、手機卡片內容完整性、選取視窗焦點返回、Tab 順序、狀態文字可讀性與 44px 觸控熱區。這些是後續驗收條件，非本次已通過項目。
6. **P2 — 沿用產品視覺語彙（PROPOSAL）**：以適合資料密集型分析台的層級與篩選方式改善掃讀，沿用現有 CSS tokens、明亮主題基準與繁中／CJK 字體；不引入不相干的入口網站版型、新配色或外部字型。

#### 本段驗收條件

- 從新檔上傳、受控座標關聯、預覽、驗證到分析，使用者能在每一步辨認必要欄位及錯誤，且不能繞過現行權限和 fail-closed 規則。
- 從資料庫選取與重開歷史紀錄，介面呈現原始檔指紋、當時座標引用及規格來源；座標、規格或生命週期資訊缺漏時顯示未驗證／不可用原因，不靜默套用最新預設。
- 搜尋提示涵蓋實際可查欄位；不同資料類型的篩選不互相誤導，並可辨認目前篩選狀態。
- 規格草稿、已存版本與預設狀態清楚可辨；已存在的版本、稽核、角色與封存功能不重複造作。

### 2.3 問題偵測頁及目前專案建議（2026-10-30）

#### 現況證據

本次頁面觀察為[正式站問題偵測頁](https://spi-spc-analyst.chihfu-chen-tw.workers.dev/#issues)唯讀檢視；呈現邏輯可對照 [`spi-spc.html`](../spi-spc.html) 的 `#p-issues`、`renderIssues()` 與 `renderPmap()`。

- **FACT — 正式站唯讀畫面**：問題偵測頁提供問題總數與嚴重度摘要、板／元件群組問題地圖、嚴重度和面向篩選、展開／收合證據卡、逐批顯示，以及 Markdown／CSV／XLSX 匯出。畫面標示 v10.11.2；正式站版本標籤與本機程式碼的精確對應未驗證。
- **FACT — 修正前水平溢出重現**：在正式站 v10.11.2 的 `#issues` 頁，以唯讀瀏覽器設定視口後量測到以下整頁寬度。`clientWidth` 與 `innerWidth` 相差為瀏覽器垂直捲軸保留的寬度；四個視口皆是 `documentElement.scrollWidth > clientWidth`。

  | 視口 `innerWidth` | 文件 `clientWidth` | 文件 `scrollWidth` | 結果 |
  |---:|---:|---:|---|
  | 1440 | 1425 | 1481 | NOT PASS：超出 56 px |
  | 820 | 805 | 1433 | NOT PASS：超出 628 px |
  | 390 | 375 | 425 | NOT PASS：超出 50 px |
  | 320 | 305 | 337 | NOT PASS：超出 32 px |

- **FACT — 問題地圖尺寸證據**：1440／820 視口的元件群組格分別是 `1312/1166`、`1312/643`（scrollWidth/clientWidth）；390／320 視口的板號格分別是 `384/293`、`296/223`。原正式站頁面因此同時有桌機／平板群組列溢出及手機板號列溢出。
- **FACT — 修正候選**：本機提交 `641ef27`（PR [#88](https://github.com/chenchihcu/spi-spc-analyst-web/pull/88)）為桌機／平板元件群組格加入依容器寬度換行；窄螢幕板號格明確改為逐列排列，元件群組仍保留容器內橫向捲動。正式站未部署此提交，修正後的瀏覽器尺寸矩陣仍未驗證。
- **INFERENCE — 造成溢出的 CSS**：元件群組使用預設 `grid-auto-flow:column`，大量群組會產生超出容器的隱式欄；手機板號格設定了自動填滿欄數，卻沿用欄流向而非列流向。來源 CSS 和上述元素尺寸吻合；尚待在候選 build 的瀏覽器矩陣確認修正後沒有其他溢出來源。
- **FACT — 本機呈現邏輯**：問題卡已分開呈現事實、推論及建議動作，並支援佐證關聯與前往對應分析頁；清單採分批顯示，問題地圖關聯查詢有快取。不可將這些現有能力列為功能缺失。
- **FACT — 效能證據範圍**：本次未使用瀏覽器效能 trace 或重現互動基準，亦未量測 LCP／CLS／INP；效能指標為 **not verified**。現有分批呈現與快取屬程式可見的實作，不代表已證明端到端效能達標。

#### 推論與改善建議

1. **P1 — 先讓使用者聚焦，再展開地圖（INFERENCE + PROPOSAL）**：目前頁面同時承載摘要、板／群組地圖和大量問題卡；資料量增加時，地圖可能擠壓首屏可見的篩選與高優先問題。建議提供可收合的精簡地圖摘要，將嚴重度／面向篩選和目前顯示筆數放在列表附近，讓地圖保留為鑽取工具而不阻擋主要任務。現有篩選保留，不另造重複篩選。
2. **P1 — 問題地圖寬度修正驗收（FACT + PROPOSAL）**：修正前正式站在四種視口都已重現整頁橫向溢出。驗收 PR #88 的候選 build：元件群組格在桌機／平板依容器寬度換行；手機板號列不撐開頁面、群組列只在自身容器橫向捲動；整頁 `scrollWidth` 必須不大於 `clientWidth`。確認前狀態為 **not verified**，不得將正式站描述為已修復。
3. **P2 — 窄螢幕局部操作（VERIFY + PROPOSAL）**：在候選 build 驗收問題地圖是否可在容器內捲動或分組收合，避免大量板／群組按鈕撐寬整頁；另核對篩選選取與卡片展開狀態可用鍵盤辨認。完整視口與鍵盤結果仍為 **not verified**。
4. **P2 — 效能量測後再優化（VERIFY）**：以代表性問題數量記錄首屏、篩選、展開與再顯示的瀏覽器 trace，確認實際瓶頸後再提出程式調整。不可只依清單項目多或程式碼外觀推估效能問題，不得捏造 CWV 數值。

此節是針對目前專案畫面的下一步建議，不改變問題偵測演算法、嚴重度定義、稽核、匯出或既有鑽取契約。

---

## 3. 後續實作驗收矩陣與測試規範

RFC 的 UI/UX 審核本身未修改程式；後續問題地圖修正另由 PR #88 提出。收斂階段測試與 build 結果記於 §3.2。以下均是候選 build 的驗收條件，不代表介面視覺或效能驗收已通過。

1. **流程及資料完整性**：覆蓋受控座標註冊、量測檔預覽與欄位對應、資料庫搜尋、歷史紀錄選取與載入、規格草稿及預設版本。驗證有效座標、待覆核限制、角色權限、原始檔指紋、歷史座標引用、稽核軌跡及 D1／R2 fail-closed 契約維持不變；規格歷史快照欄位須先完成 §2.2 的 VERIFY。
2. **視口與主題**：在 1440／820／390／320 CSS px，明亮與深色主題檢查資料匯入、規格表單、資料庫表格／卡片、選取視窗、版本視窗及問題偵測頁；確認整頁不橫向溢出，資料表格只在必要容器內捲動，窄版地圖不撐開頁面。
3. **鍵盤與觸控**：核對可見焦點、Tab 順序、選取／關閉對話框後的焦點返回、狀態與錯誤的輔助技術可讀性，以及觸控熱區至少 44px。未測的觸控裝置或螢幕閱讀器組合逐項標示 NOT TESTED；iPhone 真機驗收需另行執行。
4. **回歸與發布檢查**：UI 實作後執行當前 repo 的 `npm test`、相關 mobile-layout／ui-copy／smoke 測試及 `node tools/release-check.js`；測試數量以執行當時輸出為準，不沿用本 RFC 舊版的「420 項」數字。
5. **效能**：以真實 build 和代表性資料擷取載入、篩選、開啟證據卡及分批顯示 trace；報告 LCP／CLS／INP 需附量測工具、環境、視口和重現步驟。本次沒有此類數據，狀態為 **not verified**。

### 3.1 本次自我審查

- **已校正現況**：規格草稿／版本、資料生命週期、權限、待覆核限制、歷史座標引用、問題篩選／證據／匯出／分批顯示均記為既有能力；建議聚焦一致性、辨識度與流程呈現。
- **避免未證實結論**：未把 v1.0 的全站表格、ARIA、Token 或 Emoji 清單直接當作目前缺口；未由效能實作推論出 LCP／CLS／INP 數值或已達標。
- **明確待確認項目**：Worker 部署來源與本機程式碼身份；正式站小螢幕／深色模式／鍵盤視覺；每筆量測是否保存不可變的原始規格版本引用；瀏覽器效能 trace。
- **範圍核對**：提案只涉及 UI/UX 與驗收呈現，不修改統計規則、資料契約、權限、API、schema、資料或正式環境；既有規格文件若與歷史規格載入行為有歧異，須先核對契約再實作。

### 3.2 收斂階段驗證紀錄（2026-10-30）

- **VERIFIED — 原 `work/review84-followup` 工作樹 `npm test`**：434 項通過、0 項失敗，執行時間約 656 秒。
- **VERIFIED — 原工作樹 `npm run build:cloudflare`**：完成，產生 Cloudflare 靜態資產。
- **NOT PASS — 原工作樹 `npm run release-check`**：exit code 1；內嵌測試回報 28 項失敗，並列出兩處 console 輸出警告。
- **VERIFIED — 隔離 `work/ui-ux-rfc` 工作樹 `npm run release-check`**：exit code 0；55 個測試檔、433 項通過；沒有 `[FAIL]`，但整體摘要是 `NEEDS REVIEW`，因 debug 掃描發現兩處 console 輸出。
- **VERIFIED — 隔離工作樹 `npm run build:cloudflare`**：完成，產生 Cloudflare 靜態資產。
- **INFERENCE / UNKNOWN — 測試差異**：乾淨 RFC 分支 gate 通過，原工作樹的 28 項失敗較可能與工作樹內容或執行環境差異有關；未逐項重現及定位，不能定為根因。原工作樹驗證期間也出現額外的 `tests/step7.test.mjs` 修改，來源未確認，未修改或提交。
- **依賴條件**：隔離工作樹的 `package.json` 與 `package-lock.json` 雜湊與原工作樹一致；為避免網路安裝，本次測試共用原工作樹的 `node_modules` junction。完全獨立安裝的重現結果仍未驗證。
- **PR 驗收限制**：本次交付只包含此 RFC；PR 建立後須檢視當前 head、CI、審查要求及 merge state，再決定是否達到可合併條件。未取得明確核准前不合併。
- **仍為 NOT VERIFIED**：視口／主題／鍵盤／觸控矩陣、LCP／CLS／INP、正式站部署來源身份，以及每筆量測是否持久保存原始料號規格版本引用。

### 3.3 資料匯入與檔案管理實作驗收（2026-10-30）

- **VERIFIED — 流程與來源呈現**：資料頁新增五個編號步驟，顯示完成、待補與失敗狀態；欄位錯誤摘要可將焦點移至待修欄位。解析錯誤、必填料號／版次、無有效受控座標及缺少量測數值欄位皆有狀態提示。紀錄來源顯示檔名及完整 SHA-256；沒有持久化歷史規格快照的紀錄標為未知，不以目前預設值補上。
- **VERIFIED — 測試情境**：`npm test` 共 438 項通過，涵蓋成功保存及回讀、欄位對應與必填錯誤、受控座標要求、搜尋、非管理者上傳回 403、原始檔指紋不符、座標檔缺失，以及歷史規格來源未知。測試使用本機 DOM／API harness，未連接 Production D1／R2。
- **VERIFIED — PR #90 build 版面矩陣**：候選來源以 b67746e7ab8d8d471260e4ba900106663c520618 為基礎，包含本次 mapBox 欄寬及紀錄選取焦點修正，v10.12.2；Cloudflare build 成功，HTML 960,179 bytes，建置時間 2026-10-30 16:11:05（UTC+8）。以 localhost:8774 的 build 產物在 1440／820／390／320 CSS px，各跑明亮／深色、14 主分頁與 4 資料子分頁，每個寬度 36 狀態，共 144 狀態（含一般 CSV 解析後的來源摘要與欄位預覽），等待版面更新完成後均符合 documentElement.scrollWidth === clientWidth。這只證明本機版面，不代表雲端路徑。
- **VERIFIED — 錯誤回饋**：一般 CSV（board,pad,volume；B1,P1,100）缺少必填中繼資料時，焦點移至 impValidationSummary，inPart／inRev／inWorkOrder／inMeasuredDate 標記 aria-invalid；按摘要定位按鈕後焦點移到 inPart。320px 更多選單可開啟，設定面板寬度為 305px（等於當下 clientWidth）；已解析匯入區原本因隱式 auto grid 欄撐寬至約 350px；改為 minmax(0,1fr) 並允許子項收縮後，320px 下 mapBox 欄寬 223px，包含設定開啟狀態的 scrollWidth／clientWidth 均為 305px。新增 mobile-layout 回歸測試，13/13 通過。紀錄選取視窗開啟後聚焦 recPickerQ，關閉後返回 mtabMore；桌面開啟／關閉與 Escape 的 DOM 回歸測試通過。
- **VERIFIED — 本次文字對比抽查**：匯入步驟、來源摘要與欄位錯誤各主題 27 個可見項目，明亮最低 5.30、深色最低 5.72，均 ≥4.5；不代表全站對比驗收。
- **NOT TESTED — 其餘 UI 閘門**：本次 Chrome 與可用 IAB 均為 DPR 1，未完成 DPR > 1 重複進出；完整對話框、全站鍵盤與文字對比、pointer:coarse 觸控、iPhone 真機及螢幕閱讀器仍待驗收。不得把 144 頁面溢出檢查視為完整 UI 閘門通過。
- **VERIFIED — 先前完整關卡**：同步 main 後 release-check 55 個測試檔共 439 項通過、exit 0，整體 NEEDS REVIEW（2 處既有 console 警告）；test:slow 7/7 為先前相同統計邏輯的執行證據。最新來源摘要修正的 record-proof-ui／ui-copy 聚焦測試 6/6 通過。v10.12.2 在 mapBox 修正後的完整 release-check exit 0、440 項通過，整體 NEEDS REVIEW（2 處既有 console 輸出）；該執行未包含稍後加入的焦點回歸測試，焦點修正後另跑 step7／mobile-layout 子系統測試共 22/22 通過，0 失敗。
- **NOT VERIFIED — 發布與正式路徑**：本紀錄只涵蓋本機 build 與模擬測試。PR 尚未合併，Cloudflare Production 未部署本次 commit；正式 Worker 版本、登入後資料庫 API／畫面 HTTP 200、資料保存與下載均待核准合併後驗證。LCP／CLS／INP 未量測。

### 3.4 待排驗證清單

此清單保留原 RFC／PR #88 收斂時的驗證狀態；§3.3 是另一份資料匯入候選 build 的執行紀錄，不能直接取代本清單所要求的正式來源與實機證據。

以下項目承接 §2.2／§2.3 的 `VERIFY`，並記錄本次候選修正後尚未取得的證據。完成一項前不得將其狀態改成通過；唯讀檢查不可改動正式資料。

| ID | 優先序／項目 | 狀態 | 完成所需證據與下一步 |
|---|---|---|---|
| V-01 | P1：問題偵測頁修正後整頁溢出 | **not verified** | 以 PR #88 候選 build 在 1440／820／390／320 CSS px 重跑問題頁；確認每個視口 `documentElement.scrollWidth === clientWidth`，地圖群組／板號列的局部捲動符合設計。 |
| V-02 | P1：完整視口、主題與資產／規格介面 | **not verified** | 以候選 build 在 1440／820／390／320 CSS px 和明亮／深色模式檢查資料匯入、座標／量測選取、資料庫列表、規格表單及版本視窗；逐項記錄溢出、截斷、局部捲動與狀態可辨識結果。此前 320 px 量測曾逾時；本次正式站重現成功不等於全矩陣已通過。 |
| V-03 | P1：鍵盤、焦點、觸控與輔助技術 | **not verified** | 以鍵盤走訪主要表單、篩選、地圖格、選取視窗及規格版本視窗；驗證 Tab 順序、可見焦點、關閉後焦點返回、錯誤／選取狀態的可讀性和至少 44px 觸控熱區。螢幕閱讀器及 iPhone 真機結果須標明實際裝置／組合。 |
| V-04 | P1：歷史量測的規格版本引用 | **本機契約 verified；staging not verified** | Worker/UI 已新增 snapshot 建立與載入驗證。Node 22 的規格契約、UI 與隔離測試 17/17 通過；安裝缺依賴已解除。仍須 staging 寫入讀回、D1/R2 關聯與清除後稽核證據，不能把本機測試當作雲端持久化驗收。 |
| V-05 | P1：正式 Worker 部署來源身份 | **not verified** | Cloudflare Git repository/environment/branch 曾唯讀核對為 production/main；仍需部署後核對 Worker version ID、部署狀態、提交 SHA 對應與登入後資料庫路徑。正式發布已獲使用者明確要求，但須等本計畫所有必要 gate 通過才可推送觸發。 |
| V-06 | P2：LCP／CLS／INP 瀏覽器 trace | **not verified** | 使用 Chrome DevTools／Lighthouse 等實際 trace 工具，在候選 build 以代表性資料重現初次載入、篩選、展開問題卡及再顯示；附工具版本、瀏覽器、視口、資料規模與 trace，記錄量測值，不估算指標。 |
| V-07 | P2：獨立安裝與 release-check 差異根因 | **not verified** | 建立不共用 `node_modules` junction 的乾淨 worktree，依鎖檔執行 `npm ci`、`npm test` 和 `npm run release-check`；再於保留原始變更的環境重現曾出現的 28 項失敗，列出失敗測試並比對 Node／依賴／工作樹差異。當前 bugfix 分支 434 項測試通過、release-check exit 0 但為 `NEEDS REVIEW`（2 處診斷 console 輸出），不能單獨解釋另一工作樹的 28 項失敗。 |

#### 3.4 自我審查

- 各項都標成 **not verified**，除非已有本次直接證據；正式站修正前溢出數據與候選 build 修正狀態分開記錄。
- 沒有推估 LCP／CLS／INP，也沒有把 `NEEDS REVIEW` 說成 release-check 全面通過。
- 歷史規格引用、部署身份與視覺驗收保持唯讀／候選 build 的範圍；未授權的正式站部署和資料寫入不列為本次步驟。
- PR #88 的候選修正只處理問題地圖呈現，不改問題偵測演算法、量測資料、API 或資料庫 schema。

### 3.5 量測規格歷史引用候選實作與自我審查（2026-10-30，歷史執行紀錄）

#### 候選變更

- 本輪追加確認：歷史紀錄缺少鋼板厚度時，prefillImpThk 仍曾讀取目前預設厚度，可能改變高度百分比換算；已取消此路徑並加入匯入身份比對，避免非同步舊回覆污染新匯入。歷史快照套用訊息也已移除「預設」誤稱。
- 本輪 Node 24 窄驗證：spec-history-isolation 與 records 合計 17/17 通過、候選 build 成功、4 段 inline script 解析成功。這些只證明快照讀取與厚度預填的隔離行為，不能取代完整 Worker/UI 或 staging 驗收。
- Worker 只接受量測建立請求中的規格版本 ID；伺服器讀取並驗證已存規格的類型、料號、版次、原始檔大小／SHA-256 與標準化內容，再把 immutable snapshot 寫入既有 records.meta，沒有新增 endpoint 或 schema migration。
- 新紀錄未選已存規格時標記為未指定；打開有快照的量測讀取當時版本；缺少快照的舊紀錄不查目前預設，維持分析鎖定，待使用者明確選版後標示「本次分析選用」。
- 重複量測命中舊紀錄時改讀取該紀錄的既有規格來源，不保留匯入當下的現行預設作為替代規格。

#### 自我審查

- 後續 RCA：recordView 未還原 meta.stencil，已以窄測試重現 undefined 與已存 88 µm 不符，修正映射後通過。Node 22 規格 UI 長流程與快照隔離合計 5/5 通過；golden 受影響案例在明確選版後 13/13 通過（同次規格 UI 舊斷言失敗已由後續測試修正）。Node 22 build 與 staging Wrangler dry-run 均通過，但厚度讀回修正後仍須重跑打包與完整 release gate。安裝已解除，不能再把缺 node_modules 當成現行阻擋；Node 24 npm ci 與 Node 22 測試的環境差異仍保留。
- 安裝阻擋解除後的新結果（取代下列歷史缺依賴現況）：使用者在 Node 24.14.0 下完成 npm ci，本輪已確認 saxes 等套件存在；官方 Node 22.23.4 完整測試為 437 項、430 通過、7 失敗、0 略過。7 項分別是 6 個 golden 歷史 fixture 仍依賴自動套預設，以及 1 個 UI 案例預期快照保存目前預設旗標；已將 fixture 改為先斷言鎖定、再明確選版，保留原分析斷言，並重跑受影響測試。全套尚未重新通過，不作發布證據。npm audit 的 3 項警示位於 Wrangler/Miniflare/undici 開發依賴鏈，omit=dev 掃描為 0；未執行 force 修復或升級依賴。
- Cloudflare 現況唯讀補證：目前登入帳戶的 Workers 和 Pages 共 7 個專案，搜尋 spi-spc-analyst-staging 顯示 No projects found；D1 清單仍有 spi-spc-staging，UUID 與 staging 設定相符；R2 清單仍有 spi-spc-record-staging。因此目前阻擋是 staging Worker 入口無可用應用，不能將本機設定存在視為 staging 已就緒。未建立或修改遠端資源。正式 Worker 清單另顯示較新的 fix(data): contain import preview and restore picker focus 部署紀錄；整合前須重新取得主線與部署 SHA，舊基準不再足以支持發布。
- 失敗拆查補充：cf-budget 的 E-3／F-2 均在 import wrangler 時失敗，尚未執行 rows_read 斷言；同檔另兩項通過。api HTTP 案例缺 @anthropic-ai/sdk、auth 測試缺 @netlify/blobs、cloudflare 測試缺 saxes；這些已確認為依賴載入錯誤，不能當作已重現產品邏輯缺陷，也不能因此跳過原 gate。api 另有一項因缺 jsdom 略過。尚未把這些原因外推為全部 40 項失敗的共同根因。
- 用戶端提交的快照不會成為伺服器可信資料；規格引用以伺服器讀回原檔及指紋為準。
- 沒有回填舊資料，也沒有把目前預設或最新版偽裝成歷史引用；新建時拒絕損壞或不可讀的規格原檔，載入時快照損壞或跨料號即停止操作。
- 待覆核量測仍在分析前被擋下；本次未改動權限、不可變原檔、稽核或雲端 fail-closed 行為，也未改資料庫 schema。
- 驗證結果：候選 node tools/build-cloudflare.mjs 在主機 Node 24.14.0 通過；tests/records.test.mjs 15/15、tests/verdict-sim.test.mjs（RUN_SLOW=1）7/7 通過。Worker／UI／規格測試組因缺少 saxes 而載入失敗（NOT PASS）。Node 22 獨立 npm ci 被執行審核閘門拒絕，沒有使用替代路徑安裝相依；release-check exit 1／Overall BLOCKED，測試階段回報 40 項失敗。已直接確認的 saxes 載入錯誤不能解釋其他所有失敗，尚未逐項定位。
- 更正 staging 配置結論：受 Git 追蹤的 wrangler.staging.jsonc 已定義獨立 spi-spc-analyst-staging Worker、spi-spc-staging D1 與 spi-spc-record-staging R2。先前只檢查根設定便判定 staging 配置缺失，證據不足，撤回該結論。歷史驗收紀錄不代表資源現況；本輪 Chrome 唯讀開啟既有 staging HTTPS 網址，顯示 Cloudflare「There is nothing here yet」／Page not found，尚無可用應用或候選版本證據，也不能據此斷定 Worker 已刪除。
- Wrangler deploy dry-run、staging 資源現況／權限與 UAT 仍未驗證。候選本機 build 的 file: URL 被瀏覽器政策拒絕，且明確禁止繞過；未執行候選視口／主題矩陣或 LCP／CLS／INP trace。既有 staging HTTPS 基準檢視沒有部署候選或寫入資料。
- 因必要 gate 未能執行，本次不推送、不觸發 Cloudflare Git 部署，也未寫入 staging 或 production 資料。下一步是由允許的執行環境完成 Node 22 lockfile 安裝與全套 gate，再使用核准的候選瀏覽器方式完成 UI／效能驗收和 staging UAT。

### 3.6 主線整合後驗收（2026-10-31）

本節為本次候選的目前狀態；§3.5 保留執行歷史，當中的缺依賴、舊基準及測試失敗不能當作現行結果。

- **FACT / verified — 來源與隔離**：候選工作樹為 spi-spec-history-main，分支 work/measurement-spec-history-main，以 origin/main 的 631560938cdbe894f977715c6fff903b2ec4098c 建立。原 work/measurement-spec-history 工作樹及變更保留。候選版本為 v10.12.3，保留主線 v10.12.0–v10.12.2 的匯入步驟、錯誤摘要、來源資訊、窄版欄寬與焦點返回。
- **FACT / verified — 安裝條件**：使用者已在原工作樹以 Node 24.14.0 執行 npm ci。兩個工作樹的 lockfile 相依圖忽略根版本號後相同；新工作樹透過 junction 共用該 node_modules，測試執行器為官方 Node 22.23.4。這不等於新工作樹已獨立完成 Node 22 npm ci。開發工具依賴的 3 項 audit 警示仍存在，omit=dev 掃描為 0；未強制升級依賴。
- **FACT / verified — 本機子系統**：Node 22 執行 spec-history-isolation、part-spec 與 part-spec-ui，17/17 通過。涵蓋伺服器快照、預設換版後讀回原版、跨料號與損壞指紋拒絕、未指定／歷史缺失鎖定、鋼板厚度讀回及非同步匯入隔離。本機 API/D1/R2 harness 不等於遠端 staging。
- **FACT / verified — 建置與 dry-run**：Node 22 Cloudflare build 成功，HTML 964,673 bytes，建置標記 2026-10-31 00:22:57 UTC+8；Wrangler 4.151.0 的 staging deploy dry-run 通過，綁定獨立 spi-spc-staging D1 與 spi-spc-record-staging R2，未上傳或部署。
- **NOT PASS → 局部修正 verified — 完整關卡**：主線整合後首輪 release-check exit 1／Overall BLOCKED，僅 step7 的 D-54 失敗；其餘 version、changelog、docs、deps、secrets、a11y 均 PASS，debug 為兩處 console 診斷 WARN。Node 22 單獨重現確認：fixture 透過新 API 建立未選規格的紀錄，已保存 unassigned，畫面正確顯示未指定，但舊測試仍預期未知。修正測試為同時驗證新紀錄未指定與缺少快照的舊紀錄未知，沒有移除未知狀態斷言；step7 全檔 9/9 通過、0 略過。Node 22 test:slow 已完成，7/7 通過、0 失敗、0 略過（123.7 秒）；修正後完整 release-check 已啟動，尚待終止結果。原工作樹的 438 項通過只屬舊候選，不能替代本候選結果。
- **FACT / verified — 修正後完整結果**：同一個修正後 Node 22 release-check 程序已終止，exit 0，56 個測試檔、444 項通過，測試檢查 PASS；沒有略過警告。version、changelog、docs、deps、secrets、a11y 均 PASS。整體為 NEEDS REVIEW，保留兩處 console 診斷 WARN，不能寫成整體 READY。此結果取代上一項「尚待終止」的程序狀態；slow gate 的 7/7 為另一次獨立執行結果。
- **FACT / reviewed — console 警告**：掃描命中的兩處為 3D 未繪出時的 console.warn 與 safeBoard2D 捕捉例外的 console.error；兩者均伴隨使用者可見降級／錯誤訊息，本次沒有修改這些路徑，也沒有為消除警告而移除診斷。NEEDS REVIEW 原始摘要保留。
- **not verified — UI 與效能**：本候選未完成四尺寸 × 雙主題、所有分頁／對話框、鍵盤、觸控 44px 與 DPR 重複進出矩陣。候選 file: URL 曾被瀏覽器政策拒絕且禁止繞過；目前沒有可用的 Chrome Performance trace 工具，因此 LCP／CLS／INP 沒有量測值。既有主線矩陣與靜態測試不可替代本候選的實測。iPhone 真機 NOT TESTED。
- **not verified — staging UAT 與發布**：目前未取得可用的 staging Worker 應用入口；獨立 D1/R2 存在不代表 Worker 已可用。使用者再次提供的是正式站與 repository，不能把它們當作 staging 或正式資料寫入授權。尚未建立三筆合成資料、驗證遠端快照／指紋、清除及核對稽核保留。
- **FACT / verified（畫面）／not verified（HTTP）— 正式站登入後路徑**：使用者完成登入後，Chrome 正式站顯示 v10.12.2／2026-10-30 19:21:33；在「資料與規格 → 資料庫」按重新整理，成功呈現雲端 1 筆量測、2 筆座標與 3 個規格版本。未上傳、修改或刪除資料。可用的唯讀頁面範圍沒有暴露 Performance Resource Timing，未取得 HTTP 狀態碼；Windows 電腦操作介面另因不能可靠確認瀏覽器 URL 而要求停止，未繼續開發工具操作。這是既有正式版本的畫面證據，不證明 v10.12.3 的遠端快照或發布驗收。
- **使用者核准的 staging 順序調整**：本機完整測試與 slow gate 完成後，使用者明確核准先 commit 並只推送 work/measurement-spec-history-main，透過獨立 spi-spc-analyst-staging 的 Cloudflare Git 建置（wrangler.staging.jsonc）完成候選驗收。這項授權解除 staging UAT 前不得推送測試分支的先後循環；main／production 仍等全部必要驗收通過後才推送，沒有豁免 UI、效能、獨立安裝或 UAT 證據。
- **自我審查與停止條件**：沒有回填歷史規格、回退最新版、接受用戶端快照或更動權限／稽核／schema。接續依已核准順序建立 staging Git 建置入口與驗收；正式部署後仍須核對推送 SHA、Worker version ID 及登入後資料庫 HTTP 200。GitHub Actions 不作部署路徑，不使用手動 Wrangler 部署，不寫入 production 資料。
