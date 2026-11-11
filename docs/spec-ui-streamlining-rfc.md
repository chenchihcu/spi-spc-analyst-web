# RFC：SPI·SPC 分析台介面精簡與架構整併

**狀態**：已發布（v10.15.7）  
**範圍**：`spi-spc.html` 殼層、導覽路由、資訊架構；不含 `lib/*.mjs` 統計公式、D1、Worker API。

## 目標

| 指標 | 精簡後 |
|---|---|
| 桌機 `≥1280px` `header.top` | 1 列 |
| 桌機 `≥1280px` `.rail` 設定列 | 1 列 |
| 主分頁 | 10：`data, issues, overview, control, capability, sim3d, deep, improve, ai, report` |
| `#p-data` 子分頁 | 4：`import, specs, runs, ai-cfg` |
| `.panel-subnav`（深入／改善） | 各 1 份 |
| 行內重複匯出鈕 | 0（僅匯出中心與報告頁保留項） |

## 路由（Clean-Break）

- 複合頁：`#deep`、`#deep/cross`、`#deep/adv`、`#deep/stats`；`#improve`、`#improve/compare`、`#improve/dfm`、`#improve/lab`。
- 舊 hash `#cross` `#adv` `#stats` `#compare` `#dfm` `#lab` **不**別名，降落 `issues`。
- `detectIssues().go.tab` 仍為 `cross`／`adv`／`dfm`；`goto()` 正規化為複合路由後呼叫 `setTab`。

## 不變量

- `analyze()`、`detectIssues()` 數值與規則輸出不變。
- `RecDB.create` 未登入 fail-closed 不變。
- `docs/spec-ui-copy-rfc.md` 中文標題規範不變。
- `S.duo` 初始字面量與 `iphone-duo-layout.test.mjs` 契約不變。

## 驗收

- `npm test`、`npm run release-check` 通過。
- build 產物五寬度 × 雙主題無橫向溢出；桌機頁首與 rail 單列。
