# RFC-SPI-AUDIT-DEL-20261112：稽核紀錄可由使用者刪除

**文件編號**：RFC-SPI-AUDIT-DEL-20261112  
**狀態**：草案（For Review）  
**日期**：2026-11-12  
**關聯**：[spec-record-file-delete-rfc.md](spec-record-file-delete-rfc.md)、[spec-record-file-manager-rfc.md](spec-record-file-manager-rfc.md)、[spec-part-spec-rfc.md](spec-part-spec-rfc.md)、[spec-database-management-rfc.md](spec-database-management-rfc.md)

本規格不構成發布授權。核准後方得進行實作 PR。

---

## 1. 問題陳述與目標

### 1.1 問題

記錄庫「料號規格」分頁底部的折疊區「稽核紀錄（新增、刪除與設為預設）」（`#recAuditBox` → `#recAudit`，由 `renderAudit()` 繪製）只能查閱，無法刪除任何一列。測試上傳、誤操作、反覆切換預設版產生的列會一直留在清單裡，干擾判讀。

現行設計刻意不提供刪除：

- `cloudflare/migrations/0002_free_plan_schema.sql`：`audit_log`「永不刪除」。
- `lib/repo.mjs` 檔頭：「audit_log: 永不刪除，原子記錄新增與刪除」。
- `spec-record-file-delete-rfc.md` §1.2：「`audit_log` 列永不刪除」。
- 伺服器沒有刪除 `audit_log` 列的 API；`renderAudit()` 也沒有操作欄。

使用者要求：**稽核紀錄可以由使用者刪除**。

> 取捨（一句話）：刪除稽核列會降低可追溯性（品保稽核時無法證明某動作曾發生）。本 RFC 以「刪除本身留下不可刪的墓碑列」彌補，不改變使用者要求的「可以刪」。

### 1.2 目標

1. **可刪除**：已登入雲端的使用者可在稽核清單逐列刪除，桌面與手機寬度都可操作。
2. **權限明確**：一般使用者只能刪除自己執行的列（`by` = 登入帳號）；管理者（`admin_roles`）可刪除任何列。伺服器為唯一授權來源。
3. **刪除可追溯**：每次刪除在同一個 D1 batch 內寫入一筆 `audit_delete` 墓碑列，記下被刪列的摘要、刪除者與時間；墓碑列不可刪除。
4. **不影響其他功能**：刪除稽核列不改變 `records`、`coordinate_scopes`、R2 原檔、預設版旗標或分享連結。
5. **無 migration**：沿用現有 `audit_log` 欄位。

### 1.3 非目標

- 不做批次刪除、全部清空、依日期自動清理、保留期限政策。
- 不做軟刪除（隱藏）與還原；刪除後的原列內容無法從介面取回。
- 不提供本機 IndexedDB 舊資料（`LocalRec.audit()`）的刪除；本機模式維持只供查閱。
- 不改變新增、刪除、設為預設、修改、封存、分享等動作「必定寫入稽核」的既有規則。
- 不修改已套用的 migration 檔（`0002` 內的「永不刪除」註解保留為歷史，改以本 RFC 與 `lib/repo.mjs` 註解為準）。

---

## 2. 決策

| # | 決策 | 預設（待核准） |
|---|---|---|
| D1 | 誰可以刪 | 一般使用者：只刪 `by` 等於自己帳號的列；管理者：任何列。若產品決定「任何登入者可刪任何列」，只需移除 §3.2 步驟 3 的擁有者檢查 |
| D2 | 刪除方式 | 硬刪除該 `audit_log` 列，同一 batch 插入 `audit_delete` 墓碑 |
| D3 | 墓碑可否刪除 | 不可。伺服器回 409，介面不顯示刪除鈕 |
| D4 | 「未完成」列（`detail.done === false`） | 可刪，規則與一般列相同 |
| D5 | 確認方式 | 記錄庫內確認對話框（與 `spec-record-file-manager-rfc.md` 同一元件），不用 `window.confirm` |

---

## 3. 資料模型與介面

### 3.1 墓碑列格式

```
action      = 'audit_delete'
target_type = 'audit'
target_id   = '<被刪列的 seq>'          -- 字串
by          = <刪除者>
at          = <刪除時間 ms>
detail      = {
  "deleted": {
    "seq": 123, "at": 1762900000000, "by": "alice",
    "action": "set_default_spec", "target_type": "record", "target_id": "<id>",
    "kind": "spec", "part": "P-001", "lot": "", "rev": "", "name": "spec.json"
  }
}
```

`detail.deleted` 只保留辨識用欄位（上列），不複製完整 `detail`，避免把原列內容換個地方原樣保存。

### 3.2 API 契約：`DELETE /api/records?audit_seq={seq}`

沿用 `/api/records` 的登入檢查；在 `handleRecordsApi` 的 `DELETE` 分支內，於讀取 `id` 之前先判斷 `audit_seq`。

