---
name: debug-loop
description: "SPI·SPC 分析台的除錯迴圈：組合 code-review、bug-fixer、security-review、verify-spi-spc 等技能成一棵技能樹，反覆「找問題 → 修正 → 依失效階梯驗證 → 再找一輪」，直到在已驗證範圍內找不到問題，或碰到停止條件為止。Use whenever 使用者說「除錯到沒問題」「一直修到全綠」「全面找 bug」「巡檢」「幫我把問題都修掉」「debug until clean」，或回報一個症狀並希望修好且確認沒有連帶問題。Do NOT use for 單純問技能清單、只要跑一次發布閘門（用 validate-production-release）、或只要本機畫面驗證（用 verify-spi-spc）。"
---

# 除錯迴圈（debug-loop）

這個技能把幾個既有技能接成一個會自己收斂的迴圈。迴圈的價值不在「多跑幾次」，而在每一輪都留下證據：
找到什麼、怎麼重現、改了什麼、哪些關卡在哪一份內容上通過。沒有證據的「應該好了」不算一輪。

## 「完全沒問題」的定義

除錯永遠只能證明「在檢查過的範圍內沒有找到問題」。結束時要能同時寫出下面四點，才可以宣告 `CLEAN`：

1. 最後一份內容（同一個指紋）上，所選層級的全部關卡是 `pass` 或 `reused`；`release-check` 為 `NEEDS REVIEW` 時，每條警告都寫了判讀。
2. 最後一輪「發現」沒有新的已確認問題。
3. 問題清單裡每一項都已結案：`fixed`（附重現與修後證據）、`not-a-bug`（附證據）、`out-of-scope`（已用 spawn_task 開成另案，或寫進報告）或 `blocked`（附所需輸入）。
4. 沒跑到的範圍逐項列為 `NOT TESTED`（例如 iPhone 真機、正式站資料庫路徑、缺 Playwright 的畫面流程）。

有任何 `blocked` 或必要關卡 `not-run`，結果就是 `INCOMPLETE`，不是 `CLEAN`。

## 技能樹

```
debug-loop（本技能，負責調度與判定）
├─ 0 分流
│   ├─ 症狀模式：使用者回報具體問題 → 先重現
│   └─ 巡檢模式：沒有症狀 → 從發現節點開始
├─ 1 發現（每輪都跑，依變更挑節點）
│   ├─ gates.mjs plan/run ─────── 測試、語法、掃描、mutation、test:slow
│   ├─ code-review ────────────── diff／分支的正確性
│   ├─ security-review ────────── 動到 cloudflare/、lib/auth*、netlify/、登入或分享時
│   ├─ verify-spi-spc ─────────── 動到畫面、登入、記錄庫、3D、報告時（實際點過）
│   └─ design:accessibility-review ─ 動到版面、配色、觸控時
├─ 2 分診 → 寫入問題清單（findings.md）
├─ 3 修正 → anthropic-skills:bug-fixer（一次一項：重現 → 原因 → 最小修正 → 回歸測試）
├─ 4 驗證 → gates.mjs run（V0→V3，同內容已通過的關卡自動沿用）
├─ 5 判定 → CLEAN／再一輪／STOP／BLOCKED
└─ 6 學習 → 把會再犯的錯變成最窄的保護（測試或 mutation fixture）
```

技能名稱以本平台的技能清單為準。某個技能在本平台不存在時（例如 Codex、Antigravity），照該節點的目的在主流程中直接做，不要因此跳過節點。
`verify-spi-spc` 位於 `.agents/skills/verify-spi-spc/`，直接執行它的腳本：`python3 -B .agents/skills/verify-spi-spc/scripts/verify.py all`（Windows 用 `python`）。

## 關卡執行器 `scripts/gates.mjs`

在 repo 根目錄執行。它依變更檔與 `spi-spc.html` 的增刪行，對照 AGENTS.md 各條「檢查」挑出關卡，由快到慢執行，低層級失敗就不跑高層級。

```bash
node .agents/skills/debug-loop/scripts/gates.mjs plan            # 看會跑什麼、為什麼
node .agents/skills/debug-loop/scripts/gates.mjs run             # 依建議層級執行
node .agents/skills/debug-loop/scripts/gates.mjs run --level V3  # 巡檢或收尾：完整套件
node .agents/skills/debug-loop/scripts/gates.mjs status          # 目前內容已有哪些通過紀錄
```

