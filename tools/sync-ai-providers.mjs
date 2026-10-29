import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatAiProvidersMetaObjectLiteral } from '../lib/ai-providers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = join(root, 'spi-spc.html');

const START = '/* @ai-providers-meta START */';
const END = '/* @ai-providers-meta END */';

export async function syncAiProvidersMeta() {
  const html = await readFile(htmlPath, 'utf8');
  if (!html.includes(START) || !html.includes(END)) {
    throw new Error('spi-spc.html 缺少 @ai-providers-meta 標記');
  }
  const body = `const AI_PROVIDERS_META=${formatAiProvidersMetaObjectLiteral()};`;
  const block = `${START}\n${body}\n${END}`;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const next = html.replace(new RegExp(`${esc(START)}[\\s\\S]*?${esc(END)}`), block);
  if (next === html) throw new Error('AI_PROVIDERS_META 區塊未更新');
  await writeFile(htmlPath, next);
  return { bytes: Buffer.byteLength(body) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { bytes } = await syncAiProvidersMeta();
  console.log(`Synced AI_PROVIDERS_META into spi-spc.html (${bytes} bytes)`);
}
