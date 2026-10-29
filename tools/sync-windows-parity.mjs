import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = join(root, "spi-spc.html");
const libPath = join(root, "lib", "windows-parity.mjs");

const START = "/* @windows-parity START */";
const END = "/* @windows-parity END */";

function stripModuleExports(src) {
  return src
    .replace(/^export const /gm, "const ")
    .replace(/^export function /gm, "function ")
    .replace(/^export \{[\s\S]*?\};?\s*$/m, "");
}

export async function syncWindowsParity() {
  const lib = await readFile(libPath, "utf8");
  const body = stripModuleExports(lib).trim();
  const html = await readFile(htmlPath, "utf8");
  const block = `${START}\n${body}\n${END}`;
  if (!html.includes(START) || !html.includes(END)) {
    throw new Error("spi-spc.html 缺少 @windows-parity 標記");
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const next = html.replace(new RegExp(`${esc(START)}[\\s\\S]*?${esc(END)}`), block);
  if (next === html) throw new Error("windows-parity 區塊未更新");
  await writeFile(htmlPath, next);
  return { bytes: Buffer.byteLength(body) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { bytes } = await syncWindowsParity();
  console.log(`Synced windows-parity into spi-spc.html (${bytes} bytes)`);
}