- 層級：V0 語法與掃描；V1 smoke 與聚焦測試；V2 mutation-check、test:slow、verify-spi-spc；V3 `release-check`（內含完整 `npm test`）、`test:slow`、build、Worker dry-run。
- 結果記在使用者狀態目錄（Linux `~/.local/state/spi-spc-debug-loop/ledger.json`，Windows `%LOCALAPPDATA%\spi-spc-debug-loop\`），以「HEAD＋工作樹內容」為指紋。內容沒變就沿用，不重跑；commit 不會讓結果失效。
- 結束碼：0 通過；1 有失敗（輸出列出失敗測試名稱與 expected／actual）；3 有 `blocked` 或 `not-run`。
- `spi-spc.html` 有改卻沒命中任何影響規則時，它會自動升到 V3，因為影響範圍判斷不出來時不能只跑聚焦測試。
- `--only id,id` 只跑指定關卡（修正後的快速回饋用），`--force` 忽略沿用紀錄（懷疑環境變了才用）。

## 每一輪怎麼跑

### 0 分流（只在第一輪）

- 先讀 `git status` 與目前分支；工作樹有不屬於本次的改動時，記下來並避開，不要一起修或一起提交。
- 症狀模式：問清楚或從對話取得「預期／實際／資料來源」。AGENTS.md 要求用與使用者相同來源的資料重現（同一筆雲端紀錄或同一種匯入方式），用範例資料只能證明範例沒問題。
- 巡檢模式：第一輪用 `gates.mjs run --level V3` 建立基準，再做下方「巡檢清單」。乾淨的工作樹上關卡多半全綠，綠燈只代表現有測試沒抓到東西，巡檢的價值在找測試沒覆蓋的地方。
- 依 Institution 01 定級：碰到 `cloudflare/migrations/`、`auth`、`.github/workflows/`、規則檔（AGENTS.md、CLAUDE.md）或改動超過 5 個檔，屬 L3，先把規格與影響給使用者看，核准後才改。

### 1 發現

依本輪的變更挑節點，不要每輪都把所有技能跑一遍：第一輪範圍最大，之後只看「上一輪改到的地方和它的直接使用者」。
節點產出的每一條疑點都進下一步分診，不直接動手改。

**巡檢清單**（巡檢模式第一輪；產品程式和驗證工具都要看，兩邊都可能藏錯）：

1. **修了一半的修正**：讀最近 10 個 `fix` 提交，每個都問「同一類錯誤還有哪條平行路徑沒改到」。例：修了一般模式的精度誤差，階梯鋼板模式的同一段算式還在；修了同步偵測，背景 worker 的偵測沒跟上。
2. **AGENTS.md 守則的違規搜尋**：每條有「檢查」的規則，用 grep 找違規寫法，不只信測試。例：清單欄位直接 `.join("; ")` 沒走 `topList`、讀取量測列沒經 `scopeFilter`、`.textContent` 指派的字串含 HTML 標籤。
3. **API 輸入邊界**：Worker 路由（`cloudflare/`、`lib/repo.mjs` 等）的查詢參數用非整數、負數、超大值、空字串各打一次，期待 4xx 或被夾住的值，不是 5xx。
4. **驗證工具自己有沒有在檢查**：關卡用的工具（語法檢查、mutation-check、release-check）各故意餵一次壞輸入，確認它真的會紅。測試在缺檔時直接 `return`（記成通過、而不是 SKIP）也算這一類。
5. **`code-review`** 看近期提交，補上前四項沒涵蓋的正確性問題。

清單每一項都要留下做了什麼、看了哪些位置；沒做的寫在報告的 `NOT TESTED`。

### 2 分診

把疑點寫進問題清單，格式見下方。每條要先分類：

- `confirmed`：有重現（失敗的測試輸出、錯誤訊息、截圖或可重跑的指令）。
- `suspected`：只有推論。下一輪先補重現；補不出來就以 `not-a-bug` 或 `UNKNOWN` 結案，不要為了推論改程式。
- `out-of-scope`：真的有問題但不屬於本次請求，用 spawn_task 開另案，不擴大本次修改。

一次只修一項 `confirmed`，依嚴重度排序（資料錯誤、誤判、當機 > 版面 > 文案）。一次改多項會讓驗證失敗時分不出是誰造成的。

### 3 修正

載入 `anthropic-skills:bug-fixer` 處理這一項。不論用不用該技能，修正都要有：

- 修之前的失敗證據（重現）。只有修後綠燈、沒有修前紅燈，不算修好。
- 最小的修正，沿用既有寫法；不順手重構。
- 一條修前會紅、修後會綠的回歸測試。既有測試已經會紅時可以沿用，但要再看同一個缺陷的鄰近路徑有沒有測到（例：單一元件測到了，元件群組、「依問題定義檢視」沒測到），沒測到的補上。同一類讀取端（例如範圍篩選）還要在 `tests/fixtures/mutations-component-scope.json` 加一項對應的破壞。
- 不刪測試、不放寬斷言、不加固定休眠、不吞掉錯誤來換綠燈。測試預期真的要改時，寫明是哪個需求改變了它。
- 改到產品程式時照 repo 慣例升 patch 版號：`package.json`、`package-lock.json`、`lib/version.mjs`、`spi-spc.html` 的 `#appVer`，並在 `CHANGELOG.md` 最上方加條目（`#appBuilt` 不動）。要在收尾關卡之前改，release-check 才會檢查到最終內容。只動測試或技能工具時不升版。

