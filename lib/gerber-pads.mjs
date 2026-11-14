/** Gerber RS-274X（含 X2 屬性）焊墊解析 — 單一正本。
 *  瀏覽器端由 tools/sync-gerber-pads.mjs 包成 `GERBER` 物件嵌入 spi-spc.html；Worker 直接 import。
 *  只取「焊墊」：閃光（D03）與區域（G36/G37）；走線（D01 畫線）只在 keepDraws 時保留為線段（板框用）。
 *  單位一律換算成 mm。規格：docs/spec-gerber-layout-rfc.md。 */

export const GERBER_PARSER_VERSION = "gerber-pads/1";
export const GERBER_LIMITS = Object.freeze({ maxPads: 60000, maxSpanMm: 1000, minSpanMm: 5, maxPadMm: 25, maxDraws: 50000, maxRawBytes: 30 * 1024 * 1024, maxRepeat: 2500, maxPolyVertices: 64 });
/* 不是錫膏印刷焊墊的 X2 物件功能：對應時排除 */
export const GERBER_NON_PAD_FN = Object.freeze(["ViaPad", "Conductor", "NonConductor", "CopperBalancing", "FiducialPad", "Profile", "NonMaterial", "Other"]);

const CIRCLE_SEG = 96;
const EPS = 1e-9;

/** 位元組或字串 → 字串（Gerber 為 ASCII；不依賴 TextDecoder） */
export function gerberText(input) {
  if (typeof input === "string") return input;
  if (!input || typeof input.length !== "number") return "";
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (typeof TextDecoder !== "undefined") return new TextDecoder("latin1").decode(u8);
  let s = "";
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  return s;
}

/* ---------- 幾何工具 ---------- */
function polyArea(p) { let a = 0; for (let i = 0, n = p.length; i < n; i++) { const q = p[i], r = p[(i + 1) % n]; a += q[0] * r[1] - r[0] * q[1]; } return a / 2; }
function polyPerim(p) { let s = 0; for (let i = 0, n = p.length; i < n; i++) { const q = p[i], r = p[(i + 1) % n]; s += Math.hypot(r[0] - q[0], r[1] - q[1]); } return s; }
function polyBox(p) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; }
function circlePoly(cx, cy, d, n = CIRCLE_SEG) { const r = d / 2, out = []; for (let i = 0; i < n; i++) { const t = (2 * Math.PI * i) / n; out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); } return out; }
function rectPoly(cx, cy, w, h) { const a = w / 2, b = h / 2; return [[cx - a, cy - b], [cx + a, cy - b], [cx + a, cy + b], [cx - a, cy + b]]; }
function obroundPoly(cx, cy, w, h, n = CIRCLE_SEG) {
  const r = Math.min(w, h) / 2, out = [], k = Math.max(4, n / 2);
  const ax = w >= h ? w / 2 - r : 0, ay = w >= h ? 0 : h / 2 - r;
  const ends = [[cx + ax, cy + ay, -Math.PI / 2], [cx - ax, cy - ay, Math.PI / 2]];
  if (w < h) { ends[0][2] = 0; ends[1][2] = Math.PI; }
  for (const [ex, ey, a0] of ends) for (let i = 0; i <= k; i++) { const t = a0 + (Math.PI * i) / k; out.push([ex + r * Math.cos(t), ey + r * Math.sin(t)]); }
  return out;
}
function rot(p, deg) { if (!deg) return p; const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t); return p.map(([x, y]) => [x * c - y * s, x * s + y * c]); }
function ccw(p) { return polyArea(p) < 0 ? p.slice().reverse() : p; }
function inside(pt, p) { // 偶奇規則；邊上視為不確定（呼叫端用 ε 偏移避開）
  let c = false; const [x, y] = pt;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 多個多邊形聯集的面積與周長（邊界裁切法；同側重疊邊只計一次） */
export function unionAreaPerim(polys) {
  const P = polys.filter(p => p.length >= 3 && Math.abs(polyArea(p)) > EPS).map(ccw);
  if (!P.length) return { area: 0, perim: 0 };
  if (P.length === 1) return { area: polyArea(P[0]), perim: polyPerim(P[0]) };
  const all = P.flat(), bb = polyBox(all), eps = Math.max(1e-7, Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) * 1e-7);
  let area = 0, perim = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    for (let e = 0; e < p.length; e++) {
      const a = p[e], b = p[(e + 1) % p.length], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < EPS) continue;
      const ts = [0, 1];
      for (let j = 0; j < P.length; j++) {
        if (j === i) continue;
        const q = P[j];
        for (let f = 0; f < q.length; f++) {
          const c = q[f], d = q[(f + 1) % q.length], ex = d[0] - c[0], ey = d[1] - c[1];
          const den = dx * ey - dy * ex, wx = c[0] - a[0], wy = c[1] - a[1];
          if (Math.abs(den) > EPS * len * Math.hypot(ex, ey)) {
            const t = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
            if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
          } else if (Math.abs(wx * dy - wy * dx) <= EPS * len * Math.max(1, Math.hypot(wx, wy))) {
            for (const [px, py] of [c, d]) { const t = ((px - a[0]) * dx + (py - a[1]) * dy) / (len * len); if (t > 0 && t < 1) ts.push(t); }
          }
        }
      }
      ts.sort((m, n) => m - n);
      const nx = dy / len, ny = -dx / len; // ccw 多邊形的外法向
      for (let k = 0; k + 1 < ts.length; k++) {
        const t0 = ts[k], t1 = ts[k + 1];
        if (t1 - t0 < 1e-12) continue;
        const tm = (t0 + t1) / 2, mx = a[0] + dx * tm, my = a[1] + dy * tm;
        const out = [mx + nx * eps, my + ny * eps], inn = [mx - nx * eps, my - ny * eps];
        let drop = false;
        for (let j = 0; j < P.length && !drop; j++) {
          if (j === i) continue;
          if (inside(out, P[j])) drop = true;
          else if (j < i && inside(inn, P[j])) drop = true; // 與較早的多邊形同側共邊：已計入
        }
        if (drop) continue;
        const x0 = a[0] + dx * t0, y0 = a[1] + dy * t0, x1 = a[0] + dx * t1, y1 = a[1] + dy * t1;
        area += (x0 * y1 - x1 * y0) / 2;
        perim += Math.hypot(x1 - x0, y1 - y0);
      }
    }
  }
  return { area, perim };
}

