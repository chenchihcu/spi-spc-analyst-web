# PR 合併衝突自動分類與 docs 自癒（RFC）

## 意圖

當 PR 與 `main` 衝突（`mergeStateStatus: DIRTY`）時，Agent 應能 **merge main → 分類 → 僅對安全範圍自癒 → 驗證 → push**，不需等人點 diff-tab。典型案例：平行 PR 各在 `docs/*-audit.md` 新增一條 `- [x]` 待辦。

## In scope

- `tools/merge-conflict-classify.mjs`、`merge-conflict-resolve-docs.mjs`、`pr-merge-sync.mjs`
- `docs/**/*.md` 內 **純 checklist hunk** 的 union 解析
- `AGENTS.md`、debug-loop SKILL 的 PR hygiene 條文
- 單元測試與 `package.json` 薄包裝腳本

## Out of scope

- GitHub Merge Queue／branch protection 變更
- 通用 3-way merge driver
- 自動 `gh pr merge`
- `CHANGELOG.md` union（v1 一律人工，走版本檔規則）

## 功能需求

| ID | 需求 |
|----|------|
| FR-1 | `merge-conflict-classify.mjs --json` 對 `git diff --name-only --diff-filter=U` 輸出分類與 per-file `autoResolvable`。 |
| FR-2 | 白名單：`docs/**/*.md`；hunk 兩側非空行皆為 `- [x]`／`- [ ]` → union 去重（main 側序優先，再補 HEAD 獨有）。 |
| FR-3 | 黑名單：`package.json`、`package-lock.json`、`lib/version.mjs`、`spi-spc.html`、`CHANGELOG.md`、`cloudflare/migrations/**`、`lib/auth-handler.mjs`、`lib/auth-core.mjs`、`.github/workflows/**` → `blocked`。 |
| FR-4 | `pr-merge-sync.mjs`：`--check-json`、`--dry-run`、`--sync`；存在 UU 或非白名單未解 hunk 時不得 exit 0。 |
| FR-5 | 合併後跑 `tests/release-check.test.js`；`ui-gate-run --check --json` 若 `triggered` 再跑 `verify:ui`。 |
| FR-6 | 邏輯／版本檔衝突或會改變已審查行為 → `BLOCKED` + diff 摘要。 |

## 驗收（Given / When / Then）

| Given | When | Then |
|-------|------|------|
| fixture 雙 checklist hunk | `resolve-docs` | 無 conflict marker；兩條勾選皆保留 |
| `spi-spc.html` 在 UU 清單 | `classify` | `category: logic_blacklist`；resolver 不寫檔 |
| 分支落後 main、無衝突 | `pr-merge-sync --sync` | merge 成功；無 `UU` |
| 僅 simple_docs 已解 | 驗證階梯 | `release-check.test` exit 0 |

## 操作入口

```bash
node tools/pr-merge-sync.mjs --check-json
node tools/pr-merge-sync.mjs --dry-run
node tools/pr-merge-sync.mjs --sync
npm run pr:merge-check
npm run pr:merge-sync
```

正本路徑表與演算法與 `tools/merge-conflict-classify.mjs` 內 `BLACKLIST`／`DOCS_WHITELIST` 同步。