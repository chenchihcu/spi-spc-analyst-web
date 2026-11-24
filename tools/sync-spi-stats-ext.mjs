import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = join(root, "spi-spc.html");
const libPath = join(root, "lib", "spi-stats-ext.mjs");

const START = "/* @spi-stats-ext START */";
const END = "/* @spi-stats-ext END */";

function stripModuleExports(src) {
  return src
    .replace(/^export const /gm, "const ")
    .replace(/^export function /gm, "function ")
    .replace(/^export \{[\s\S]*?\};?\s*$/m, "");
}

export async function syncSpiStatsExt() {
  const lib = await readFile(libPath, "utf8");
  const body = stripModuleExports(lib).trim();
  const html = await readFile(htmlPath, "utf8");
  const block = `${START}\n${body}\n${END}`;
  if (!html.includes(START) || !html.includes(END)) {
    throw new Error("spi-spc.html 缺少 @spi-stats-ext 標記");
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const next = html.replace(new RegExp(`${esc(START)}[\\s\\S]*?${esc(END)}`), block);
  await writeFile(htmlPath, next);
  return { bytes: Buffer.byteLength(body) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { bytes } = await syncSpiStatsExt();
  console.log(`Synced spi-stats-ext into spi-spc.html (${bytes} bytes)`);
}