/* ---------- 巨集運算式 ---------- */
function macroEval(expr, vars) {
  const s = String(expr).replace(/\s+/g, "");
  let i = 0;
  const peek = () => s[i];
  function num() {
    if (peek() === "(") { i++; const v = add(); if (peek() === ")") i++; return v; }
    if (peek() === "-") { i++; return -num(); }
    if (peek() === "+") { i++; return num(); }
    if (peek() === "$") { i++; let k = ""; while (/\d/.test(peek() || "")) k += s[i++]; return vars[+k] ?? 0; }
    let k = ""; while (/[0-9.]/.test(peek() || "")) k += s[i++];
    if (!k) throw new Error("巨集運算式格式不正確：" + s);
    return parseFloat(k);
  }
  function mul() { let v = num(); while (peek() === "x" || peek() === "X" || peek() === "/") { const op = s[i++], r = num(); v = op === "/" ? v / r : v * r; } return v; }
  function add() { let v = mul(); while (peek() === "+" || peek() === "-") { const op = s[i++], r = mul(); v = op === "+" ? v + r : v - r; } return v; }
  const v = add();
  if (i !== s.length) throw new Error("巨集運算式格式不正確：" + s);
  return v;
}

/** 巨集 → 以巨集原點為準的多邊形清單 {poly, on} */
function macroPolys(body, params) {
  const vars = [];
  params.forEach((v, k) => { vars[k + 1] = v; });
  const out = [], warn = [];
  for (const raw of body) {
    const st = raw.trim();
    if (!st || st[0] === "0") continue;
    const asg = st.match(/^\$(\d+)=(.+)$/);
    if (asg) { vars[+asg[1]] = macroEval(asg[2], vars); continue; }
    const f = st.split(",").map(x => macroEval(x, vars)), code = f[0];
    if (code === 1) out.push({ on: f[1] !== 0, poly: rot(circlePoly(f[3], f[4], f[2]), f[5] || 0) });
    else if (code === 20 || code === 2) {
      const [, e, w, sx, sy, ex, ey, r] = f, L = Math.hypot(ex - sx, ey - sy);
      if (L < EPS) continue;
      const ux = (ex - sx) / L, uy = (ey - sy) / L, h = w / 2, nx = -uy * h, ny = ux * h;
      out.push({ on: e !== 0, poly: rot([[sx + nx, sy + ny], [sx - nx, sy - ny], [ex - nx, ey - ny], [ex + nx, ey + ny]], r || 0) });
    } else if (code === 21) out.push({ on: f[1] !== 0, poly: rot(rectPoly(f[4], f[5], f[2], f[3]), f[6] || 0) });
    else if (code === 22) out.push({ on: f[1] !== 0, poly: rot(rectPoly(f[4] + f[2] / 2, f[5] + f[3] / 2, f[2], f[3]), f[6] || 0) });
    else if (code === 4) {
      const n = Math.round(f[2]), pts = [];
      if (!(n >= 1 && n <= 10000) || f.length < 6 + 2 * n) { warn.push("巨集外框點數不正確，已略過"); continue; }
      for (let k = 0; k <= n; k++) pts.push([f[3 + 2 * k], f[4 + 2 * k]]);
      if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-9) pts.pop();
      out.push({ on: f[1] !== 0, poly: rot(pts, f[5 + 2 * n] || 0) });
    } else if (code === 5) {
      const [, e, n0, cx, cy, d, r] = f, n = Math.min(GERBER_LIMITS.maxPolyVertices, Math.max(3, Math.round(n0 || 3))), pts = [];
      for (let k = 0; k < n; k++) { const t = (2 * Math.PI * k) / n; pts.push([cx + (d / 2) * Math.cos(t), cy + (d / 2) * Math.sin(t)]); }
      out.push({ on: e !== 0, poly: rot(pts, r || 0) });
    } else if (code === 7) {
      out.push({ on: true, poly: rot(circlePoly(f[1], f[2], f[3]), f[6] || 0), complex: true });
    } else warn.push("巨集基本形 " + code + " 不支援，已略過");
  }
  return { list: out, warn };
}

