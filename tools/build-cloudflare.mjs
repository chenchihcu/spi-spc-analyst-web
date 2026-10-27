import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowed = new Set(['index.html', 'vendor', '_headers']);

// 更新時間一律以台北時間（UTC+8）顯示，與 CHANGELOG 相同格式 YYYY-MM-DD HH:mm:ss
export const formatBuilt = (date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};

// 主頁的 #appBuilt 換成本次 build 時間；登入頁經 package.json 的 #build-info 條件匯入讀同一個值
export async function build({ out = join(root, 'dist'), info = join(root, '.build', 'build-info.mjs'), now = new Date() } = {}) {
  await mkdir(out, { recursive: true });
  const existing = await readdir(out);
  const unexpected = existing.filter((entry) => !allowed.has(entry));
  if (unexpected.length) throw new Error(`Unexpected deploy asset in dist: ${unexpected.join(', ')}`);
  const built = formatBuilt(now);
  const source = await readFile(join(root, 'spi-spc.html'), 'utf8');
  const marker = /(id="appBuilt">)[^<]*(<)/;
  if (!marker.test(source)) throw new Error('spi-spc.html 找不到 #appBuilt，無法注入更新時間');
  const html = source.replace(marker, `$1${built}$2`);
  const { APP_VERSION } = await import('../lib/version.mjs');
  await writeFile(join(out, 'index.html'), html);
  await mkdir(dirname(info), { recursive: true });
  await writeFile(info, `// 由 tools/build-cloudflare.mjs 產生，勿手改\nexport const APP_VERSION = ${JSON.stringify(APP_VERSION)};\nexport const APP_BUILT = ${JSON.stringify(built)};\n`);
  await cp(join(root, 'vendor'), join(out, 'vendor'), { recursive: true, force: true });
  try {
    await cp(join(root, '_headers'), join(out, '_headers'), { force: true });
  } catch {}
  return { built, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { built, bytes } = await build();
  console.log(`Cloudflare assets: index.html, vendor/, _headers (${bytes} HTML bytes), built ${built} (UTC+8)`);
}