1. `seq` 必須是正整數，否則 **400** `{ "error": "稽核紀錄編號格式不正確" }`。
2. 讀取該列；不存在 → **404** `{ "error": "找不到這筆稽核紀錄" }`。
3. 授權：`admin` 或 `row.by === user`，否則 **403** `{ "error": "只能刪除自己執行的稽核紀錄" }`。
4. `row.action === 'audit_delete'` → **409** `{ "error": "刪除稽核的紀錄不能刪除" }`。
5. 單一 D1 batch（順序固定）：
   - `INSERT INTO audit_log (at, by, action, target_type, target_id, detail) SELECT ?, ?, 'audit_delete', 'audit', CAST(seq AS TEXT), json_object('deleted', json_object(...)) FROM audit_log WHERE seq = ? AND action <> 'audit_delete'`
   - `DELETE FROM audit_log WHERE seq = ? AND action <> 'audit_delete'`（一般使用者再加 `AND by = ?`）
6. batch 失敗 → **503** `{ "error": "資料庫暫時無法寫入，請稍後再試（稽核紀錄未刪除）" }`。
7. `DELETE` 的 `meta.changes === 0`（同時被別人刪掉）→ **404**；此時第一句 `INSERT … SELECT` 也不會插入，墓碑不重複。
8. 成功 → **200** `{ "deleted_seq": 123 }`。

`Repo` 新增 `deleteAuditEntry(seq, user, isAdmin)`；Worker 只負責參數與回應碼。

### 3.3 `listAuditLog` 調整

- 回傳列加上 `can_delete`：`action !== 'audit_delete' && (isAdmin || by === user)`。授權仍以 §3.2 為準，此欄只供介面決定是否顯示按鈕。
- `audit_delete` 列的 `status` 為「完成」，並攤平 `detail.deleted` 為 `deleted`。
- `target_type === 'record'` 且目標已不存在時，狀態文字由「目標已不在本站（見較新的刪除或遷移排除紀錄）」改為「目標已不在本站」：對應的刪除列可能已被使用者刪掉，括號內的指引不再必然成立。

### 3.4 前端契約（`renderAudit`）

| 項目 | 規格 |
|---|---|
| 顯示條件 | `RecDB.mode === "cloud"` 且列的 `can_delete === true`；本機模式不顯示 |
| 欄位 | 表格最後新增「操作」欄，可刪列放「刪除」按鈕（`data-audit-del="<seq>"`）；不可刪列留空 |
| 墓碑列 | 動作欄顯示 `<span class="pill na">刪除稽核</span>`，下方純文字：「已刪除：<原動作中文> · <原時間> · <原執行者>」；類型、批號等欄位取自 `deleted` |
| 確認對話框 | 標題「刪除稽核紀錄」；正文（純文字）列出時間、動作、類型、料號、檔名、執行者，並寫「刪除後無法復原，會留下一筆刪除紀錄。」；左「刪除」、右「取消」 |
| 進行中 | 按鈕停用，文案「正在刪除…」 |
| 成功 | Toast「已刪除 1 筆稽核紀錄」；重新 `renderAudit()`；焦點移到 `#recAudit` |
| 失敗 | Toast 顯示伺服器 `error`；清單不變 |
| 觸控 | 刪除鈕在 `@media (pointer:coarse)` 下 ≥ 44px（規則放在基礎規則之後；不寫行內 `min-height`） |
| 版面 | 新欄不得讓 320px 整頁橫向溢出；表格維持在 `.tbl` 內捲動 |
| 文案 | 折疊標題維持「稽核紀錄（新增、刪除與設為預設）」；料號規格說明句「切換會寫入稽核紀錄」不變 |

`RecDB` 新增 `async auditDel(seq)` → `jfetch("/api/records?audit_seq="+seq, {method:"DELETE"})`；非 cloud 模式直接拋錯（與 `RecDB.create` 一樣 fail-closed）。

### 3.5 與既有讀取端的影響

| 讀取端 | 影響 | 處理 |
|---|---|---|
| `setDefaultSpec`／`setDefaultPlacement` 寫入後讀「最新一筆 set_default 列」取 `from` | 剛寫入的列在讀回前被刪 → 讀到更舊的列或 `null` | 可接受：只影響該次回應的 `from` 顯示；不影響資料。測試覆蓋 `null` 時回 `from: []` |
| `listAuditLog` 的「目標已不在本站」 | 刪除列被刪後，新增列仍顯示目標不在 | §3.3 改文字 |
| `tools/migrate-netlify-blobs.mjs` | 依 `src_key` 刪遷移暫存列，與本功能無關 | 不變 |
| 報告、匯出、AI 分析 | 不讀 `audit_log` | 不變 |

---

## 4. 安全、效能與上線

