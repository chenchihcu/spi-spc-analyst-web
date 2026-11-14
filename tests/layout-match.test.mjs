// 零件 ↔ Gerber 焊墊對應（matchLayoutParts）。合成板：0402、SOT-23、SOIC-8、QFN-16＋散熱墊。規格：docs/spec-gerber-layout-rfc.md §4
import test from "node:test";
import assert from "node:assert/strict";
import { matchLayoutParts, layoutTransform } from "../lib/gerber-pads.mjs";

const FOOT = {
  R: [[-0.5, 0], [0.5, 0]],
  Q: [[-0.95, -1], [0.95, -1], [0, 1]],
  U: [-1.905, -0.635, 0.635, 1.905].flatMap(y => [[-2.7, y], [2.7, y]]),
  Q16: [...[-0.75, -0.25, 0.25, 0.75].flatMap(t => [[-1.45, t], [1.45, t], [t, -1.45], [t, 1.45]]), [0, 0]],
};
/** 合成板：零件中心（座標檔）與焊墊（Gerber，已套 tf 與拼板） */
function board({ cols = 8, rows = 6, pitch = 7, tf = null, panel = null, x2 = false } = {}) {
  const kinds = ["R", "Q", "U", "Q16"], parts = [], pads = [];
  let n = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const kind = kinds[(i + j) % kinds.length], ref = `${kind}${++n}`, x = 5 + i * pitch, y = 5 + j * pitch;
    const pins = FOOT[kind].map((_, k) => String(k + 1));
    parts.push({ ref, x, y, n: FOOT[kind].length, pins });
    const copies = panel ? panel : [[0, 0]];
    for (const [ox, oy] of copies) FOOT[kind].forEach(([dx, dy], k) => {
      const [gx, gy] = layoutTransform(tf, x + dx, y + dy);
      pads.push({ x: gx + ox, y: gy + oy, ...(x2 ? { ref, pin: String(k + 1) } : {}) });
    });
  }
  return { parts, pads };
}
const owns = (res, parts, pads) => {
  for (const p of parts) {
    const idx = res.matched[p.ref];
    assert.ok(idx, `${p.ref} 應對應`);
    assert.equal(idx.length, p.n);
  }
};

test("原座標：每顆零件取得自己的焊墊（依零件）", () => {
  const { parts, pads } = board();
  const r = matchLayoutParts(parts, pads);
  assert.equal(r.level, "near");
  assert.deepEqual(r.tf, { o: 0, tx: 0, ty: 0 });
  assert.equal(r.rate, 1);
  owns(r, parts, pads);
  // 焊墊恰為該零件的焊墊：群中心等於零件中心
  for (const p of parts.filter(q => q.ref.startsWith("U"))) {
    const idx = r.matched[p.ref], cx = idx.reduce((s, k) => s + pads[k].x, 0) / idx.length;
    assert.ok(Math.abs(cx - p.x) < 1e-9);
  }
});

test("平移＋鏡像、旋轉 90°：找回轉換並全部對應", () => {
  for (const tf of [{ o: 4, tx: 112.5, ty: -3 }, { o: 1, tx: 40, ty: 7.25 }, { o: 6, tx: -20, ty: 300 }]) {
    const { parts, pads } = board({ tf });
    const r = matchLayoutParts(parts, pads);
    assert.equal(r.level, "near", JSON.stringify(tf));
    assert.equal(r.tf.o, tf.o);
    assert.ok(Math.abs(r.tf.tx - tf.tx) < 1e-3 && Math.abs(r.tf.ty - tf.ty) < 1e-3, JSON.stringify(r.tf));
    assert.equal(r.rate, 1);
  }
});

test("拼板（2×2）：對到其中一片並全部對應", () => {
  const { parts, pads } = board({ tf: { o: 0, tx: 10, ty: 10 }, panel: [[0, 0], [70, 0], [0, 50], [70, 50]] });
  const r = matchLayoutParts(parts, pads);
  assert.equal(r.level, "near");
  assert.equal(r.rate, 1);
});

