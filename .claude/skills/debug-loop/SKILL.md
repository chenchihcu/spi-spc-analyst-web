---
name: debug-loop
description: "SPI·SPC 分析台的除錯迴圈：組合 code-review、bug-fixer、security-review、verify-spi-spc 等技能成一棵技能樹，反覆「找問題 → 修正 → 依失效階梯驗證 → 再找一輪」，直到在已驗證範圍內找不到問題，或碰到停止條件為止。Use whenever 使用者說「除錯到沒問題」「一直修到全綠」「全面找 bug」「巡檢」「幫我把問題都修掉」「debug until clean」，或回報一個症狀並希望修好且確認沒有連帶問題。Do NOT use for 單純問技能清單、只要跑一次發布閘門（用 validate-production-release）、或只要本機畫面驗證（用 verify-spi-spc）。"
---

# 除錯迴圈（debug-loop）入口

這是 Claude Code 的技能入口，讓 debug-loop 出現在技能清單裡。正本在 `.agents/skills/debug-loop/SKILL.md`（專案技能正本統一放 `.agents/skills/`）。

先完整讀取 `.agents/skills/debug-loop/SKILL.md` 並照它做。它引用的腳本與試跑案例都在 `.agents/skills/debug-loop/` 底下，例如 `node .agents/skills/debug-loop/scripts/gates.mjs plan`。不要在這個檔案另寫規則：要改技能，改正本。
