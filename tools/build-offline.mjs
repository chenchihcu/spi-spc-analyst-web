// 離線版：把 spi-spc.html 與 vendor/ 的函式庫、字型、規則檔打包成單一 HTML。
// 產物不連網、不登入：window.SPI_OFFLINE 讓匯入只在記憶體分析、規格只套用到本回合，不寫入雲端。
// 用法：npm run build:offline → dist-offline/spi-spc-offline-v<版本>.html
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { formatBuilt } from './build-time.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 15 * 1024 * 1024; // claude.ai 頁面上限 16 MB，留 1 MB 餘裕

const vendor = (p) => join(root, 'vendor', p);
// 內嵌腳本裡的 "</script" 會提早結束標籤，改成等義的 "<\/script"
const inlineJs = (code) => code.replace(/<\/script/gi, '<\\/script');

function replaceOnce(html, pattern, replacement, label) {
  const hits = html.split(pattern).length - 1;
  if (hits !== 1) throw new Error(`離線打包：${label} 應出現 1 次，實際 ${hits} 次`);
  return html.split(pattern).join(replacement);
}

export async function buildOffline({ out = join(root, 'dist-offline'), now = new Date(), name } = {}) {
  const { APP_VERSION } = await import('../lib/version.mjs');
  let html = await readFile(join(root, 'spi-spc.html'), 'utf8');
  const built = formatBuilt(now);

  const marker = /(id="appBuilt">)[^<]*(<)/;
  if (!marker.test(html)) throw new Error('spi-spc.html 找不到 #appBuilt，無法注入更新時間');
  html = html.replace(marker, `$1${built}$2`);

  // 1) 離線旗標要在任何程式執行前設定
  html = html.replace(/<head>/i, '<head>\n<script>window.SPI_OFFLINE=true</script>');
  if (!html.includes('window.SPI_OFFLINE=true')) throw new Error('離線打包：找不到 <head>');

  // 2) 網頁字型改成 data URI
  const fonts = [...new Set([...html.matchAll(/url\(vendor\/fonts\/([\w.-]+\.woff2)\)/g)].map((m) => m[1]))];
  for (const f of fonts) {
    const b64 = (await readFile(vendor(`fonts/${f}`))).toString('base64');
    html = html.split(`url(vendor/fonts/${f})`).join(`url(data:font/woff2;base64,${b64})`);
  }

  // 3) Chart.js、three.js、jsPDF 直接內嵌；移除 CDN 備援的 document.write
  const [chart, three, jspdf] = await Promise.all([
    readFile(vendor('chart-4.4.1.umd.min.js'), 'utf8'),
    readFile(vendor('three-r128.min.js'), 'utf8'),
    readFile(vendor('jspdf-4.2.1.umd.min.js'), 'utf8'),
  ]);
  const chartTag = '<script src="vendor/chart-4.4.1.umd.min.js"></script>';
  const cdnLine = html.slice(html.indexOf(chartTag) + chartTag.length).match(/^\s*<script>[^\n]*document\.write[^\n]*<\/script>/);
  if (!cdnLine) throw new Error('離線打包：找不到 Chart.js 的 CDN 備援行');
  html = replaceOnce(html, chartTag + cdnLine[0], `<script>${inlineJs(chart)}</script>\n<script>${inlineJs(three)}</script>\n<script>${inlineJs(jspdf)}</script>`, 'Chart.js 載入標籤');

  // 4) PDF 中文字型與製程規則 JSON 內嵌成全域資料
  const [reg, bold, kb] = await Promise.all([
    readFile(vendor('NotoSansTC-400.05938ae2.ttf')),
    readFile(vendor('NotoSansTC-700.a3c0c50b.ttf')),
    readFile(vendor('spi-process-kb-rules.json'), 'utf8'),
  ]);
  JSON.parse(kb);
  const data = `<script>window.SPI_PDF_FONTS={reg:"${reg.toString('base64')}",bold:"${bold.toString('base64')}"};window.SPI_KB_RULES=${inlineJs(kb.trim())};</script>`;
  html = replaceOnce(html, '<script id="core">', `${data}\n<script id="core">`, '核心腳本標籤');

  // 5) 守衛：不可再有外部腳本或 vendor 資源
  const leftovers = [...html.matchAll(/<script[^>]*\ssrc=|url\(vendor\//g)];
  if (leftovers.length) throw new Error(`離線打包：仍有 ${leftovers.length} 個外部資源引用`);
  const bytes = Buffer.byteLength(html);
  if (bytes > MAX_BYTES) throw new Error(`離線打包：產物 ${(bytes / 1048576).toFixed(1)} MB 超過 15 MB`);

  await mkdir(out, { recursive: true });
  const file = join(out, name || `spi-spc-offline-${APP_VERSION}.html`);
  await writeFile(file, html);
  return { file, bytes, built, version: APP_VERSION };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { file, bytes, built } = await buildOffline();
  console.log(`Offline build: ${file} (${(bytes / 1048576).toFixed(2)} MB), built ${built} (UTC+8)`);
}