### 4 驗證

```bash
node .agents/skills/debug-loop/scripts/gates.mjs run
```

先讓本輪建議層級全綠。失敗時先讀輸出判斷是不是這次修正造成的：是就回到 3；不是就記進問題清單（附證據），不要擴大修。

### 5 判定

| 狀況 | 下一步 |
|---|---|
| 關卡全綠，且本輪發現沒有新的 confirmed | 依「收尾層級」跑最後一次；仍全綠且清單全部結案 → `CLEAN` |
| 關卡全綠，但清單還有未結案項 | 下一輪，處理下一項 |
| 關卡失敗、有新證據 | 依新證據調整做法，下一輪 |
| 同一項失敗兩次，且沒有新證據 | 停下來重新檢查假設：回到重現，換診斷方法；不要再疊補丁 |
| 同一項換了三種做法仍失敗 | `STOP`，回報已試過什麼、證據、卡在哪 |
| 連續兩輪，新出現的問題不比修掉的少 | `STOP`：修正在製造問題，範圍或做法有誤，回報給使用者決定 |
| 需要憑證、migration 核准、刪資料、force push、付費操作 | `BLOCKED`，寫明需要的輸入 |
| 已跑 6 輪 | 停下回報進度與剩餘清單，問使用者是否繼續；不要無限循環 |

**收尾層級**：依最後的實際改動決定，不是一律 V3。完整套件約 16 分鐘，跑在沒有改動的程式上只花時間、不增加證據。

- 改到產品程式（`spi-spc.html`、`lib/`、`cloudflare/`、`netlify/`）或巡檢模式：`--level V3`。
- 只改測試或 fixture：`gates.mjs run` 的建議層級（聚焦測試；改到 mutation fixture 時含 mutation-check）。
- 沒有任何改動（例如判定 `not-a-bug`）：不需要收尾關卡，報告引用支持判定的那次測試輸出即可。

### 6 學習（只在值得時）

同一類錯在本次迴圈出現兩次以上，或修掉的問題很難被現有測試抓到，就把保護放在最窄的地方：一條測試、一項 mutation fixture，或 `gates.mjs` 的一條 RULES。
要改 AGENTS.md 等規則檔時，屬 L3，只提草案給使用者核准。一次性的細節不升格成規則。

改的是本技能自己的工具（`gates.mjs` 的規則漏抓等），和產品修正分開：另一個 commit，最好另一個 PR，報告裡也分開寫。混在同一個修正裡，審查的人會分不出哪行是修錯誤、哪行是改工具。

## 問題清單（findings.md）

放在 scratchpad 或狀態目錄，不放進 repo（release-check 的掃描會掃 repo 內的檔案）。每輪更新，最後的報告直接取用。

```markdown
# 除錯迴圈｜<日期>｜模式：症狀／巡檢｜分支 <branch>

| ID | 狀態 | 嚴重度 | 位置 | 問題 | 證據 | 嘗試 |
|---|---|---|---|---|---|---|
| F1 | fixed | 高 | spi-spc.html:7756 | 空範圍退回全板 | 修前 component-scope #1 紅（expected 900 actual 2900）；修後綠；新增 mutation「空範圍退回全板」 | 1 |
| F2 | suspected | 中 | cloudflare/worker.mjs | 分享連結逾時未清除 | 推論，待重現 | 0 |

## 輪次
- R1：發現 code-review＋gates V3 → 新增 F1、F2；修 F1；gates V2 PASS（指紋 3fa2…）
- R2：…
```

## 交付與報告

迴圈結束後，交付依 AGENTS.md「發布與部署」：使用者要求修好的產品變更要 commit、push、開 PR，必要的 check 綠了才合併，並在正式站讀回版本與資料庫路徑。使用者說不要合併或不上正式站，就停在本機並寫明。
本技能不新增任何發布授權；有新的 migration 就先停在核准。

最後的回覆依序寫：

1. **結果**：`CLEAN`／`INCOMPLETE`／`STOP`／`BLOCKED`，以及共跑了幾輪。
2. **修掉的問題**：每項一句，附修前重現與修後證據的位置。
3. **驗證**：每個關卡由哪次執行滿足（指紋或 commit SHA、層級、`pass`／`reused`／`review`）；本機、遠端 CI、正式站分開寫。
4. **沒處理的**：`out-of-scope`、`blocked`、`NOT TESTED`，各附原因與下一步。

不用「應該」「大致」描述驗證結果；沒跑的就寫沒跑。
