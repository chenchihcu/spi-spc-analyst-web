// 驗證「測試真的會抓到錯」：對 spi-spc.html 逐一套用一個故意的破壞（mutation），
// 跑指定測試檔，期望變紅；跑完一律還原原檔。任何一項仍是綠燈，代表那個測試沒有鑑別力，需要加強。
// 用法：node tools/mutation-check.mjs [mutations.json]
//   預設使用 tests/fixtures/mutations-component-scope.json
//   檔案格式：{ "test": "tests/xxx.test.mjs", "mutations": [{ "name", "from", "to" }] }，from 必須在原檔中恰好出現一次
// 結束碼：全部變紅 0；有綠燈、樣式不唯一或執行錯誤 1
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "spi-spc.html");
const specFile = path.resolve(ROOT, process.argv[2] || "tests/fixtures/mutations-component-scope.json");
const { test, mutations } = JSON.parse(readFileSync(specFile, "utf8"));
const orig = readFileSync(HTML, "utf8");
let bad = 0;

const restore = () => writeFileSync(HTML, orig);
process.on("SIGINT", () => { restore(); process.exit(130); });
try {
  for (const m of mutations) {
    const hits = orig.split(m.from).length - 1;
    if (hits !== 1) { bad++; console.log(`✗ ${m.name}: 樣式出現 ${hits} 次（需恰好 1 次）`); continue; }
    writeFileSync(HTML, orig.replace(m.from, m.to));
    const r = spawnSync(process.execPath, ["--test", test], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 30 });
    if (r.error) { bad++; console.log(`✗ ${m.name}: 執行錯誤 ${r.error.message}`); continue; }
    const failed = Number((r.stdout.match(/^# fail (\d+)/m) || [])[1] || 0);
    const which = [...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((x) => x[1]);
    if (failed > 0) console.log(`✓ ${m.name}: 紅燈（${failed}）${which.join(" | ")}`);
    else { bad++; console.log(`✗ ${m.name}: 仍是綠燈，測試沒有抓到`); }
  }
} finally { restore(); }
if (readFileSync(HTML, "utf8") !== orig) { console.error("還原失敗：spi-spc.html 與原檔不同"); process.exit(2); }
console.log(bad ? `\n${bad} 項未通過` : `\n全部 ${mutations.length} 項皆被測試抓到`);
process.exit(bad ? 1 : 0);
