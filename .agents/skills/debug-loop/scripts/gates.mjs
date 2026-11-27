#!/usr/bin/env node
// debug-loop 關卡選擇與執行器。
// 依「本次改了哪些檔、改了哪些關鍵字」挑出 AGENTS.md 規定的檢查，依驗證失效階梯 V0→V3 由快到慢執行，
// 並以「HEAD + 工作樹內容」指紋記錄結果：同一份內容已通過的關卡不重跑（AGENTS.md「驗證避免重複」）。
//
// 用法（在 repo 根目錄）：
//   node .agents/skills/debug-loop/scripts/gates.mjs plan [--base <ref>] [--level V0|V1|V2|V3] [--json]
//   node .agents/skills/debug-loop/scripts/gates.mjs run  [--base <ref>] [--level V0|V1|V2|V3] [--only id,id] [--force] [--keep-going] [--json]
//   node .agents/skills/debug-loop/scripts/gates.mjs status [--json]
// 結束碼：0 全部通過（含沿用）；1 有關卡失敗；2 用法錯誤；3 沒有失敗但有 blocked／not-run（不得宣稱完成）。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const IS_WIN = process.platform === "win32";
const LEVELS = ["V0", "V1", "V2", "V3"];

// ---------- 參數 ----------
const [cmd, ...rest] = process.argv.slice(2);
const opt = { base: null, level: null, only: null, force: false, keepGoing: false, json: false };
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === "--base") opt.base = rest[++i];
  else if (a === "--level") opt.level = String(rest[++i] || "").toUpperCase();
  else if (a === "--only") opt.only = String(rest[++i] || "").split(",").filter(Boolean);
  else if (a === "--force") opt.force = true;
  else if (a === "--keep-going") opt.keepGoing = true;
  else if (a === "--json") opt.json = true;
  else usage(`未知參數 ${a}`);
}
if (!["plan", "run", "status"].includes(cmd)) usage();
if (opt.level && !LEVELS.includes(opt.level)) usage(`--level 只接受 ${LEVELS.join("/")}`);
if (!existsSync(path.join(ROOT, "spi-spc.html")) || !existsSync(path.join(ROOT, "AGENTS.md"))) usage("請在 spi-spc-analyst-web 的 repo 根目錄執行");

function usage(msg) {
  if (msg) console.error(msg);
  console.error("用法：gates.mjs plan|run|status [--base <ref>] [--level V0..V3] [--only id,id] [--force] [--keep-going] [--json]");
  process.exit(2);
}

// ---------- git ----------
const git = (...args) => {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 30 });
  return r.status === 0 ? r.stdout : null;
};
function resolveBase() {
  if (opt.base) {
    if (git("rev-parse", "--verify", "--quiet", opt.base) === null) usage(`找不到 base ${opt.base}`);
    return opt.base;
  }
  // 先更新 origin/main（失敗就沿用本機的），避免過期的 origin/main 把已合併的提交算成本次變更
  spawnSync("git", ["fetch", "--quiet", "origin", "main"], { cwd: ROOT, timeout: 60000 });
  const mb = git("merge-base", "HEAD", "origin/main");
  return mb ? mb.trim() : "HEAD";
}
function changedFiles(base) {
  const tracked = (git("diff", "--name-only", base) || "").split("\n");
  const untracked = (git("ls-files", "--others", "--exclude-standard") || "").split("\n");
  return [...new Set([...tracked, ...untracked].map((s) => s.trim().replace(/\\/g, "/")).filter(Boolean))].sort();
}
function htmlDiffLines(base) {
  const d = git("diff", "--unified=0", base, "--", "spi-spc.html") || "";
  return d.split(/\r?\n/).filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l)).join("\n");
}
// 指紋＝HEAD＋相對 HEAD 的差異＋未追蹤檔內容。內容不變，指紋就不變；commit／push 本身不改指紋語意。
function fingerprint() {
  const h = createHash("sha256");
  h.update(git("rev-parse", "HEAD") || "no-head");
  h.update(git("diff", "HEAD", "--binary") || "");
  for (const f of (git("ls-files", "--others", "--exclude-standard") || "").split("\n").filter(Boolean)) {
    h.update(f);
    try { h.update(readFileSync(path.join(ROOT, f))); } catch { h.update("unreadable"); }
  }
  return h.digest("hex").slice(0, 16);
}