/* ---------- 光圈形狀（以光圈中心為原點） ---------- */
function apertureShape(ap, macros) {
  if (ap.shape) return ap.shape;
  const p = ap.params;
  let s;
  if (ap.tpl === "C") { const d = p[0] || 0; s = { kind: "c", L: d, W: d, area: (Math.PI * d * d) / 4, perim: Math.PI * d, complex: p.length > 1 }; }
  else if (ap.tpl === "R") { const w = p[0] || 0, h = p[1] || 0; s = { kind: "r", L: w, W: h, area: w * h, perim: 2 * (w + h), complex: p.length > 2 }; }
  else if (ap.tpl === "O") {
    const w = p[0] || 0, h = p[1] || 0, r = Math.min(w, h) / 2;
    s = { kind: "o", L: w, W: h, area: w * h - (4 - Math.PI) * r * r, perim: 2 * Math.abs(w - h) + 2 * Math.PI * r, complex: p.length > 2 };
  } else if (ap.tpl === "P") {
    const d = p[0] || 0, n = Math.min(GERBER_LIMITS.maxPolyVertices, Math.max(3, Math.round(p[1] || 3))), poly = rot(circlePoly(0, 0, d, n), p[2] || 0);
    s = { kind: "p", poly, area: Math.abs(polyArea(poly)), perim: polyPerim(poly), complex: p.length > 3 };
  } else {
    const m = macros.get(ap.tpl);
    if (!m) return null;
    const { list, warn } = macroPolys(m, p);
    const on = list.filter(x => x.on);
    if (!on.length) return null;
    const u = unionAreaPerim(on.map(x => x.poly));
    s = { kind: "m", polys: on.map(x => x.poly), area: Math.abs(u.area), perim: u.perim,
      complex: on.length !== list.length || list.some(x => x.complex), warn };
  }
  if (!s.polys && s.kind !== "p") s.polys = null;
  const box = s.kind === "c" || s.kind === "r" || s.kind === "o" ? [-s.L / 2, -s.W / 2, s.L / 2, s.W / 2] : polyBox(s.polys ? s.polys.flat() : s.poly);
  s.box = box;
  ap.shape = s;
  return s;
}

/** 解析 Gerber（瀏覽器登錄與套用時用）。opts.keepDraws 保留畫線線段（板框）。
 *  回傳 { ok:true, unit, fileFunction, layerGuess, sideGuess, bbox, pads, draws, stats, warnings } 或 { error, code } */
