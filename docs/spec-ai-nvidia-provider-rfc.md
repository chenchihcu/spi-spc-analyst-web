# RFC-SPI-AI-NVIDIA-20261112：AI 分析新增 NVIDIA 免費帳號與即時模型清單

**文件編號**：RFC-SPI-AI-NVIDIA-20261112
**狀態**：已實作於 v10.23.0。NVIDIA 上游呼叫尚未以真實金鑰驗證（見 §9）。
**範圍**：在現行自帶金鑰架構上新增第三個服務商；不含 [spec-ai-provider-governance-rfc.md](./spec-ai-provider-governance-rfc.md) 的金鑰加密、帳本與全站配額。

---

## 1. Summary

使用者有 NVIDIA 免費開發者帳號（build.nvidia.com，金鑰 `nvapi-…`），希望用它跑 AI 診斷。NVIDIA 的託管 API 與 OpenAI Chat Completions 相容，可沿用既有服務商型錄。NVIDIA 的免費模型常新增、更換與下架，寫死的模型選單很快過時，因此模型選單改由帳號當下的清單決定，並提供更新按鈕。

成功條件：使用者在 AI 設定填入 NVIDIA 金鑰、按「更新模型清單」後，選單列出該帳號當下可用的模型，選一個即可產生分析；NVIDIA 模型異動後不需要改版就能跟上。

## 2. Scope

**In scope**

- 型錄正本 `lib/ai-providers.mjs` 新增 `nvidia`，同步到 Worker 與 `spi-spc.html` 的 `AI_PROVIDERS_META`。
- Worker：金鑰標頭 `X-Nvidia-Key`、選用的伺服器金鑰 `NVIDIA_API_KEY`、依服務商決定上游請求欄位。
- 介面：NVIDIA 分段按鈕、金鑰欄位、免費帳號的費用顯示、即時模型清單與更新按鈕。
- 測試與 `release-check` 的 `nvapi-` 機密掃描。

**Out of scope**

- 不改 OpenAI、Antigravity 的預設模型、計價與送出的請求欄位。
- 不改 `validatePayload`、`buildMessages`、`SYSTEM_PROMPT` 與串流格式。
- 不把 NVIDIA 納入 `tools/refresh-ai-catalog.mjs`（免費帳號沒有要刷新的價格，模型清單改由執行期取得）。
- 不新增 D1 migration。用量與配額沿用 `stats`／`system_settings` 的 `ai:nvidia:*`、`ai_limits:nvidia:*` 鍵。
- 不在介面寫出 NVIDIA 的速率或額度數字（每分鐘 40 次與額度點數只在 NVIDIA 論壇由使用者回報，沒有官方數字可引用）。

## 3. User Stories

- 作為有 NVIDIA 免費帳號的品質工程師，我希望填入 `nvapi-` 金鑰就能跑 AI 診斷，不必另外付費。
- 作為同一位使用者，我希望按一下就取得帳號當下可用的模型，NVIDIA 換模型時選單跟著變。
- 作為同一位使用者，我原本選的模型被下架時，希望系統告訴我並改選可用的模型，而不是分析時才失敗。

## 4. Functional Requirements

### 4.1 型錄

- **FR-1.** `AI_PROVIDER_CATALOG` 新增 `id: 'nvidia'`、`label: 'NVIDIA'`、`chatUrl: https://integrate.api.nvidia.com/v1/chat/completions`、`headerKey: 'x-nvidia-key'`、`free: true`、`liveModels: true`。
- **FR-2.** 內建推薦模型 `openai/gpt-oss-120b`（預設）、`openai/gpt-oss-20b`，費率皆為 0。這只是尚未更新清單前的起始內容。
- **FR-3.** 每個服務商有請求設定 `request`：`maxTokensField`、`maxTokens`、`reasoningEffortModels`。既有服務商為 `max_completion_tokens`／16000／`'all'`；NVIDIA 為 `max_tokens`／8192／內建的兩個 gpt-oss 模型。

