// 將 lib/gerber-pads.mjs 同步進 spi-spc.html（包成 GERBER 物件，避免與頁面全域函式撞名）
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = join(root, "spi-spc.html");
const libPath = join(root, "lib", "gerber-pads.mjs");

export const START = "/* @gerber-pads START */";
export const END = "/* @gerber-pads END */";

/** 模組原文 → 頁面內嵌區塊（含起訖標記） */
export function gerberBlock(lib) {
  const names = [...lib.matchAll(/^export (?:const|function) ([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  const body = lib.replace(/^export (const|function) /gm, "$1 ").replace(/\r\n/g, "\n").trim();
  return `${START}\nconst GERBER=(()=>{\n${body}\nreturn {${names.join(",")}};\n})();\n${END}`;
}

export async function syncGerberPads() {
  const lib = await readFile(libPath, "utf8");
  const block = gerberBlock(lib);
  const html = await readFile(htmlPath, "utf8");
  if (!html.includes(START) || !html.includes(END)) throw new Error("spi-spc.html 缺少 @gerber-pads 標記");
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const next = html.replace(new RegExp(`${esc(START)}[\\s\\S]*?${esc(END)}`), () => block);
  if (next !== html) await writeFile(htmlPath, next);
  return { bytes: Buffer.byteLength(block), changed: next !== html };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { bytes, changed } = await syncGerberPads();
  console.log(`${changed ? "Synced" : "Unchanged"} gerber-pads in spi-spc.html (${bytes} bytes)`);
}