export function parseGerber(input, opts = {}) {
  const keepDraws = !!opts.keepDraws;
  const text = gerberText(input);
  if (!text || !/[*%]/.test(text) || /\u0000/.test(text.slice(0, 4096))) return { error: "不是 Gerber 檔：請選錫膏層、銅箔層或板框的 Gerber（.gtp、.gbr 等）", code: "not_gerber" };
  const warnings = new Set(), macros = new Map(), apertures = new Map();
  let fs = null, k = null, unitName = "", fileFunction = "", ipNeg = false;
  let x = 0, y = 0, interp = 1, quadrant = 75, curAp = null, lastOp = 0, dark = true, inRegion = false;
  let mir = "N", rotDeg = 0, scale = 1, offA = 0, offB = 0;
  const attr = { fn: "", ref: "", pin: "" };
  const pads = [], draws = [], stats = { flashes: 0, regions: 0, draws: 0, clear: 0, skippedLarge: 0, skippedFn: 0, unknownAperture: 0 };
  let contour = null, srStart = -1, sr = null, bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity, sawCode = false;
  const grow = (px, py) => { if (px < bx0) bx0 = px; if (px > bx1) bx1 = px; if (py < by0) by0 = py; if (py > by1) by1 = py; };

  function coord(str, axis) {
    if (str == null) return null;
    if (!fs) throw Object.assign(new Error("缺少 FS 格式宣告"), { code: "no_format" });
    if (str.includes(".")) return parseFloat(str) * k;
    let neg = false, d = str;
    if (d[0] === "+" || d[0] === "-") { neg = d[0] === "-"; d = d.slice(1); }
    const ni = axis === "x" ? fs.xi : fs.yi, nd = axis === "x" ? fs.xd : fs.yd;
    if (fs.zero === "T") d = d.padEnd(ni + nd, "0");
    const v = (parseInt(d || "0", 10) / Math.pow(10, nd)) * k;
    return neg ? -v : v;
  }
  function unitK(name) { unitName = name; k = name === "IN" ? 25.4 : 1; }

  function addPad(p) {
    if (srStart < 0 && sr) srStart = pads.length;
    pads.push(p);
    if (pads.length > GERBER_LIMITS.maxPads) throw Object.assign(new Error(`焊墊超過上限 ${GERBER_LIMITS.maxPads}：請只輸出單一圖層，不要用整個拼板`), { code: "too_many_pads" });
  }
  function flash(px, py) {
    stats.flashes++;
    if (!dark) { stats.clear++; return; }
    const ap = apertures.get(curAp);
    if (!ap) { stats.unknownAperture++; return; }
    const s = apertureShape(ap, macros);
    if (!s) { stats.unknownAperture++; return; }
    if (s.warn) for (const w of s.warn) warnings.add(w);
    const fn = ap.fn || "";
    const sc = scale * k, mx = mir.includes("X") ? -1 : 1, my = mir.includes("Y") ? -1 : 1;
    const simple = (s.kind === "c" || s.kind === "r" || s.kind === "o") && Math.abs(rotDeg / 90 - Math.round(rotDeg / 90)) < 1e-9;
    let pad;
    if (simple) {
      const swap = Math.round(rotDeg / 90) % 2 !== 0, L = s.L * sc, W = s.W * sc;
      pad = { x: px, y: py, w: swap ? W : L, h: swap ? L : W, shape: s.kind, L: Math.max(L, W), W: Math.min(L, W), area: s.area * sc * sc, perim: s.perim * sc };
    } else {
      const base = s.polys || [s.kind === "p" ? s.poly : s.kind === "o" ? obroundPoly(0, 0, s.L, s.W) : s.kind === "r" ? rectPoly(0, 0, s.L, s.W) : circlePoly(0, 0, s.L)];
      const tf = base.map(poly => rot(poly.map(([a, b]) => [a * mx, b * my]), rotDeg).map(([a, b]) => [a * sc + px, b * sc + py]));
      const bb = polyBox(tf.flat());
      pad = { x: (bb[0] + bb[2]) / 2, y: (bb[1] + bb[3]) / 2, w: bb[2] - bb[0], h: bb[3] - bb[1], shape: "p",
        area: s.area * sc * sc, perim: s.perim * sc, poly: tf.length === 1 ? tf[0] : null, rr: tf.length > 1 ? tf : null };
      const dims = s.kind === "r" || s.kind === "o" ? [s.L * sc, s.W * sc] : [pad.w, pad.h];
      pad.L = Math.max(...dims); pad.W = Math.min(...dims);
    }
    if (s.complex) pad.complex = true;
    if (fn) pad.fn = fn;
    if (attr.ref) pad.ref = attr.ref;
    if (attr.pin) pad.pin = attr.pin;
    if (Math.max(pad.w, pad.h) > GERBER_LIMITS.maxPadMm) { stats.skippedLarge++; return; }
    grow(pad.x - pad.w / 2, pad.y - pad.h / 2); grow(pad.x + pad.w / 2, pad.y + pad.h / 2);
    addPad(pad);
  }
  function arcPoints(x0, y0, x1, y1, i, j, cw) {
    let cx, cy;
    if (quadrant === 74) {
      let best = null;
      for (const [si, sj] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ccx = x0 + si * Math.abs(i), ccy = y0 + sj * Math.abs(j);
        let a0 = Math.atan2(y0 - ccy, x0 - ccx), a1 = Math.atan2(y1 - ccy, x1 - ccx), sw = cw ? a0 - a1 : a1 - a0;
        while (sw < 0) sw += 2 * Math.PI;
        if (sw > Math.PI / 2 + 1e-6) continue;
        const err = Math.abs(Math.hypot(x0 - ccx, y0 - ccy) - Math.hypot(x1 - ccx, y1 - ccy));
        if (!best || err < best.err) best = { ccx, ccy, err };
      }
      if (!best) return [[x1, y1]];
      cx = best.ccx; cy = best.ccy;
    } else { cx = x0 + i; cy = y0 + j; }
    const r = Math.hypot(x0 - cx, y0 - cy), a0 = Math.atan2(y0 - cy, x0 - cx);
    let a1 = Math.atan2(y1 - cy, x1 - cx), sw = cw ? a0 - a1 : a1 - a0;
    while (sw <= 1e-12) sw += 2 * Math.PI;
    if (quadrant === 74 && sw > 2 * Math.PI - 1e-9) sw = 0;
    const n = Math.max(1, Math.ceil(sw / (Math.PI / 36))), out = [];
    for (let q = 1; q <= n; q++) { const t = a0 + (cw ? -1 : 1) * (sw * q) / n; out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
    out[out.length - 1] = [x1, y1];
    return out;
  }
  function closeContour() {
    if (!contour) return;
    const pts = contour;
    contour = null;
    if (pts.length < 3) return;
    stats.regions++;
    if (!dark) { stats.clear++; return; }
    if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-9) pts.pop();
    if (pts.length < 3) return;
    const bb = polyBox(pts), w = bb[2] - bb[0], h = bb[3] - bb[1];
    if (Math.max(w, h) > GERBER_LIMITS.maxPadMm) { stats.skippedLarge++; return; }
    const pad = { x: (bb[0] + bb[2]) / 2, y: (bb[1] + bb[3]) / 2, w, h, shape: "p", L: Math.max(w, h), W: Math.min(w, h),
      area: Math.abs(polyArea(pts)), perim: polyPerim(pts), poly: pts, region: true };
    if (attr.fn) pad.fn = attr.fn;
    if (attr.ref) pad.ref = attr.ref;
    if (attr.pin) pad.pin = attr.pin;
    grow(bb[0], bb[1]); grow(bb[2], bb[3]);
    addPad(pad);
  }
  function closeSR() {
    if (!sr) return;
    const start = srStart < 0 ? pads.length : srStart, base = pads.slice(start), baseD = draws.slice(sr.d0);
    for (let a = 0; a < sr.nx; a++) for (let b = 0; b < sr.ny; b++) {
      if (!a && !b) continue;
      const ox = a * sr.dx, oy = b * sr.dy;
      for (const p of base) {
        const q = { ...p, x: p.x + ox, y: p.y + oy };
        if (p.poly) q.poly = p.poly.map(([u, v]) => [u + ox, v + oy]);
        if (p.rr) q.rr = p.rr.map(poly => poly.map(([u, v]) => [u + ox, v + oy]));
        pads.push(q);
        if (pads.length > GERBER_LIMITS.maxPads) throw Object.assign(new Error(`焊墊超過上限 ${GERBER_LIMITS.maxPads}：請只輸出單一圖層，不要用整個拼板`), { code: "too_many_pads" });
        grow(q.x - q.w / 2, q.y - q.h / 2); grow(q.x + q.w / 2, q.y + q.h / 2);
      }
      for (const s of baseD) if (draws.length < GERBER_LIMITS.maxDraws) draws.push([s[0] + ox, s[1] + oy, s[2] + ox, s[3] + oy]);
    }
    sr = null; srStart = -1;
  }

  function extended(cmd, blockRest) {
    const c2 = cmd.slice(0, 2);
    if (c2 === "FS") {
      const m = cmd.match(/^FS([LTD]?)([AI]?)(?:N\d+)?(?:G\d+)?X(\d)(\d)Y(\d)(\d)/);
      if (!m) throw Object.assign(new Error("FS 格式宣告無法辨識：" + cmd), { code: "no_format" });
      fs = { zero: m[1] === "T" ? "T" : "L", inc: m[2] === "I", xi: +m[3], xd: +m[4], yi: +m[5], yd: +m[6] };
      if (fs.inc) warnings.add("增量座標（已過時格式）");
    } else if (c2 === "MO") unitK(cmd.slice(2, 4) === "IN" ? "IN" : "MM");
    else if (c2 === "AD") {
      const m = cmd.match(/^ADD(\d+)([A-Za-z_$.][\w.$-]*)(?:,(.*))?$/);
      if (!m) { warnings.add("光圈定義無法辨識：" + cmd.slice(0, 40)); return; }
      apertures.set(+m[1], { tpl: m[2], params: m[3] ? m[3].split(/[xX]/).map(Number) : [], fn: attr.fn });
    } else if (c2 === "AM") macros.set(cmd.slice(2), blockRest);
    else if (c2 === "LP") dark = cmd[2] !== "C";
    else if (c2 === "LM") mir = cmd.slice(2) || "N";
    else if (c2 === "LR") rotDeg = parseFloat(cmd.slice(2)) || 0;
    else if (c2 === "LS") scale = parseFloat(cmd.slice(2)) || 1;
    else if (c2 === "SR") {
      closeSR();
      const m = cmd.match(/^SRX(\d+)Y(\d+)I([-\d.]+)J([-\d.]+)/);
      if (m && +m[1] * +m[2] > GERBER_LIMITS.maxRepeat) throw Object.assign(new Error(`步進重複 ${m[1]}×${m[2]} 次，超過上限 ${GERBER_LIMITS.maxRepeat}：請輸出單片板的圖層`), { code: "too_many_pads" });
      if (m && (+m[1] > 1 || +m[2] > 1)) sr = { nx: +m[1], ny: +m[2], dx: parseFloat(m[3]) * (k || 1), dy: parseFloat(m[4]) * (k || 1), d0: draws.length };
    } else if (c2 === "OF") {
      const a = cmd.match(/A([-\d.]+)/), b = cmd.match(/B([-\d.]+)/);
      offA = a ? parseFloat(a[1]) * (k || 1) : 0; offB = b ? parseFloat(b[1]) * (k || 1) : 0;
    } else if (c2 === "IP") ipNeg = cmd.slice(2, 5) === "NEG";
    else if (c2 === "TF") { const m = cmd.match(/^TF\.FileFunction,(.*)$/); if (m) fileFunction = m[1]; }
    else if (c2 === "TA") { const m = cmd.match(/^TA\.AperFunction,([^,]*)/); if (m) attr.fn = m[1]; }
    else if (c2 === "TO") {
      const c = cmd.match(/^TO\.C,(.*)$/), p = cmd.match(/^TO\.P,([^,]*),([^,]*)/);
      if (c) attr.ref = c[1].trim();
      if (p) { attr.ref = p[1].trim(); attr.pin = p[2].trim(); }
    } else if (c2 === "TD") {
      const n = cmd.slice(2);
      if (!n) { attr.ref = ""; attr.pin = ""; attr.fn = ""; }
      else if (n === ".C") attr.ref = "";
      else if (n === ".P") attr.pin = "";
      else if (n === ".AperFunction") attr.fn = "";
    } else if (c2 === "MI" || c2 === "SF" || c2 === "IR") warnings.add("已過時的影像轉換 " + c2 + " 未套用");
  }

  function word(w) {
    if (!w) return;
    if (w.charCodeAt(0) === 71 && (w.startsWith("G04") || w.startsWith("G4") && !/^G4\d/.test(w))) return;
    let nx = null, ny = null, ni = null, nj = null, d = null;
    for (let p = 0, n = w.length; p < n;) {
      const L = w[p++];
      if ("GDMXYIJ".indexOf(L) < 0) continue;
      let q = p;
      if (w[q] === "+" || w[q] === "-") q++;
      while (q < n) { const ch = w.charCodeAt(q); if ((ch >= 48 && ch <= 57) || ch === 46) q++; else break; }
      const v = w.slice(p, q);
      p = q;
      if (L === "G") {
        const g = parseInt(v, 10);
        sawCode = true;
        if (g === 1 || g === 2 || g === 3) interp = g;
        else if (g === 36) { inRegion = true; contour = null; }
        else if (g === 37) { closeContour(); inRegion = false; }
        else if (g === 74 || g === 75) quadrant = g;
        else if (g === 70) unitK("IN");
        else if (g === 71) unitK("MM");
        else if (g === 90 && fs) fs.inc = false;
        else if (g === 91 && fs) fs.inc = true;
      } else if (L === "D") { d = parseInt(v, 10); sawCode = true; }
      else if (L === "M") { if (parseInt(v, 10) === 2 || parseInt(v, 10) === 0) closeSR(); }
      else if (L === "X") nx = v; else if (L === "Y") ny = v; else if (L === "I") ni = v; else if (L === "J") nj = v;
    }
    if (d != null && d >= 10) { curAp = d; return; }
    const hasXY = nx != null || ny != null || ni != null || nj != null;
    if (!hasXY && d == null) return;
    if (!k) throw Object.assign(new Error("缺少單位宣告（MO）"), { code: "no_unit" });
    const op = d != null ? d : lastOp;
    if (d != null) lastOp = d;
    let tx = nx != null ? coord(nx, "x") + offA : null, ty = ny != null ? coord(ny, "y") + offB : null;
    if (fs.inc) { tx = x + (tx == null ? 0 : tx - offA); ty = y + (ty == null ? 0 : ty - offB); }
    else { if (tx == null) tx = x; if (ty == null) ty = y; }
    const ii = ni != null ? coord(ni, "x") : 0, jj = nj != null ? coord(nj, "y") : 0;
    if (op === 1) {
      const pts = interp === 1 ? [[tx, ty]] : arcPoints(x, y, tx, ty, ii, jj, interp === 2);
      if (inRegion) { if (!contour) contour = [[x, y]]; contour.push(...pts); }
      else {
        stats.draws++;
        if (keepDraws && dark) {
          let px = x, py = y;
          for (const [qx, qy] of pts) { if (draws.length < GERBER_LIMITS.maxDraws) draws.push([px, py, qx, qy]); px = qx; py = qy; }
          grow(x, y); grow(tx, ty);
        }
      }
    } else if (op === 2) { if (inRegion) { closeContour(); contour = [[tx, ty]]; } }
    else if (op === 3) { if (!inRegion) flash(tx, ty); }
    x = tx; y = ty;
  }

  try {
    let i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (c === "%") {
        const end = text.indexOf("%", i + 1);
        if (end < 0) break;
        const block = text.slice(i + 1, end).replace(/[\r\n]/g, "");
        i = end + 1;
        const parts = block.split("*").filter(s => s.length);
        if (!parts.length) continue;
        if (parts[0].startsWith("AM")) { extended(parts[0], parts.slice(1)); continue; }
        for (const p of parts) extended(p.trim(), null);
        sawCode = true;
      } else if (c === "\r" || c === "\n" || c === " " || c === "\t") i++;
      else {
        const end = text.indexOf("*", i);
        if (end < 0) break;
        let w = text.slice(i, end);
        if (/\s/.test(w)) w = w.replace(/\s+/g, "");
        i = end + 1;
        word(w);
      }
    }
    closeContour();
    closeSR();
  } catch (e) {
    return { error: e.message, code: e.code || "parse_error" };
  }
  if (!fs && !sawCode) return { error: "不是 Gerber 檔：找不到 Gerber 指令，請確認選的是錫膏層、銅箔層或板框檔", code: "not_gerber" };
  if (!fs) return { error: "缺少 FS 格式宣告：請由 CAD 重新輸出 RS-274X（Extended Gerber）", code: "no_format" };
  if (!k) return { error: "缺少單位宣告（MO）：請由 CAD 重新輸出 RS-274X（Extended Gerber）", code: "no_unit" };
  if (ipNeg) warnings.add("負片影像（IPNEG）：焊墊可能為反相，請確認");
  const kept = pads.length;
  const ff = fileFunction.toLowerCase();
  const layerGuess = /^paste/.test(ff) ? "paste" : /^copper/.test(ff) ? "copper" : /^profile/.test(ff) ? "outline" : "";
  const sideGuess = /,top\b/.test(ff) ? "TOP" : /,bot/.test(ff) ? "BOT" : "";
  const hasBox = Number.isFinite(bx0);
  const bbox = hasBox ? [bx0, by0, bx1, by1] : null;
  if (kept > GERBER_LIMITS.maxPads) return { error: `焊墊 ${kept} 個，超過上限 ${GERBER_LIMITS.maxPads}：請只輸出單一圖層，不要用整個拼板`, code: "too_many_pads" };
  if (!kept && !(keepDraws && draws.length)) return { error: "檔案中沒有焊墊（閃光或區域）：請確認選的是錫膏層或銅箔層；板框請選圖層「板框」", code: "no_pads" };
  if (bbox) {
    const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
    if (span > GERBER_LIMITS.maxSpanMm) return { error: `圖面範圍 ${span.toFixed(0)} mm，超過 ${GERBER_LIMITS.maxSpanMm} mm：請確認單位（mm／inch）`, code: "too_large" };
    if (span < GERBER_LIMITS.minSpanMm) return { error: `圖面範圍只有 ${span.toFixed(2)} mm，小於 ${GERBER_LIMITS.minSpanMm} mm：請確認單位或選整片板的圖層`, code: "too_small" };
  }
  return { ok: true, parser: GERBER_PARSER_VERSION, unit: unitName === "IN" ? "inch" : "mm", fileFunction, layerGuess, sideGuess, bbox,
    pads, draws: keepDraws ? draws : [], padCount: kept, stats, warnings: [...warnings] };
}