### 4.2 Worker（`cloudflare/ai.mjs`）

- **FR-4.** 金鑰來源順序與其他服務商相同：`X-Nvidia-Key`（或 `X-AI-Key`）→ `env.NVIDIA_API_KEY` → 無金鑰回 400。只帶 `X-Nvidia-Key`、未帶 `X-AI-Provider` 時判定為 NVIDIA。
- **FR-5.** 上游請求的輸出上限欄位名稱與數值取自 `request`。模型不在 `reasoningEffortModels` 時不送 `reasoning_effort`，回應標頭 `X-AI-Reasoning-Effort` 為 `none`。
- **FR-6.** OpenAI 與 Antigravity 送出的 JSON 欄位與順序不變。
- **FR-7.** 用量計數、配額攔截、`GET ?models=1`、自訂端點檢查沿用既有程式；NVIDIA 的每月美金累計為 0。
- **FR-8.** NVIDIA 回 429 時，失敗訊息加上「免費帳號速率或額度已達上限，請稍後再試或改用其他服務商」。

### 4.3 介面（`spi-spc.html` `#aiSettingsCard`）

- **FR-9.** 服務商分段多一個 NVIDIA；金鑰區多一個 NVIDIA API Key 欄位（`#inAiKeyNvidia`，placeholder `nvapi-...`），有顯示／隱藏按鈕與狀態標籤。金鑰只存 `localStorage` `spi-ai-config`，與其他服務商相同。
- **FR-10.** 免費服務商：計價基準顯示型錄的 `priceText`；每月費用上限欄位停用；每月用量列顯示 tokens 與「免費」，不顯示美金。
- **FR-11.** 所選模型不送 `reasoning_effort` 時，推理強度選單停用，狀態列顯示「模型預設」。

### 4.4 即時模型清單

- **FR-12.** `liveModels` 服務商的 `#btnAiCheckModels` 文字為「更新模型清單」，呼叫既有的 `GET /api/analyze?models=1&provider=nvidia`。
- **FR-13.** 成功後模型選單為：仍在清單內的推薦模型（保留中文標籤）、其餘模型依字母序、「自訂模型名稱…」。不在清單內的推薦模型不顯示。
- **FR-14.** 清單存 `localStorage` `spi-ai-models`，內容只有模型 id 與更新時間，不含金鑰。重新載入後沿用。`#aiModelListNote` 顯示「模型清單更新於 YYYY-MM-DD HH:mm · N 個模型」，尚未更新時顯示「尚未更新模型清單」。
- **FR-15.** 已有金鑰（使用者或伺服器）且清單不存在或超過 24 小時，進入 AI 頁或切到該服務商時自動更新一次；同一組金鑰與端點在同一次頁面載入內只自動嘗試一次。
- **FR-16.** 目前所選模型不在新清單時，改選第一個可用的推薦模型（沒有則為清單第一個），並在 `#aiCfgMsg` 寫出舊模型與新模型。
- **FR-17.** 更新失敗或回傳空清單時保留原清單，`#aiCfgMsg` 顯示原因。
- **FR-18.** 查詢期間使用者換了服務商、金鑰或端點時，清單仍存入，但不改選模型（沿用既有守衛）。
- **FR-19.** OpenAI 與 Antigravity 的「檢查可用模型」行為不變。

## 5. Acceptance Criteria

