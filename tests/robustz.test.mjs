// M-19 單板異常穩健 z 小樣本校準：內嵌表與 tools/robustz-table.json 一致，門檻隨板數單調、不低於原漸近值，
// 並以 i.i.d. 常態快速抽查每次檢定誤報回到名目值（完整校準與 holdout 見 tools/gen-robustz-table.mjs）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mulberry32, makeNormal } from '../tools/gen-stable.mjs';

const require = createRequire(import.meta.url);
const { loadCore } = require('./_load.js');
const c = loadCore();
const A1 = 2 * (1 - 0.99976737);

test('內嵌 ROBZ 表與 tools/robustz-table.json 一致', () => {
  const t = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'tools', 'robustz-table.json'), 'utf8'));
  const js = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(js(c.ROBZ_A), t.alpha);
  assert.deepEqual(js(c.ROBZ_N), t.rows.map((r) => r.n));
  assert.deepEqual(js(c.ROBZ_Q), t.rows.map((r) => r.q));
});

test('門檻隨板數單調不增、不低於 3.5／5.5，且小樣本明顯高於漸近值', () => {
  let prevT = Infinity, prevB = Infinity;
  for (let n = 5; n <= 400; n++) {
    const zt = c.robZThr(n), zb = c.robZBig(n);
    assert.ok(zt <= prevT + 1e-9 && zb <= prevB + 1e-9, `n=${n} 門檻需單調不增`);
    assert.ok(zt >= 3.5 && zb >= 5.5 && zb > zt, `n=${n} 門檻下限`);
    prevT = zt; prevB = zb;
  }
  assert.ok(c.robZThr(10) > 8 && c.robZThr(20) > 5.3 && c.robZThr(100) < 3.9, '10／20／100 板的校準門檻');
  assert.equal(c.robZp(20, 1000), 0, '超出表格顯示 < 1e-6');
  assert.ok(Math.abs(Math.log(c.robZp(20, c.robZThr(20)) / A1)) < 0.05, '門檻處的校準 p 值 ≈ 2(1−Φ(3.5))');
});

test('i.i.d. 常態 20 板：|z| ≥ robZThr 的每次誤報接近名目（舊固定 3.5 約 14 倍）', () => {
  const N = makeNormal(mulberry32(99)), n = 20, runs = 10000, buf = new Float64Array(n);
  let hit = 0, old = 0;
  for (let k = 0; k < runs; k++) {
    for (let i = 0; i < n; i++) buf[i] = N();
    const { m, s } = c.robust(buf), zt = c.robZThr(n);
    for (let i = 0; i < n; i++) { const z = Math.abs(buf[i] - m) / s; if (z >= zt) hit++; if (z >= 3.5) old++; }
  }
  const exp = runs * n * A1;
  assert.ok(hit > exp * 0.6 && hit < exp * 1.5, `校準後 ${hit} 次（名目 ${exp.toFixed(0)}）`);
  assert.ok(old > exp * 8, `固定 3.5 ${old} 次（名目 ${exp.toFixed(0)}），確認本測試量得到舊問題`);
});

test('D-47 Nelson 規則 1 嚴重度：嚴重需通過族系門檻且有超規焊墊；整個項目 Cpk 偏低不單獨升為嚴重', () => {
  const L = (o) => c.nelson1Level({ zMax: 3.2, zFW: 3.9, hasOos: false, lowCpk: false, ...o });
  assert.equal(L({ zMax: 4.2, hasOos: true }), 'ng');
  assert.equal(L({ zMax: 4.2 }), 'warn');
  assert.equal(L({ hasOos: true }), 'info', '每點 3σ 未過族系門檻：超規焊墊本身不升級');
  assert.equal(L({ lowCpk: true }), 'info', 'Cpk 偏低是整個項目的性質');
  assert.equal(L({ hasOos: true, lowCpk: true }), 'warn');
});

test('非格點／奇數板數也維持名目誤報（奇偶板數尾巴不同，曾因格點間內插使 13 板達名目 1.23 倍）', () => {
  for (const n of [13, 63, 113]) {
    const N = makeNormal(mulberry32(5000 + n)), runs = Math.ceil(2e6 / n), buf = new Float64Array(n), zt = c.robZThr(n);
    let hit = 0;
    for (let k = 0; k < runs; k++) {
      for (let i = 0; i < n; i++) buf[i] = N();
      const { m, s } = c.robust(buf);
      for (let i = 0; i < n; i++) if (Math.abs(buf[i] - m) / s >= zt) hit++;
    }
    const ratio = hit / (runs * n * A1);
    assert.ok(ratio > 0.8 && ratio < 1.2, `${n} 板：每次誤報為名目 ${ratio.toFixed(2)} 倍`);
  }
});
