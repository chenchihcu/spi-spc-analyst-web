// 檢查 HTML 內每個內嵌 JavaScript <script> 的語法（不執行）。
// 用法：node tools/check-spi-syntax.mjs [檔案，預設 spi-spc.html]
// 有任何語法錯誤時以 exit 1 結束，錯誤行號為 HTML 檔的實際行號。
import fs from "node:fs";
import vm from "node:vm";

const file = process.argv[2] || "spi-spc.html";
const h = fs.readFileSync(file, "utf8");
const JS_TYPE = /^\s*(text|application)\/(java|ecma)script\s*$|^\s*module\s*$/i;
let n = 0, bad = 0;
for (const m of h.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  const attrs = m[1] || "";
  if (/\bsrc\s*=/i.test(attrs)) continue;
  const t = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs);
  if (t && t[1] && !JS_TYPE.test(t[1])) continue;
  n++;
  const bodyStart = m.index + m[0].indexOf(">") + 1;
  const before = h.slice(0, bodyStart);
  const lineOffset = before.split("\n").length - 1;
  const columnOffset = bodyStart - (before.lastIndexOf("\n") + 1);
  try {
    new vm.Script(m[2], { filename: file, lineOffset, columnOffset });
  } catch (e) {
    bad++;
    const loc = String(e.stack || "").split("\n")[0];
    console.error(`語法錯誤：<script${attrs}>  ${loc}  ${e.message}`);
  }
}
if (n === 0) {
  console.error(`${file} 找不到內嵌 script`);
  process.exit(1);
}
console.log(bad ? `${bad} / ${n} 個內嵌 script 有語法錯誤` : `OK：${n} 個內嵌 script 皆可解析`);
process.exit(bad ? 1 : 0);