/** Worker 用的輕量檢查（免費方案 CPU 10 ms）：只做原生字串搜尋，不逐指令解析。
 *  確認格式與單位宣告、計數閃光與區域；外框尺寸等完整檢查在瀏覽器登錄前以 parseGerber 完成。 */
export function quickCheckGerber(input) {
  if (input && input.length > GERBER_LIMITS.maxRawBytes) return { error: `檔案 ${(input.length / 1048576).toFixed(1)} MB，超過板面圖檔上限 ${GERBER_LIMITS.maxRawBytes / 1048576} MB：請只輸出單一圖層`, code: "too_large_file" };
  const text = gerberText(input);
  const head = text.slice(0, 65536);
  if (!text || /\u0000/.test(head.slice(0, 4096)) || !/[*%]/.test(head)) return { error: "不是 Gerber 檔：請選錫膏層、銅箔層或板框的 Gerber（.gtp、.gbr 等）", code: "not_gerber" };
  if (!/%FS[LTD]?[AI]?(?:N\d+)?(?:G\d+)?X\d\dY\d\d/.test(head)) return { error: "缺少 FS 格式宣告：請由 CAD 重新輸出 RS-274X（Extended Gerber）", code: "no_format" };
  if (!/%MO(?:MM|IN)\*/.test(head) && !/(?:^|[*\s])G7[01]\*/.test(head)) return { error: "缺少單位宣告（MO）：請由 CAD 重新輸出 RS-274X（Extended Gerber）", code: "no_unit" };
  const count = needle => { let n = 0, i = text.indexOf(needle); while (i >= 0) { n++; i = text.indexOf(needle, i + needle.length); } return n; };
  const flashes = count("D03*"), regions = count("G36*"), draws = count("D01*");
  if (flashes + regions > GERBER_LIMITS.maxPads) return { error: `焊墊 ${flashes + regions} 個，超過上限 ${GERBER_LIMITS.maxPads}：請只輸出單一圖層，不要用整個拼板`, code: "too_many_pads" };
  if (!flashes && !regions && !draws) return { error: "檔案中沒有焊墊或線段：請確認選的是錫膏層、銅箔層或板框檔", code: "no_pads" };
  const ff = ((head.match(/%TF\.FileFunction,([^*]*)\*%/) || [])[1] || "").replace(/[^\w ,.+-]/g, "").slice(0, 64);
  return { ok: true, parser: GERBER_PARSER_VERSION, flashes, regions, draws, fileFunction: ff, unit: /%MOIN\*/.test(head) || /G70\*/.test(head) ? "inch" : "mm" };
}