### 4.1 威脅模型

| 風險 | 緩解 |
|---|---|
| 一般使用者刪除他人或管理者動作的紀錄 | 伺服器檢查 `by = user`，SQL 條件再擋一次；前端隱藏按鈕不作為授權 |
| 刪除後否認曾刪除 | 墓碑列同 batch 寫入、不可刪除 |
| 管理者大量清除稽核 | 每刪一筆就多一筆墓碑；清除行為本身可見 |
| `seq` 注入 | 正整數驗證＋參數綁定 |
| 未登入或離線 | `/api/records` 既有登入檢查；`RecDB.auditDel` 非 cloud 拋錯 |

### 4.2 效能

單筆刪除：1 次主鍵讀取＋1 次 D1 batch（2 句）。不掃全表，不影響 `test:slow`。

### 4.3 上線與回退

- 無 migration、無功能旗標。
- 回退：還原 Worker、`Repo`、`renderAudit`。已刪除的稽核列無法由回退恢復，需 D1 備份還原。
- 合併前：`npm test`（含下列新測試）；介面依 AGENTS.md「UI 改動的驗證矩陣」跑 1440／820／390／320 × 明亮／深色，記錄庫「料號規格」分頁展開稽核清單、開啟確認對話框。
- 發布後：正式站以一般帳號登入，刪除一筆自己的測試列，讀回 `GET /api/records?audit=1` 確認該列消失、墓碑出現；刪除他人列回 403。依 AGENTS.md 先走過 `POST /__login` 再呼叫 API。

### 4.4 實作 PR 須同步的測試與文件

| 資產 | 變更 |
|---|---|
| `tests/controlled-repo.test.mjs` | `deleteAuditEntry`：本人可刪、他人 403、管理者可刪、墓碑 409、不存在 404、batch 失敗 503 且原列仍在、並行刪除只產生一筆墓碑 |
| Worker API 測試（`tests/share.test.mjs` 同型的 Worker 測試） | `DELETE /api/records?audit_seq=` 參數驗證與回應碼；未帶 `audit_seq` 時原 `id` 刪除路徑不變 |
| `tests/records-ui.test.mjs` | 可刪列顯示刪除鈕、不可刪列與墓碑列不顯示；確認後清單重繪且出現「刪除稽核」 |
| `tests/mobile-layout.test.mjs` | 稽核表操作欄觸控熱區與 320px 不溢出 |
| `lib/repo.mjs` 檔頭註解 | 改為「audit_log：使用者可刪除，每次刪除寫入不可刪的 audit_delete 墓碑」 |
| `docs/spec-record-file-delete-rfc.md` | §1.2 目標 2「`audit_log` 列永不刪除」加註「後續由 RFC-SPI-AUDIT-DEL-20261112 調整」 |
| `CHANGELOG.md`、`package.json`、`lib/version.mjs`、`spi-spc.html #appVer` | 次版號遞增並寫使用者可見說明 |

---

## 5. 驗收條件（Given / When / Then）

1. **Given** 一般使用者 alice 已登入、清單中有一筆 `by=alice` 的列 **When** 按「刪除」並在對話框確認 **Then** 該列消失、清單頂端出現「刪除稽核」列，其說明含原動作、原時間與 alice。
2. **Given** alice 已登入、清單中有 `by=bob` 的列 **Then** 該列無刪除鈕；直接呼叫 `DELETE /api/records?audit_seq=<該列>` 回 403，列仍在。
3. **Given** 管理者已登入 **When** 刪除 `by=bob` 的列 **Then** 成功並產生墓碑，墓碑 `by` 為管理者。
4. **Given** 任一使用者 **When** 對墓碑列呼叫刪除 **Then** 409；介面不顯示該列刪除鈕。
5. **Given** D1 batch 失敗 **When** 刪除 **Then** 回 503，原列仍在、沒有墓碑，Toast 顯示錯誤。
6. **Given** 兩個請求同時刪同一列 **Then** 一個 200、一個 404，只有一筆墓碑。
7. **Given** 刪除某量測的「刪除」列 **Then** 該量測的「新增」列顯示「目標已不在本站」，不再出現「見較新的刪除…」字樣。
8. **Given** 本機模式（未登入雲端）**Then** 稽核清單沒有刪除鈕；`RecDB.auditDel` 拋錯。
9. **Given** 320px 寬、深色模式 **When** 展開稽核清單並開啟確認對話框 **Then** `scrollWidth === clientWidth`，刪除與取消按鈕 ≥ 44px，文字對比 ≥ 4.5。

---

## 6. 待確認

- D1：若要「任何登入者可刪任何列」，請在核准欄註明；預設為本人＋管理者。
- 是否需要保留期限（例如墓碑保留 N 年）——本 RFC 不處理。

---

**核准欄**（留空）：產品／品保工程 __________　日期 __________