- **Given** 使用者切到 NVIDIA 且尚未更新清單 **When** 檢視設定 **Then** 按鈕為「更新模型清單」，選單為內建兩個模型加自訂，清單狀態為「尚未更新模型清單」。
- **Given** 已填 NVIDIA 金鑰，上游清單為 `openai/gpt-oss-120b`、`meta/llama-next-70b`、`nvidia/nemotron-new`，目前選 `openai/gpt-oss-20b` **When** 按「更新模型清單」 **Then** 選單為 120b、llama、nemotron、自訂；所選模型改為 120b；訊息含「openai/gpt-oss-20b 已不在清單，已改選 openai/gpt-oss-120b」。
- **Given** 上一條完成 **When** 上游回錯誤後再按一次 **Then** 選單不變，訊息含「模型清單更新失敗」與「沿用上次的清單」。
- **Given** 清單已存在 **When** 重新載入頁面 **Then** 選單與所選模型和重新載入前相同。
- **Given** 清單是 25 小時前的且已填金鑰 **When** 進入 AI 頁 **Then** 自動查詢一次並套用；之後離開再進入不重複查詢。
- **Given** `X-AI-Provider: nvidia` 與 `X-Nvidia-Key` **When** `POST /api/analyze` **Then** 上游網址為 NVIDIA 端點，`Authorization` 為該金鑰，請求含 `max_tokens: 8192`、不含 `max_completion_tokens`。
- **Given** 同上且 `X-AI-Model: meta/llama-next-70b` **When** `POST` **Then** 請求不含 `reasoning_effort`，回應標頭 `X-AI-Reasoning-Effort: none`。
- **Given** OpenAI 或 Antigravity **When** `POST` **Then** 請求欄位依序為 `model, reasoning_effort, max_completion_tokens, stream, stream_options, messages`。
- **Given** NVIDIA 用量 100 萬輸入與 50 萬輸出 tokens **When** `GET /api/analyze?provider=nvidia` **Then** `monthlyUsd` 為 0，OpenAI 與 Antigravity 的用量不變。

## 6. Edge Cases

- **清單含非對話模型**（embedding、影像等）：`/v1/models` 不標用途，全部列出；選到不支援對話的模型時上游回錯誤，訊息照實顯示。
- **模型 id 含斜線**：既有的模型名稱規則 `/^[A-Za-z0-9._:/-]{2,120}$/` 已允許；快取讀出時再以同一規則過濾。
- **快取被清除**：先前從清單選的模型變成自訂模型名稱，仍可使用。
- **自訂端點**：端點不是 `…/chat/completions` 時無法查清單，沿用既有訊息。
- **模型拒收某個欄位**：上游 400 的訊息直接顯示在分析結果，不靜默重試。

## 7. Non-Functional Requirements

- **安全**：金鑰不寫入 repo、D1、模型清單快取或紀錄；`release-check` 掃描 `nvapi-`。伺服器金鑰由管理員以 Worker secret 設定。
- **相容**：既有服務商的設定、用量鍵與請求不變；320px 寬度下設定卡不橫向溢出。
- **效能**：清單查詢只在按鈕或 24 小時自動更新時發生，不在每次分析前查詢。

## 8. Test Plan

- `node --test tests/ai-model.test.mjs tests/ai-nvidia-ui.test.js tests/ai-catalog-refresh.test.mjs tests/mobile-layout.test.mjs tests/ui-copy.test.mjs`
- `npm run release-check`、`npm run build:cloudflare`
- build 產物在 1440／820／390／320 寬度、明亮與深色檢視 AI 設定卡。

## 9. 未驗證事項

實作時沒有 NVIDIA 金鑰，下列項目要等使用者在正式站填入金鑰後確認：

| 項目 | 確認方式 | 不成立時 |
|---|---|---|
| 內建兩個 gpt-oss 模型在免費帳號清單內 | 按「更新模型清單」 | 按鈕自動改選清單內的模型；之後更新型錄預設 |
| NVIDIA 接受 `stream_options.include_usage` | 跑一次分析 | 上游 400 訊息會顯示；改為依服務商決定是否送出 |
| `max_tokens: 8192` 不超過所選模型上限 | 跑一次分析 | 調整 `request.maxTokens` |
| gpt-oss 模型接受 `reasoning_effort` | 跑一次分析 | 把該模型移出 `reasoningEffortModels` |