/** 依副檔名推定圖層（使用者仍須確認） */
export function gerberLayerFromName(name) {
  const n = String(name || "").toLowerCase();
  if (/\.(gtp|gbp|crc|crs)$/.test(n) || /paste|smd|stencil|鋼板|錫膏/.test(n)) return "paste";
  if (/\.(gko|gm1|gml|gm)$/.test(n) || /outline|profile|edge|板框/.test(n)) return "outline";
  if (/\.(gtl|gbl|cmp|sol)$/.test(n) || /copper|_cu|\.cu|銅/.test(n)) return "copper";
  return "";
}

/* ---------- 零件 ↔ 焊墊對應（docs/spec-gerber-layout-rfc.md §4） ---------- */
export const LAYOUT_MATCH = Object.freeze({ acceptRate: 0.6, asIsRate: 0.8, pinRate: 0.8, refRate: 0.5, cell: 2, maxSearch: 15, samples: 30 });
const ORIENT = [0, 1, 2, 3, 4, 5, 6, 7];
/** 方位 o：0–3 旋轉 0/90/180/270°，4–7 先將 x 取負再旋轉 */
export function layoutTransform(tf, x, y) {
  const o = tf ? tf.o : 0, mx = o >= 4 ? -x : x, r = o % 4;
  const px = r === 0 ? mx : r === 1 ? -y : r === 2 ? -mx : y, py = r === 0 ? y : r === 1 ? mx : r === 2 ? -y : -mx;
  return [px + (tf ? tf.tx : 0), py + (tf ? tf.ty : 0)];
}