// ---------- 規則：檔案／關鍵字 → 測試與關卡（出處見 AGENTS.md 各條「檢查」） ----------
// 每條：{ id, why, files?: RegExp（比對變更檔路徑）, html?: RegExp（比對 spi-spc.html 增刪行）, tests?: [], gates?: [], level }
const RULES = [
  { id: "scope", why: "分析範圍一致（scopeFilter／scopedFindings…）", html: /scopeFilter|inScopeS|scopedFindings|scopedDfmTable|issueScope|issueList|issueBoardList|issueCaseRows|\bsc\.(own|board)\b|normalizeScope|SCOPE_PANELS|SCOPE_BOARD_CARDS|compKeyOf|anKey|preSet/, tests: ["tests/component-scope.test.mjs"], gates: ["mutation"], level: "V2" },
  { id: "detect", why: "偵測規則／統計門檻（誤報率需 test:slow 校準）", html: /detectIssues|verdict|[Cc]pk|[Mm]oran|FastMCD|\bmcd|robust[Zz]|LISA|threshold/, tests: ["tests/golden.test.mjs", "tests/spi-audit-fixes.test.mjs", "tests/issue-detection-audit.test.mjs", "tests/stats.test.js"], gates: ["slow"], level: "V2" },
  { id: "toplist", why: "清單字串膨脹守衛 topList", html: /topList|\.join\("; "\)/, tests: ["tests/spi-audit-fixes.test.mjs"], level: "V1" },
  { id: "pos3d", why: "3D 座標優先序與虛擬網格揭露", html: /pos3D|gridPos|realXY|componentX|componentY|grid3dWarn|geomAssumed/, tests: ["tests/step8.test.mjs", "tests/reverse-traceability-5000.test.mjs", "tests/sim3d-realism.test.mjs"], level: "V1" },
  { id: "layout", why: "版面／CSS（44px 觸控、minmax、canvas 尺寸、深色 token、字級字重）", html: /@media|minmax|min-width|min-height|font-size|font-weight|pointer:\s*coarse|devicePixelRatio|getBoundingClientRect|--[a-z][\w-]*:/, tests: ["tests/mobile-layout.test.mjs", "tests/iphone-duo-layout.test.mjs", "tests/type-scale.test.mjs"], gates: ["ui"], level: "V2" },
  { id: "copy", why: "使用者可見中文文案", html: /[一-鿿]/, tests: ["tests/ui-copy.test.mjs"], level: "V1" },
  { id: "plaintext", why: "純文字節點不得含 HTML", html: /textContent|subgroupWarning|ctrlSub/, tests: ["tests/spi-audit-fixes.test.mjs"], level: "V1" },
  { id: "export", why: "匯出（Markdown／CSV／XLSX）", html: /issuesMd|[Xx]lsx|OpenXML|[Cc]sv|export/i, tests: ["tests/step14.test.mjs", "tests/data-export-defects.test.mjs", "tests/xlsx.test.mjs"], level: "V1" },
  { id: "version", why: "版本與建置時間", html: /appVer|appBuilt/, files: /^(package\.json|lib\/version\.mjs|CHANGELOG\.md)$/, tests: ["tests/build-info.test.mjs", "tests/release-check.test.js"], level: "V1" },
  { id: "records", why: "雲端紀錄 fail-closed（RecDB／LocalRec）", html: /RecDB|LocalRec|mode\s*!==?\s*"cloud"/, tests: ["tests/records.test.mjs", "tests/records-ui.test.mjs"], gates: ["ui"], level: "V2" },
  { id: "perf", why: "效能（5 萬筆 analyze／detectIssues <3 秒）", html: /function analyze|analyze\(|perf|cache/i, tests: ["tests/core.test.js", "tests/perf-cache.test.mjs"], level: "V1" },
  { id: "worker", why: "Worker／API／登入（含資料庫路徑）", files: /^(cloudflare\/[^/]+\.mjs|lib\/(auth|records|repo|share|security)[^/]*\.mjs|netlify\/)/, gates: ["ui"], level: "V2" },
  { id: "migration", why: "D1 migration 需先備份、本機演練、使用者核准", files: /^cloudflare\/migrations\//, gates: ["migration"], level: "V3" },
  { id: "mutation-tool", why: "mutation 工具或 fixture 變更", files: /^(tools\/mutation-check\.mjs|tests\/fixtures\/mutations-)/, gates: ["mutation"], level: "V2" },
  { id: "deploy-verify", why: "部署判讀工具", files: /^tools\/deploy-verify\.mjs$/, tests: ["tests/deploy-verify.test.mjs"], level: "V1" },
  { id: "merge-conflict", why: "PR merge 分類與 docs 自癒", files: /^tools\/(merge-conflict|pr-merge)/, tests: ["tests/merge-conflict-resolve.test.mjs"], level: "V0" },
  { id: "global", why: "相依、建置、CI 或 Worker 設定：影響面廣", files: /^(package(-lock)?\.json|wrangler[^/]*\.jsonc?|tools\/(build-cloudflare|release-check)[^/]*|\.github\/|tests\/_load\.js|tests\/_cloud-harness\.mjs|vendor\/)/, level: "V3" },
];

// ---------- 關卡定義 ----------
const npm = (...a) => ({ bin: IS_WIN ? "npm.cmd" : "npm", args: a, shell: IS_WIN });
const py = () => {
  for (const c of IS_WIN ? ["python", "py"] : ["python3", "python"]) if (spawnSync(c, ["--version"]).status === 0) return c;
  return null;
};
const SYNTAX_CHECK = `
const vm = require("vm");
const h = require("fs").readFileSync("spi-spc.html", "utf8");
let n = 0, bad = 0;
for (const m of h.matchAll(/<script(\\s[^>]*)?>([\\s\\S]*?)<\\/script>/g)) {
  const attrs = m[1] || "";
  if (/\\bsrc=/.test(attrs) || (/\\btype=/.test(attrs) && !/type="(text|application)\\/javascript"/.test(attrs))) continue;
  n++;
  const bodyStart = m.index + m[0].indexOf(">") + 1;
  const lineOffset = h.slice(0, bodyStart).split("\\n").length - 1;
  try { new vm.Script(m[2], { filename: "spi-spc.html", lineOffset }); }
  catch (e) {
    bad++;
    const at = (String(e.stack).match(/spi-spc\\.html:(\\d+)/) || [])[1] || "?";
    console.error("語法錯誤：<script" + attrs + "> spi-spc.html 第 " + at + " 行：" + e.message);
  }
}
console.log(bad ? bad + " 個 script 有語法錯誤" : "OK：" + n + " 個內嵌 script 皆可解析");
process.exit(bad ? 1 : 0);
`;
const GATES = {
  // 不用 tools/check-spi-syntax.mjs：它只檢查第一個無屬性的 <script>（184 字的回退程式），core 與主介面程式都沒檢查到
  syntax: { level: "V0", title: "主檔全部內嵌 script 語法", run: () => ({ bin: process.execPath, args: ["-e", SYNTAX_CHECK] }) },
  scans: { level: "V0", title: "發布掃描（除錯殘留、機密、版本）", run: () => npm("run", "release-check:scans"), judge: (r) => (r.code === 0 ? "pass" : "fail") },
  smoke: { level: "V1", title: "SPA 啟動 smoke", run: () => ({ bin: process.execPath, args: ["--test", "--test-concurrency=1", "--test-reporter=tap", "tests/ui.smoke.test.js"] }) },
  focused: { level: "V1", title: "聚焦測試", run: (ctx) => ({ bin: process.execPath, args: ["--test", "--test-concurrency=1", "--test-reporter=tap", ...ctx.tests] }) },
  mutation: { level: "V2", title: "mutation-check（測試鑑別力）", run: () => ({ bin: process.execPath, args: ["tools/mutation-check.mjs"] }) },
  slow: { level: "V2", title: "test:slow 完整穩定製程模擬", run: () => npm("run", "test:slow") },
  ui: {
    level: "V2", title: "verify-spi-spc 實際畫面流程",
    precheck: () => {
      const p = py();
      if (!p) return "找不到 python";
      if (spawnSync(p, ["-c", "import playwright, psutil"]).status !== 0) return "python 缺 playwright／psutil（見 .agents/environment.json 的 install）";
      if (!existsSync(path.join(ROOT, "node_modules/wrangler/bin/wrangler.js"))) return "缺 node_modules/wrangler（先 npm ci）";
      return null;
    },
    run: () => ({ bin: py(), args: ["-B", ".agents/skills/verify-spi-spc/scripts/verify.py", "all"] }),
  },
  release: { level: "V3", title: "release-check（含完整 npm test 與掃描）", run: () => npm("run", "release-check"), judge: (r) => { const m = r.out.match(/Overall: (READY|NEEDS REVIEW|BLOCKED|SCAN ONLY)/); if (r.code !== 0 || !m || m[1] === "BLOCKED") return "fail"; return m[1] === "NEEDS REVIEW" ? "review" : "pass"; } },
  build: { level: "V3", title: "build:cloudflare", run: () => npm("run", "build:cloudflare"), judge: (r) => (r.code === 0 && !/Unexpected deploy asset/.test(r.out) ? "pass" : "fail") },
  dryrun: { level: "V3", title: "wrangler deploy --dry-run", run: () => ({ bin: IS_WIN ? "npx.cmd" : "npx", args: ["wrangler", "deploy", "--dry-run"], shell: IS_WIN }) },
  migration: { level: "V3", title: "D1 migration 核准", blocked: "新增 migration：先 `npx wrangler d1 migrations list spi-spc --remote`、repo 外備份、本機演練，經使用者核准後才可套用" },
};

// ---------- 規劃 ----------
function plan() {
  const base = resolveBase();
  const files = changedFiles(base);
  const htmlChanged = files.includes("spi-spc.html");
  const diff = htmlChanged ? htmlDiffLines(base) : "";
  const hits = RULES.filter((r) => (r.files && files.some((f) => r.files.test(f))) || (r.html && htmlChanged && r.html.test(diff)));
  const tests = new Set();
  const gates = new Set();
  let level = files.length ? "V0" : null;
  const raise = (l) => { if (!level || LEVELS.indexOf(l) > LEVELS.indexOf(level)) level = l; };
  for (const r of hits) { (r.tests || []).forEach((t) => tests.add(t)); (r.gates || []).forEach((g) => gates.add(g)); raise(r.level); }

  // 被改到的測試檔本身
  for (const f of files) if (/^tests\/[^/]+\.test\.(m?js)$/.test(f) && existsSync(path.join(ROOT, f))) { tests.add(f); raise("V1"); }
  // 引用被改模組的測試（以 import 路徑比對，免維護對照表）
  const testFiles = (git("ls-files", "tests") || "").split("\n").filter((f) => /\.test\.m?js$/.test(f));
  for (const f of files.filter((f) => /^(lib|cloudflare|netlify|tools)\/.+\.(m?js)$/.test(f))) {
    const needle = f.replace(/\.(m?js)$/, "");
    for (const t of testFiles) {
      try { if (readFileSync(path.join(ROOT, t), "utf8").includes(needle)) { tests.add(t); raise("V1"); } } catch {}
    }
  }
  const notes = [];
  if (htmlChanged) {
    gates.add("syntax"); gates.add("smoke"); raise("V1");
    // 主檔有改但沒有任何關鍵字規則命中：影響範圍判斷不出（impact oracle 弱）→ V3
    if (!hits.some((r) => r.html)) { raise("V3"); notes.push("spi-spc.html 變更未命中任何影響規則，影響範圍不明，升 V3 跑完整套件"); }
  }
  if (files.some((f) => /^(lib|cloudflare|netlify)\//.test(f)) && tests.size === 0) { raise("V3"); notes.push("後端程式變更找不到直接測試，升 V3"); }
  if (files.length > 5) { raise("V3"); notes.push(`變更檔 ${files.length} 個（>5，Institution 01 視為 L3）`); }

  const eff = opt.level && (!level || LEVELS.indexOf(opt.level) > LEVELS.indexOf(level)) ? opt.level : level;
  if (eff === "V3") ["release", "slow", "build", "dryrun"].forEach((g) => gates.add(g));
  // 主檔有改時，V3 一併跑 mutation-check：關鍵字規則可能漏掉範圍讀取端，完整套件綠燈不代表測試有鑑別力
  if (eff === "V3" && htmlChanged) gates.add("mutation");
  if (eff && eff !== "V3") gates.add("scans"); // V3 的 release-check 已含掃描，不重複
  if (tests.size) gates.add("focused");
  let ordered = Object.keys(GATES).filter((g) => gates.has(g) && LEVELS.indexOf(GATES[g].level) <= LEVELS.indexOf(eff || "V0"));
  if (opt.only) ordered = ordered.filter((g) => opt.only.includes(g));
  return { base, files, rules: hits.map((r) => ({ id: r.id, why: r.why, level: r.level })), recommended: level, level: eff, tests: [...tests].sort(), gates: ordered, notes };
}

// ---------- 紀錄 ----------
const STATE_DIR = path.join(IS_WIN ? (process.env.LOCALAPPDATA || os.homedir()) : (process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")), "spi-spc-debug-loop");
const LEDGER = path.join(STATE_DIR, "ledger.json");
const loadLedger = () => { try { return JSON.parse(readFileSync(LEDGER, "utf8")); } catch { return { runs: [] }; } };
const saveLedger = (l) => { mkdirSync(STATE_DIR, { recursive: true }); l.runs = l.runs.slice(-200); writeFileSync(LEDGER, JSON.stringify(l, null, 2)); };
const gateKey = (g, p) => (g === "focused" ? `focused:${p.tests.join(",")}` : g);

function exec(spec) {
  const t0 = Date.now();
  const r = spawnSync(spec.bin, spec.args, { cwd: ROOT, encoding: "utf8", shell: !!spec.shell, maxBuffer: 1 << 30, env: process.env });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  return { code: r.status ?? (r.error ? 127 : 1), out, ms: Date.now() - t0, error: r.error?.message };
}
// 失敗摘要：node --test（TAP）時列出失敗的測試名稱與錯誤訊息；其他輸出取尾段
function tail(s, n = 25) {
  const lines = s.split(/\r?\n/);
  const picked = [];
  lines.forEach((l, i) => {
    if (!/^\s*not ok \d+ - /.test(l)) return;
    picked.push(l.trim());
    const next = lines.slice(i + 1, i + 30);
    next.forEach((x, j) => {
      if (/^\s*(error|expected|actual|location):/.test(x)) {
        const v = /:\s*[|>]-?\s*$/.test(x) ? `${x.trim()} ${(next[j + 1] || "").trim()}` : x.trim();
        picked.push(`  ${v.length > 300 ? `${v.slice(0, 300)}…` : v}`);
      }
    });
  });
  const summary = lines.filter((l) => /^# (tests|pass|fail) \d+/.test(l)).map((l) => l.trim());
  if (picked.length) return [...picked.slice(0, 60), ...summary].join("\n");
  return lines.filter((l) => l.trim()).slice(-n).join("\n");
}

// ---------- 指令 ----------
const unmerged = (git("diff", "--name-only", "--diff-filter=U") || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
if (unmerged.length && cmd === "run") {
  const msg = `未解決的 merge 衝突（UU，${unmerged.length} 檔）。先 node tools/pr-merge-sync.mjs --dry-run 或 --sync`;
  if (opt.json) console.log(JSON.stringify({ overall: "INCOMPLETE", blocked: "pr-merge-clean", unmerged }, null, 2));
  else {
    console.error(msg);
    for (const f of unmerged) console.error(`  · ${f}`);
  }
  process.exit(3);
}

if (cmd === "status") {
  const l = loadLedger(), fp = fingerprint();
  const cur = l.runs.filter((r) => r.fingerprint === fp);
  const res = { stateDir: STATE_DIR, fingerprint: fp, head: (git("rev-parse", "HEAD") || "").trim(), current: cur.map(({ gate, key, status, ms, at }) => ({ gate, key, status, ms, at })) };
  if (opt.json) console.log(JSON.stringify(res, null, 2));
  else { console.log(`指紋 ${fp}（HEAD ${res.head.slice(0, 12)}）｜紀錄 ${LEDGER}`); for (const r of res.current) console.log(`  [${r.status}] ${r.key}  ${Math.round(r.ms / 1000)}s  ${r.at}`); if (!cur.length) console.log("  目前內容尚無關卡紀錄"); }
  process.exit(0);
}

const p = plan();
if (cmd === "plan") {
  if (opt.json) console.log(JSON.stringify(p, null, 2));
  else {
    console.log(`base ${p.base.slice(0, 12)}｜變更檔 ${p.files.length}｜建議層級 ${p.recommended || "無變更"}｜執行層級 ${p.level || "-"}`);
    for (const f of p.files) console.log(`  · ${f}`);
    if (p.rules.length) { console.log("命中規則："); for (const r of p.rules) console.log(`  - ${r.id}（${r.level}）${r.why}`); }
    if (p.tests.length) console.log(`聚焦測試：${p.tests.join(" ")}`);
    console.log(`關卡：${p.gates.map((g) => `${g}(${GATES[g].level})`).join(" → ") || "無"}`);
    for (const n of p.notes) console.log(`註：${n}`);
  }
  process.exit(0);
}

// run
if (!p.gates.length) { console.log(p.files.length ? "沒有符合層級的關卡" : "沒有變更：先用 --level 指定要跑的層級（例如巡檢用 --level V3）"); process.exit(p.files.length ? 0 : 2); }
const ledger = loadLedger();
const fp = fingerprint();
const head = (git("rev-parse", "HEAD") || "").trim();
const results = [];
let stopLevel = null;
for (const g of p.gates) {
  const def = GATES[g], key = gateKey(g, p);
  if (stopLevel && LEVELS.indexOf(def.level) > LEVELS.indexOf(stopLevel)) { results.push({ gate: g, key, status: "not-run", reason: `較低層級 ${stopLevel} 已失敗，先修再跑` }); continue; }
  if (def.blocked) { results.push({ gate: g, key, status: "blocked", reason: def.blocked }); continue; }
  const pre = def.precheck?.();
  if (pre) { results.push({ gate: g, key, status: "not-run", reason: pre }); continue; }
  const prev = !opt.force && ledger.runs.findLast?.((r) => r.key === key && r.fingerprint === fp && (r.status === "pass" || r.status === "review"));
  // 沿用時保留 release-check 的 NEEDS REVIEW：不能因為沒重跑就把需要判讀的警告變成 PASS
  if (prev) { results.push({ gate: g, key, status: "reused", review: prev.status === "review", tail: prev.status === "review" ? prev.tail : undefined, reason: `同一內容已於 ${prev.at} 通過（${prev.status}）` }); continue; }
  if (!opt.json) process.stdout.write(`▶ ${g}（${def.title}）… `);
  const r = exec(def.run({ tests: p.tests }));
  const status = def.judge ? def.judge(r) : r.code === 0 ? "pass" : "fail";
  const rec = { gate: g, key, status, ms: r.ms, at: new Date().toISOString(), fingerprint: fp, head, tail: tail(r.out), error: r.error };
  ledger.runs.push(rec); saveLedger(ledger);
  results.push(rec);
  if (!opt.json) console.log(`${status}（${Math.round(r.ms / 1000)}s）`);
  if (status === "fail" && !opt.keepGoing) stopLevel = def.level;
}
const anyFail = results.some((r) => r.status === "fail");
const incomplete = results.some((r) => r.status === "blocked" || r.status === "not-run");
const needsReview = (r) => r.status === "review" || r.review;
const overall = anyFail ? "FAIL" : incomplete ? "INCOMPLETE" : results.some(needsReview) ? "PASS_WITH_REVIEW" : "PASS";
const summary = { overall, fingerprint: fp, head, level: p.level, files: p.files, tests: p.tests, results: results.map((r) => ({ gate: r.gate, status: r.status, review: r.review || undefined, ms: r.ms, reason: r.reason, tail: r.status === "fail" || needsReview(r) ? r.tail : undefined })), ledger: LEDGER };
if (opt.json) console.log(JSON.stringify(summary, null, 2));
else {
  console.log(`\n整體：${overall}｜指紋 ${fp}｜HEAD ${head.slice(0, 12)}｜層級 ${p.level}`);
  for (const r of summary.results) {
    console.log(`  [${r.status}] ${r.gate}${r.reason ? `：${r.reason}` : ""}`);
    if (r.tail) console.log(r.tail.split("\n").map((l) => `      ${l}`).join("\n"));
  }
  if (overall === "PASS_WITH_REVIEW") console.log("release-check 為 NEEDS REVIEW：逐項讀警告並寫下判讀，不得寫成 READY");
}
process.exit(anyFail ? 1 : incomplete ? 3 : 0);
