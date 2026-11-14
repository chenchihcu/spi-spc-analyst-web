@AGENTS.md

## 雲端工作階段（Claude Code web／iPhone）

只適用於沒有 `C:/` 的 Linux 雲端容器；本機工作階段略過本節。

- **Institution 規則**：`C:/Dropbox/AI_Coding_Agent_Governance/Institution/<檔名>` 在雲端對應 GitHub `chenchihcu/institution-governance` 的同名檔。上下文沒有載入驗證碼 `INST-CORE-*` 時，先看 `../institution-governance/` 是否存在；不存在就用 `add_repo`（read）附加並 clone，再讀 `00-core-rules.md`，UI/UX 工作加讀 `06-ui-ux-universal.md`。附加失敗時回報「Institution 核心規則未載入」，不憑記憶引用條文。
- **只在本機的檔案**：`C:/Users/user/.codex/*`（如 `website-ship.md`、`workgit.ps1`）與 `~/.agents/skills` 的共享技能不在雲端。規則或技能指到它們時，回報名稱與「雲端不可用」，不推測內容。
- **技能**：動手前對照可用技能清單，描述符合就以 Skill 工具載入。專案技能在 `.claude/skills/`（正本 `.agents/skills/`）。
