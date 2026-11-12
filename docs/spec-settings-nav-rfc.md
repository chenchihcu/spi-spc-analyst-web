# RFC：設定獨立選單

**文件編號**：RFC-SPI-SETTINGS-NAV-20261112  
**版本**：v1.0  
**日期**：2026-11-12  
**狀態**：實作中  
**適用版本**：v10.18.3

區段內容（介面、規格、鋼板、開孔、AI）沿用 [設定 Hub](spec-settings-hub-rfc.md)。本文件只改選單歸屬與深連結。

## 1. Problem Statement & Goals

- **Problem**：設定是「資料與規格」的子分頁。主題、料號規格、鋼板與 AI 金鑰都要先進入匯入頁才能找到。資料頁的工作是匯入與回合。
- **Goals**：
  - 桌面主頁籤在「分析報告」之後出現「設定」。`#p-data` 只留「匯入資料」「回合管理」。
  - `#settings` 與 `#settings/ui|spec|stencil|ai` 開啟設定頁並捲到區段。五張卡片保持可見。
  - 鋼板／規格捷徑、規格閘門、AI 設定按鈕、擦拭連結進入這個頁面。
  - 尚未套用料號規格時，設定頁仍可開啟。
- **Non-goals**：不搬分析列、匯入欄位對應、回合管理。不改 `analyze()`、`detectIssues()`、D1 與 Worker API。不加路由、migration 或 feature flag。手機底欄維持問題、總覽、管制圖、能力、更多。

## 2. System Architecture

- **Components**：
  - `.tabs` 主頁籤新增 `data-tab="settings"`，面板 `#p-settings`。
  - `#p-settings` 頂部區段列（介面、規格、鋼板、AI）只捲動，不隱藏卡片。
  - `#moreSheet`「資料與設定」在「資料與規格」之後加一列「設定」。移除「介面與主題設定」。
  - `setTab`／`parseTabTarget`／`tabHashFor` 處理 `settings` 與區段。`setSub("settings"|"specs"|"stencil"|"ai-cfg")` 轉到設定頁。
- **Data flow**：主題、鋼板、規格、擦拭、AI 金鑰的寫入路徑不變（`localStorage`、回合物件、既有規格 API）。本變更只改哪個面板顯示這些控制項。
- **Sequences**：
  1. 點主頁籤或更多選單的「設定」→ `setTab("settings")` → 顯示 `#p-settings`。
  2. `#railSpecBtn`、閘門「前往設定」、`gotoSpecCard`、擦拭連結 → `setTab("settings/spec")` → 捲到 `#settingsAnchorSpec`。
  3. `#btnGoAiCfg` → `setTab("settings/ai")` → 捲到 `#aiSettingsCard` 並 `initAiPage()`。
  4. 雙欄開啟時，設定頁整頁單欄顯示；離開後雙欄恢復。副欄輪替不含設定。

## 3. Data Model & Interfaces

- **Entities**：無新實體。頁面狀態增加 `S.settingsPane`（`ui`｜`spec`｜`stencil`｜`ai`｜空），只存在本次畫面，不寫入儲存。
- **API contracts**：無新端點。Hash 契約：
  - `#settings`
  - `#settings/ui`、`#settings/spec`、`#settings/stencil`、`#settings/ai`
  - 舊的 `setSub("specs"|"stencil"|"ai-cfg")` 仍打開對應區段。
- **External integrations**：無。

## 4. Security, Performance & Rollout

- **Threat model**：不新增輸入面。AI 金鑰仍在既有密碼欄，只換所在面板。規格閘門的放行清單加入 `settings`，避免未存規格時無法打開規格表。
- **Scaling limits**：多一顆短頁籤，既有頁籤橫向捲動吸收。設定頁維持單欄 `minmax(0,1fr)`。
- **Feature flags**：無。隨 v10.18.3 發布。舊 `setSub` 別名即相容路徑。