function padIndex(pads, cell) {
  const grid = new Map(), key = (i, j) => i * 1000003 + j;
  pads.forEach((p, k) => { const id = key(Math.floor(p.x / cell), Math.floor(p.y / cell)); let a = grid.get(id); if (!a) grid.set(id, a = []); a.push(k); });
  /* 離 (x,y) 最近的 n 個焊墊；超過 maxR 仍不足時回傳 null */
  return function nearest(x, y, n, maxR) {
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell), cand = [];
    for (let ring = 0; ring * cell <= maxR + cell; ring++) {
      for (let i = ci - ring; i <= ci + ring; i++) for (let j = cj - ring; j <= cj + ring; j++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
        const a = grid.get(key(i, j));
        if (a) for (const k of a) cand.push([Math.hypot(pads[k].x - x, pads[k].y - y), k]);
      }
      if (cand.length >= n) {
        cand.sort((a, b) => a[0] - b[0]);
        if (cand[n - 1][0] <= ring * cell) return cand[n - 1][0] <= maxR ? cand.slice(0, n).map(c => c[1]) : null;
      }
    }
    if (cand.length < n) return null;
    cand.sort((a, b) => a[0] - b[0]);
    return cand[n - 1][0] <= maxR ? cand.slice(0, n).map(c => c[1]) : null;
  };
}

