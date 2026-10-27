// 單板異常穩健 z 小樣本校準表：z = (板平均 − 中位數) / (1.4826 × MAD)，中位數與 MAD 由同一 cell 全部 n 片板（含受測板）計算。
// 固定 |z| ≥ 3.5 依常態尾機率 2(1−Φ(3.5)) ≈ 4.65e-4 只在 n 很大時成立；板數少時 MAD 本身晃動，尾巴很厚
// （i.i.d. 模擬：20 板約名目 14 倍、10 板約 36 倍）。
// 本工具以 i.i.d. 常態模擬，對核心的 robust()（與偵測同一函式）求 |z| 在各尾機率 α 的分位數，
// 產出內嵌於 spi-spc.html 的 ROBZ_N／ROBZ_A／ROBZ_Q 表；另以獨立 seed 的 holdout 自檢每次檢定誤報 ≈ α。
// 用法：node tools/gen-robustz-table.mjs [--points 100000000] [--workers 12] [--output tools/robustz-table.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mulberry32, makeNormal } from './gen-stable.mjs';

const require = createRequire(import.meta.url);

export const ROBZ_TABLE_N = [5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300];
const ALPHA1 = 4.652581580710e-4; // 2(1−Φ(3.5))
export const ROBZ_TABLE_A = [1e-2, 1e-3, ALPHA1, 1e-4, 1e-5, 1e-6];

/* 產生 points 個 |z|（每組 n 個 i.i.d. 常態），只保留 ≥ floor 的值；回傳 {kept, total} */
function zPool(robust, n, points, seed, floor) {
  const N = makeNormal(mulberry32(seed)), runs = Math.ceil(points / n), buf = new Float64Array(n);
  const kept = [];
  for (let k = 0; k < runs; k++) {
    for (let i = 0; i < n; i++) buf[i] = N();
    const { m, s } = robust(buf), inv = 1 / s;
    for (let i = 0; i < n; i++) { const z = Math.abs(buf[i] - m) * inv; if (z >= floor) kept.push(z); }
  }
  return { kept, total: runs * n };
}

function calibrate(n, points) {
  const { loadCore } = require('../tests/_load.js');
  const { robust } = loadCore();
  // 先以小樣本估 1e-2 分位數，主模擬只保留尾端（約 1%），不排序整個母體
  const pilot = zPool(robust, n, 2e6, 500 + n, 0).kept.sort((a, b) => b - a);
  const floor = pilot[Math.floor(pilot.length * ROBZ_TABLE_A[0] * 2)] * 0.9;
  const cal = zPool(robust, n, points, 1000 + n, floor);
  const desc = Float64Array.from(cal.kept).sort().reverse();
  if (desc.length <= Math.floor(cal.total * ROBZ_TABLE_A[0])) throw new Error(`n=${n}：保留的尾端不足以估 α=${ROBZ_TABLE_A[0]} 分位數`);
  const q = ROBZ_TABLE_A.map((a) => desc[Math.floor(cal.total * a)]);
  const hold = zPool(robust, n, points / 2, 7000 + n, Math.min(...q));
  const fp = q.map((thr) => { let c = 0; for (const z of hold.kept) if (z >= thr) c++; return c / hold.total; });
  return { n, q, holdoutFp: fp, tailCount: Math.floor(cal.total * ROBZ_TABLE_A.at(-1)) };
}

if (!isMainThread) {
  parentPort.postMessage(calibrate(workerData.n, workerData.points));
} else if (process.argv[1] && process.argv[1].endsWith('gen-robustz-table.mjs')) {
  const args = process.argv.slice(2);
  const getArg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
  const points = +getArg('--points', 1e8), nW = Math.min(+getArg('--workers', Math.max(1, os.cpus().length - 4)), ROBZ_TABLE_N.length);
  const outPath = getArg('--output', path.join(import.meta.dirname, 'robustz-table.json'));
  const queue = [...ROBZ_TABLE_N].sort((a, b) => a - b), rows = [];
  const runOne = () => new Promise((resolve, reject) => {
    const n = queue.shift(); if (n == null) return resolve();
    const w = new Worker(new URL(import.meta.url), { workerData: { n, points } });
    w.once('message', (r) => {
      rows.push(r);
      console.log(`n=${String(n).padStart(3)} q=[${r.q.map((v) => v.toFixed(2)).join(', ')}] holdout 每次誤報/名目=[${r.holdoutFp.map((f, j) => (f / ROBZ_TABLE_A[j]).toFixed(2)).join(', ')}]（最小 α 尾端 ${r.tailCount} 點）`);
      runOne().then(resolve, reject);
    });
    w.once('error', reject);
  });
  await Promise.all(Array.from({ length: nW }, runOne));
  rows.sort((a, b) => a.n - b.n);
  // 蒙地卡羅雜訊可能讓相鄰格點不單調：同一 α 的分位數隨 n 增加只會下降
  for (let j = 0; j < ROBZ_TABLE_A.length; j++) for (let i = rows.length - 2; i >= 0; i--) rows[i].q[j] = Math.max(rows[i].q[j], rows[i + 1].q[j]);
  for (const r of rows) r.q = r.q.map((v) => +v.toFixed(3));
  const table = { alpha: ROBZ_TABLE_A, points, rows };
  fs.writeFileSync(outPath, JSON.stringify(table, null, 2) + '\n', 'utf8');
  console.log(`Saved table to ${outPath}`);
  console.log(`const ROBZ_N=[${rows.map((r) => r.n).join(',')}];`);
  console.log(`const ROBZ_Q=[${rows.map((r) => `[${r.q.join(',')}]`).join(',')}];`);
}
