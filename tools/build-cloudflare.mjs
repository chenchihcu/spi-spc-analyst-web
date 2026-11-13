import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { formatBuilt } from './build-time.mjs';
import { buildOffline } from './build-offline.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowed = new Set(['index.html', 'vendor', '_headers', 'offline']);

export { formatBuilt } from './build-time.mjs';

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
  // 離線版單檔：只經 Worker 的 /download/offline（需登入）提供下載。
  // 副檔名用 .bin：Workers 靜態資產會把 .html 路徑轉址成無副檔名網址，ASSETS.fetch 拿不到 200
  await buildOffline({ out: join(out, 'offline'), now, name: 'spi-spc-offline.bin' });
  try {
    await cp(join(root, '_headers'), join(out, '_headers'), { force: true });
  } catch {}
  return { built, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { built, bytes } = await build();
  console.log(`Cloudflare assets: index.html, vendor/, offline/, _headers (${bytes} HTML bytes), built ${built} (UTC+8)`);
}