/** 依零件中心與焊墊數評估一個轉換：接受條件＝焊墊群中心與零件中心距離在容差內，且沒有焊墊被兩顆零件取用 */
function evalTransform(parts, pads, nearest, tf, loose) {
  const got = [], claim = new Map(), resid = [];
  for (const part of parts) {
    const [cx, cy] = layoutTransform(tf, part.x, part.y);
    const idx = nearest(cx, cy, part.n, loose ? LAYOUT_MATCH.maxSearch / 2 : LAYOUT_MATCH.maxSearch);
    if (!idx) { got.push(null); continue; }
    let mx = 0, my = 0;
    for (const k of idx) { mx += pads[k].x; my += pads[k].y; }
    mx /= idx.length; my /= idx.length;
    let rms = 0;
    for (const k of idx) rms += (pads[k].x - mx) ** 2 + (pads[k].y - my) ** 2;
    rms = Math.sqrt(rms / idx.length);
    const d = Math.hypot(mx - cx, my - cy), tol = Math.max(0.3, 0.35 * rms);
    resid.push([mx - cx, my - cy]);
    if (d > tol) { got.push({ idx, bad: "center" }); continue; }
    got.push({ idx });
    for (const k of idx) claim.set(k, (claim.get(k) || 0) + 1);
  }
  let acc = 0;
  for (const g of got) if (g && !g.bad) { if (g.idx.some(k => claim.get(k) > 1)) g.bad = "shared"; else acc++; }
  return { got, acc, resid };
}
const median = a => { const s = [...a].sort((p, q) => p - q), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

/** 錨點候選：取焊墊最多的零件為錨點，從焊墊出發反覆取最近 n 個焊墊的中心（收斂到同尺寸的焊墊群中心），
 *  每個不同的群中心 × 8 種方位為一個候選轉換；以抽樣零件快速評分後取最好的幾個。週期性排列（LED 陣列等）也能分辨。 */
function anchorCandidates(parts, pads, nearest) {
  const anchor = parts.reduce((a, p) => (p.n > a.n ? p : a), parts[0]), n = anchor.n;
  const stride = Math.max(1, Math.floor(pads.length / 4000)), centres = new Map();
  for (let k = 0; k < pads.length; k += stride) {
    let x = pads[k].x, y = pads[k].y, idx = null;
    for (let it = 0; it < 4; it++) {
      idx = nearest(x, y, n, LAYOUT_MATCH.maxSearch);
      if (!idx) break;
      let mx = 0, my = 0;
      for (const q of idx) { mx += pads[q].x; my += pads[q].y; }
      mx /= n; my /= n;
      if (Math.hypot(mx - x, my - y) < 1e-6) break;
      x = mx; y = my;
    }
    if (!idx) continue;
    const key = Math.round(x * 20) + "," + Math.round(y * 20);
    if (!centres.has(key)) centres.set(key, [x, y]);
  }
  const spread = m => { const st = Math.max(1, Math.floor(parts.length / m)); return parts.filter((_, i) => i % st === 0).slice(0, m); };
  const quick = spread(6), sample = spread(LAYOUT_MATCH.samples), first = [];
  for (const [gx, gy] of centres.values()) for (const o of ORIENT) {
    const [ax, ay] = layoutTransform({ o, tx: 0, ty: 0 }, anchor.x, anchor.y), tf = { o, tx: gx - ax, ty: gy - ay };
    const e = evalTransform(quick, pads, nearest, tf, false);
    if (e.acc) first.push({ ...tf, score: e.acc });
  }
  first.sort((p, q) => q.score - p.score);
  return first.slice(0, 40).map(tf => ({ ...tf, score: evalTransform(sample, pads, nearest, tf, false).acc })).sort((p, q) => q.score - p.score);
}

/** 對應零件與焊墊。parts：[{ref, x?, y?, n, pins?}]（x/y 為座標檔中心；pins 為量測的腳位名）；pads：用來對應的焊墊（已排除非印刷物件）。
 *  回傳 { level: "pad"|"ref"|"near"|"none", tf, rate, matched:{ref:[padIdx]}, pinPad:{ref:{pin:padIdx}}, unresolved:[{ref, reason}] } */
export function matchLayoutParts(parts, pads) {
  const res = { level: "none", tf: null, rate: 0, matched: {}, pinPad: {}, unresolved: [], total: parts.length };
  if (!parts.length || !pads.length) return res;
  const withRef = pads.filter(p => p.ref).length;
  if (withRef >= LAYOUT_MATCH.refRate * pads.length) {
    const byRef = new Map();
    pads.forEach((p, k) => { if (p.ref) { let a = byRef.get(p.ref); if (!a) byRef.set(p.ref, a = []); a.push(k); } });
    let pins = 0, hit = 0;
    for (const part of parts) {
      const idx = byRef.get(part.ref);
      if (!idx) { res.unresolved.push({ ref: part.ref, reason: "圖檔沒有此位號" }); continue; }
      res.matched[part.ref] = idx;
      const byPin = new Map(idx.filter(k => pads[k].pin).map(k => [pads[k].pin, k])), pp = {};
      for (const pin of part.pins || []) { pins++; if (byPin.has(pin)) { pp[pin] = byPin.get(pin); hit++; } }
      res.pinPad[part.ref] = pp;
    }
    res.level = pins && hit >= LAYOUT_MATCH.pinRate * pins ? "pad" : "ref";
    if (res.level !== "pad") res.pinPad = {};
    res.rate = Object.keys(res.matched).length / parts.length;
    return res;
  }
  const located = parts.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.n > 0);
  for (const p of parts) if (!located.includes(p)) res.unresolved.push({ ref: p.ref, reason: "沒有零件中心座標" });
  if (!located.length) return res;
  const nearest = padIndex(pads, LAYOUT_MATCH.cell);
  const score = tf => evalTransform(located, pads, nearest, tf, false);
  let bestTf = { o: 0, tx: 0, ty: 0 }, best = score(bestTf);
  if (best.acc < LAYOUT_MATCH.asIsRate * located.length) {
    for (const cand of anchorCandidates(located, pads, nearest).slice(0, 8)) {
      let tf = { o: cand.o, tx: cand.tx, ty: cand.ty };
      for (let it = 0; it < 6; it++) {
        const e = evalTransform(located, pads, nearest, tf, true);
        if (!e.resid.length) break;
        const dx = median(e.resid.map(r => r[0])), dy = median(e.resid.map(r => r[1]));
        tf = { o: tf.o, tx: tf.tx + dx, ty: tf.ty + dy };
        if (Math.hypot(dx, dy) < 1e-4) break;
      }
      const e = score(tf);
      if (e.acc > best.acc) { best = e; bestTf = tf; }
    }
  }
  res.rate = best.acc / located.length;
  if (res.rate < LAYOUT_MATCH.acceptRate) {
    res.level = "none";
    res.tried = { rate: res.rate, accepted: best.acc, parts: located.length };
    return res;
  }
  res.level = "near";
  res.tf = { o: bestTf.o, tx: Math.round(bestTf.tx * 1e4) / 1e4, ty: Math.round(bestTf.ty * 1e4) / 1e4 };
  located.forEach((part, i) => {
    const g = best.got[i];
    if (g && !g.bad) res.matched[part.ref] = g.idx;
    else res.unresolved.push({ ref: part.ref, reason: !g ? "附近沒有足夠的焊墊" : g.bad === "shared" ? "焊墊與其他零件重疊" : "焊墊群中心偏離零件中心" });
  });
  return res;
}
