// tools/check-spi-syntax.mjs 必須檢查 spi-spc.html 的每個內嵌 script（含 core 與主介面），
// 並在語法錯誤時 exit 1、回報 HTML 的實際行號。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECKER = path.join(ROOT, "tools", "check-spi-syntax.mjs");
const SRC = fs.readFileSync(path.join(ROOT, "spi-spc.html"), "utf8");
const LINES = SRC.split("\n");

// 在暫存目錄放一份 spi-spc.html，從該目錄執行檢查（不帶參數，舊版檢查器也讀得到）
function runOn(html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spi-syntax-"));
  try {
    fs.writeFileSync(path.join(dir, "spi-spc.html"), html);
    return spawnSync(process.execPath, [CHECKER], { cwd: dir, encoding: "utf8" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 回傳 script 開頭標記所在行之後、第一個以縮排程式開頭的行號（1 起算）
function lineInside(openTag) {
  const start = LINES.findIndex((l) => l.startsWith(openTag) && l.trim() === openTag);
  assert.ok(start >= 0, `找不到 ${openTag}`);
  for (let i = start + 5; i < LINES.length; i++) if (/^\s*(const|let|var|function)\b/.test(LINES[i])) return i + 1;
  assert.fail(`${openTag} 內找不到可插入的行`);
}

function breakAt(lineNo) {
  const ls = LINES.slice();
  ls[lineNo - 1] = "const = ;" + ls[lineNo - 1];
  return ls.join("\n");
}

test("check-spi-syntax：目前的 spi-spc.html 通過且回報 exit 0", () => {
  const r = runOn(SRC);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /OK/);
});

for (const [name, tag] of [["core script", '<script id="core">'], ["主介面 script", "<script>"]]) {
  test(`check-spi-syntax：${name} 有語法錯誤時 exit 1 並回報實際行號`, () => {
    const ln = lineInside(tag);
    const r = runOn(breakAt(ln));
    assert.equal(r.status, 1, `應 exit 1，實際 ${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, new RegExp(`spi-spc\\.html:${ln}\\b`), r.stderr);
  });
}