test("圖檔與座標檔無關：不套用（none），列出接受率", () => {
  const { parts } = board();
  const pads = [];
  for (let i = 0; i < 300; i++) pads.push({ x: (i * 37.3) % 90, y: (i * 61.7) % 70 });
  const r = matchLayoutParts(parts, pads);
  assert.equal(r.level, "none");
  assert.deepEqual(r.matched, {});
  assert.ok(r.tried.rate < 0.6);
});

test("焊墊數不符而重疊時兩顆都列為對不上，不猜", () => {
  const parts = [{ ref: "A", x: 0, y: 0, n: 2 }, { ref: "B", x: 1.2, y: 0, n: 2 }, ...Array.from({ length: 8 }, (_, i) => ({ ref: "R" + i, x: 20 + i * 5, y: 20, n: 2 }))];
  const pads = [[-0.5, 0], [0.5, 0], [1.7, 0], ...parts.slice(2).flatMap(p => [[p.x - 0.5, p.y], [p.x + 0.5, p.y]])].map(([x, y]) => ({ x, y }));
  const r = matchLayoutParts(parts, pads);
  assert.equal(r.level, "near");
  const bad = Object.fromEntries(r.unresolved.map(u => [u.ref, u.reason]));
  assert.equal(bad.A, "焊墊與其他零件重疊");
  assert.equal(bad.B, "焊墊與其他零件重疊");
  assert.equal(r.matched.A, undefined);
  assert.equal(Object.keys(r.matched).length, 8);
});

test("沒有中心座標的零件列出原因，其餘照常對應", () => {
  const { parts, pads } = board();
  const r = matchLayoutParts([...parts, { ref: "X1", n: 2 }], pads);
  assert.equal(r.level, "near");
  assert.deepEqual(r.unresolved, [{ id: "X1", ref: "X1", reason: "沒有零件中心座標" }]);
});

test("X2 位號＋腳位：逐焊墊；只有位號：依位號分群，不需定位", () => {
  const { parts, pads } = board({ x2: true, tf: { o: 3, tx: 500, ty: 9 } });
  const r = matchLayoutParts(parts, pads);
  assert.equal(r.level, "pad");
  assert.equal(r.tf, null);
  const p = parts[2];
  assert.equal(Object.keys(r.pinPad[p.ref]).length, p.n);
  const noPin = matchLayoutParts(parts.map(q => ({ ...q, pins: q.pins.map(x => "P" + x) })), pads);
  assert.equal(noPin.level, "ref");
  assert.deepEqual(noPin.pinPad, {});
  owns(noPin, parts, pads);
  const missing = matchLayoutParts([...parts, { ref: "ZZ9", n: 2 }], pads);
  assert.deepEqual(missing.unresolved, [{ id: "ZZ9", ref: "ZZ9", reason: "圖檔沒有此位號" }]);
});

test("同位號不同子板（不同中心）：以 id 分開對應到各自的焊墊", () => {
  const parts = [{ id: "f1-R1", ref: "R1", x: 10, y: 10, n: 2 }, { id: "f2-R1", ref: "R1", x: 60, y: 10, n: 2 },
    ...Array.from({ length: 6 }, (_, i) => ({ id: "C" + i, ref: "C" + i, x: 10 + i * 8, y: 30, n: 2 }))];
  const pads = parts.flatMap(p => [{ x: p.x - 0.5, y: p.y }, { x: p.x + 0.5, y: p.y }]);
  const r = matchLayoutParts(parts, pads);
  assert.equal(r.level, "near");
  assert.equal(r.rate, 1);
  assert.notDeepEqual(r.matched["f1-R1"], r.matched["f2-R1"]);
  assert.ok(r.matched["f2-R1"].every(k => pads[k].x > 50));
});

test("效能：1,500 顆零件、約 7,000 焊墊需定位時 < 2 秒", () => {
  const { parts, pads } = board({ cols: 50, rows: 30, pitch: 6, tf: { o: 5, tx: 33, ty: -12 } });
  const t = performance.now();
  const r = matchLayoutParts(parts, pads);
  const ms = performance.now() - t;
  assert.equal(r.rate, 1);
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
});
