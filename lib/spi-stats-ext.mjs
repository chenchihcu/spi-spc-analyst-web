/**
 * SPI 進階統計分析擴充引擎 — 純函式（無 DOM / window 相依）。
 * 瀏覽器端由 tools/sync-spi-stats-ext.mjs 同步內嵌於 spi-spc.html 核心腳本區塊。
 */

function _extLogGamma(z) {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -0.000005395239384953,
  ];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

function _extGammaQ(a, x) {
  if (x <= 0) return 1;
  if (a <= 0) return 0;
  const gln = _extLogGamma(a);
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 1; n <= 200; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    const p = sum * Math.exp(-x + a * Math.log(x) - gln);
    return Math.max(0, Math.min(1, 1 - p));
  }
  let b = x + 1 - a, c = 1 / 1e-30, d = 1 / b, h = d;
  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.max(0, Math.min(1, Math.exp(-x + a * Math.log(x) - gln) * h));
}

function _extChi2UpperP(x, df) {
  if (!Number.isFinite(x) || x <= 0 || df <= 0) return 1;
  return _extGammaQ(df / 2, x / 2);
}

function _extOrderRowsByBoards(rows, boardOrder) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const byBoard = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const b = r && r.board != null ? r.board : "";
    let list = byBoard.get(b);
    if (!list) { list = []; byBoard.set(b, list); }
    list.push(r);
  }
  const order = Array.isArray(boardOrder) && boardOrder.length ? boardOrder : [...byBoard.keys()];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < order.length; i++) {
    const b = order[i];
    const list = byBoard.get(b);
    if (!list) continue;
    seen.add(b);
    for (let j = 0; j < list.length; j++) out.push(list[j]);
  }
  for (const [b, list] of byBoard.entries()) {
    if (seen.has(b)) continue;
    for (let j = 0; j < list.length; j++) out.push(list[j]);
  }
  return out;
}

/**
 * 1.1 G 圖（稀有事件間隔管制圖 — Benneyan 幾何分布精確界線）
 */
export function calcGChart(rows, classifyFn, boardOrder) {
  const ordered = _extOrderRowsByBoards(rows, boardOrder);
  const totalPads = ordered.length;
  if (!totalPads) return { insufficient: true, reason: "範圍內無有效量測資料", totalPads: 0, defectCount: 0, pts: [] };

  const defPos = [];
  for (let i = 0; i < totalPads; i++) {
    const r = ordered[i];
    const d = classifyFn(r);
    if (d && d.length > 0) defPos.push({ idx: i, board: r.board });
  }
  const defectCount = defPos.length;
  const yieldPct = ((totalPads - defectCount) / totalPads) * 100;
  if (defectCount < 2) {
    return {
      insufficient: true,
      reason: "範圍內不良次數少於 2 次，暫無法繪製間隔圖",
      totalPads,
      defectCount,
      yieldPct,
      pts: [],
    };
  }

  const m = defectCount - 1;
  const gs = new Array(m);
  let sumG = 0;
  for (let i = 0; i < m; i++) {
    const g = defPos[i + 1].idx - defPos[i].idx - 1;
    gs[i] = g;
    sumG += g;
  }
  const gMean = sumG / m;
  const sortedG = gs.slice().sort((a, b) => a - b);
  const gMedian = m % 2 ? sortedG[(m - 1) >> 1] : (sortedG[(m >> 1) - 1] + sortedG[m >> 1]) / 2;

  const pHat = Math.min(1 - 1e-9, Math.max(1e-9, 1 / (gMean + 1)));
  const lnQ = Math.log(1 - pHat);
  const alphaHalf = 0.00135;
  const clMean = gMean;
  const clMed = Math.max(0, Math.log(0.5) / lnQ - 1);
  const ucl = Math.max(0, Math.ceil(Math.log(alphaHalf) / lnQ - 1));
  const lcl = Math.max(0, Math.floor(Math.log(1 - alphaHalf) / lnQ - 1));

  // 標記越界與高良率連續不良叢發（LCL >= 1 時 g <= LCL；LCL == 0 時連續 >= 2 次 g == 0）
  const pts = new Array(m);
  let zeroRun = 0;
  let lclRun = 0;
  let burstCount = 0;
  const burstIndices = [];
  let maxZeroRun = 0;
  let maxLclRun = 0;
  for (let i = 0; i < m; i++) {
    const g = gs[i];
    const aboveUcl = g > ucl;
    const belowLcl = lcl >= 1 && g <= lcl;
    if (g === 0) zeroRun++; else zeroRun = 0;
    if (belowLcl) lclRun++; else lclRun = 0;
    if (zeroRun > maxZeroRun) maxZeroRun = zeroRun;
    if (lclRun > maxLclRun) maxLclRun = lclRun;

    const isZeroBurst = lcl === 0 && zeroRun >= 2;
    const isLclBurst = lcl >= 1 && lclRun >= 2;
    const burst = isZeroBurst || isLclBurst;
    if (burst) {
      burstCount++;
      burstIndices.push(i);
      if (i > 0 && !pts[i - 1].burst && ((lcl === 0 && zeroRun === 2) || (lcl >= 1 && lclRun === 2))) {
        pts[i - 1].burst = true;
      }
    }
    pts[i] = {
      idx: i + 1,
      lab: `#${i + 1}`,
      board: defPos[i + 1].board,
      g,
      belowLcl,
      aboveUcl,
      burst,
    };
  }

  // Bonferroni 校正叢發機率（供 M-23 規則使用）
  const burstP = lcl === 0 && maxZeroRun >= 2
    ? Math.min(1, Math.max(1, m - maxZeroRun + 1) * Math.pow(pHat, maxZeroRun))
    : lcl >= 1 && maxLclRun >= 2
      ? Math.min(1, Math.max(1, m - maxLclRun + 1) * Math.pow(1 - Math.pow(1 - pHat, lcl + 1), maxLclRun))
      : 1;

  return {
    insufficient: false,
    totalPads,
    defectCount,
    yieldPct,
    gMean,
    gMedian,
    pHat,
    clMean,
    clMed,
    ucl,
    lcl,
    burstCount,
    burstIndices,
    maxZeroRun,
    maxLclRun,
    burstP,
    pts,
  };
}

/**
 * 1.2 Laney U′ 圖（每板單位缺點數，含過度離散係數 σz 與零不良防呆）
 */
export function calcLaneyUChart(rows, classifyFn, boardOrder) {
  if (!Array.isArray(rows) || !rows.length) {
    return { insufficient: true, reason: "範圍內無有效量測資料", uBar: 0, uBarPer1k: 0, sigmaZ: 1, pts: [] };
  }
  const byBoard = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const b = r && r.board != null ? r.board : "";
    let rec = byBoard.get(b);
    if (!rec) { rec = { n: 0, c: 0 }; byBoard.set(b, rec); }
    rec.n += 1;
    const d = classifyFn(r);
    if (d && d.length > 0) rec.c += d.length;
  }
  const order = Array.isArray(boardOrder) && boardOrder.length
    ? boardOrder.filter((b) => byBoard.has(b))
    : [...byBoard.keys()];
  for (const b of byBoard.keys()) if (!order.includes(b)) order.push(b);
  if (!order.length) {
    return { insufficient: true, reason: "無有效板序資料", uBar: 0, uBarPer1k: 0, sigmaZ: 1, pts: [] };
  }

  let totC = 0, totN = 0;
  for (let i = 0; i < order.length; i++) {
    const rec = byBoard.get(order[i]);
    totC += rec.c;
    totN += rec.n;
  }
  const uBar = totN > 0 ? totC / totN : 0;
  if (uBar <= 0) {
    const pts = order.map((lab) => {
      const rec = byBoard.get(lab);
      return { lab, n: rec.n, c: 0, u: 0, uPer1k: 0, v: 0, cl: 0, ucl: 0, lcl: 0, z: 0, ooc: false };
    });
    return { insufficient: false, uBar: 0, uBarPer1k: 0, sigmaZ: 1, cl: 0, sigZ: 1, pts };
  }

  const zs = new Array(order.length);
  const sigUs = new Array(order.length);
  for (let i = 0; i < order.length; i++) {
    const rec = byBoard.get(order[i]);
    const u = rec.c / rec.n;
    const su = Math.sqrt(uBar / rec.n);
    sigUs[i] = su;
    zs[i] = su > 0 ? (u - uBar) / su : 0;
  }
  let mrSum = 0;
  for (let i = 1; i < zs.length; i++) mrSum += Math.abs(zs[i] - zs[i - 1]);
  const sigmaZ = zs.length >= 2 ? (mrSum / (zs.length - 1)) / 1.128 : 1;
  const effSigZ = Number.isFinite(sigmaZ) && sigmaZ > 0 ? sigmaZ : 1;

  const pts = order.map((lab, i) => {
    const rec = byBoard.get(lab);
    const u = rec.c / rec.n;
    const ucl = uBar + 3 * sigUs[i] * effSigZ;
    const lcl = Math.max(0, uBar - 3 * sigUs[i] * effSigZ);
    const z = (sigUs[i] * effSigZ) > 0 ? (u - uBar) / (sigUs[i] * effSigZ) : 0;
    return {
      lab,
      n: rec.n,
      c: rec.c,
      u,
      uPer1k: u * 1000,
      v: u,
      cl: uBar,
      ucl,
      lcl,
      z,
      ooc: u > ucl || u < lcl,
    };
  });

  return {
    insufficient: false,
    uBar,
    uBarPer1k: uBar * 1000,
    sigmaZ: effSigZ,
    cl: uBar,
    sigZ: effSigZ,
    pts,
  };
}

/**
 * 1.3 板序自相關與偏自相關（ACF / PACF + Ljung-Box Q 檢定）
 */
export function calcAcfPacf(boardMeans, maxLagOpt) {
  const xs = Array.isArray(boardMeans) ? boardMeans.filter((v) => v != null && Number.isFinite(v)) : [];
  const n = xs.length;
  if (n < 6) {
    return { insufficient: true, reason: "有效板數少於 6 片，無法計算板序自相關", n, acf: [], pacf: [], sigLags: [] };
  }
  let sum = 0;
  for (let i = 0; i < n; i++) sum += xs[i];
  const mu = sum / n;
  let denom = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i] - mu;
    denom += d * d;
  }
  if (denom <= 1e-12) {
    return { insufficient: true, reason: "各板平均值無變異，無法計算自相關", n, acf: [], pacf: [], sigLags: [] };
  }

  const maxLag = Math.max(1, Math.min(maxLagOpt || 20, Math.floor(n / 3)));
  const acf = new Array(maxLag);
  for (let k = 1; k <= maxLag; k++) {
    let num = 0;
    for (let t = k; t < n; t++) num += (xs[t] - mu) * (xs[t - k] - mu);
    acf[k - 1] = num / denom;
  }

  // Durbin-Levinson 遞迴求 PACF
  const pacf = new Array(maxLag);
  let prevPhi = [];
  let v = 1;
  for (let k = 1; k <= maxLag; k++) {
    let num = acf[k - 1];
    for (let j = 1; j < k; j++) num -= prevPhi[j - 1] * acf[k - j - 1];
    const phiKK = Math.abs(v) > 1e-12 ? Math.max(-1, Math.min(1, num / v)) : 0;
    const curPhi = new Array(k);
    for (let j = 1; j < k; j++) curPhi[j - 1] = prevPhi[j - 1] - phiKK * prevPhi[k - j - 1];
    curPhi[k - 1] = phiKK;
    pacf[k - 1] = phiKK;
    v = v * (1 - phiKK * phiKK);
    prevPhi = curPhi;
  }

  const ci95 = 1.96 / Math.sqrt(n);
  let qSum = 0;
  let maxAbsVal = 0;
  let maxAbsLag = 1;
  const sigLags = [];
  for (let k = 1; k <= maxLag; k++) {
    const rk = acf[k - 1];
    qSum += (rk * rk) / (n - k);
    if (Math.abs(rk) > maxAbsVal) { maxAbsVal = Math.abs(rk); maxAbsLag = k; }
    if (Math.abs(rk) > ci95) sigLags.push(k);
  }
  const lbQ = n * (n + 2) * qSum;
  const lbP = _extChi2UpperP(lbQ, maxLag);

  return {
    insufficient: false,
    n,
    maxLag,
    ci95,
    acf,
    pacf,
    lbQ,
    lbP,
    maxAbsLag,
    maxAbsVal,
    sigLags,
  };
}

/**
 * 1.4 製程能力四象限（Ca 規格中點偏移 % × Cp 精密度）
 */
export function calcCaCpQuadrant(rows, metric, spec, keyFn) {
  if (!spec || spec.lsl == null || spec.usl == null || !Number.isFinite(spec.lsl) || !Number.isFinite(spec.usl) || spec.usl <= spec.lsl) {
    return { insufficient: true, reason: "此量測項目缺少雙邊規格上下限，無法繪製四象限圖", pts: [], counts: { healthy: 0, offCenter: 0, highVar: 0, both: 0 } };
  }
  const midpoint = (spec.lsl + spec.usl) / 2;
  const halfTol = (spec.usl - spec.lsl) / 2;
  const asymmetricTarget = spec.tgt != null && Number.isFinite(spec.tgt) && Math.abs(spec.tgt - midpoint) > 1e-6;

  const buckets = new Map();
  for (let i = 0; i < (rows ? rows.length : 0); i++) {
    const r = rows[i];
    const v = r && r[metric];
    if (v == null || !Number.isFinite(v)) continue;
    const k = String(keyFn(r) ?? "").trim() || "未分類";
    let b = buckets.get(k);
    if (!b) { b = { n: 0, sum: 0, sum2: 0 }; buckets.set(k, b); }
    b.n += 1;
    b.sum += v;
    b.sum2 += v * v;
  }

  const pts = [];
  const counts = { healthy: 0, offCenter: 0, highVar: 0, both: 0, zeroVar: 0 };
  const finiteCps = [];
  for (const [key, b] of buckets.entries()) {
    if (b.n < 5) continue;
    const mean = b.sum / b.n;
    const variance = Math.max(0, (b.sum2 - (b.sum * b.sum) / b.n) / (b.n - 1));
    const sd = Math.sqrt(variance);
    const ca = ((mean - midpoint) / halfTol) * 100;
    if (sd <= 1e-12) {
      counts.zeroVar += 1;
      pts.push({ key, n: b.n, mean, sd: 0, ca, cp: null, cpk: null, zone: "zeroVar", zeroVar: true, capped: false });
      continue;
    }
    const cp = (spec.usl - spec.lsl) / (6 * sd);
    const cpk = cp * (1 - Math.abs(ca) / 100);
    let zone = "both";
    if (cpk >= 1.33) { zone = "healthy"; counts.healthy += 1; }
    else if (cp >= 1.33) { zone = "offCenter"; counts.offCenter += 1; }
    else if (Math.abs(ca) <= 25) { zone = "highVar"; counts.highVar += 1; }
    else { zone = "both"; counts.both += 1; }
    finiteCps.push(cp);
    pts.push({ key, n: b.n, mean, sd, ca, cp, cpk, zone, zeroVar: false, capped: false });
  }

  if (!pts.length) {
    return { insufficient: true, reason: "範圍內各分組有效樣本均少於 5 筆，無法計算四象限能力", midpoint, asymmetricTarget, pts: [], counts };
  }

  // 極端高 Cp 動態軟上限（避免單一超高 Cp 點壓扁 0.5–2.5 主區間）
  finiteCps.sort((a, b) => a - b);
  const p95 = finiteCps.length ? finiteCps[Math.min(finiteCps.length - 1, Math.floor((finiteCps.length - 1) * 0.95))] : 3.5;
  const maxCp = finiteCps.length ? finiteCps[finiteCps.length - 1] : 3.5;
  const softYMax = maxCp > 5 ? Math.min(maxCp, Math.max(3.5, Math.min(6, p95 * 1.25))) : Math.max(2.5, maxCp * 1.15);
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].cp != null && pts[i].cp > softYMax) pts[i].capped = true;
  }

  // 依 Cpk 由低到高排序（方便取前 5 大失衡群組給 AI 摘要）
  pts.sort((a, b) => (a.cpk ?? Infinity) - (b.cpk ?? Infinity));

  return {
    insufficient: false,
    midpoint,
    asymmetricTarget,
    softYMax,
    counts,
    pts,
  };
}

/**
 * 1.5 滑動視窗 Cpk 趨勢（單趟滑動累加 O(N)，標準常態估算）
 */
export function calcRollingCpk(boardGroups, spec, windowSize = 5) {
  if (!spec || spec.lsl == null || spec.usl == null || !Number.isFinite(spec.lsl) || !Number.isFinite(spec.usl) || spec.usl <= spec.lsl) {
    return { insufficient: true, reason: "缺少雙邊規格上下限，無法計算滑動 Cpk", windowSize, slope: null, pts: [] };
  }
  const B = Array.isArray(boardGroups) ? boardGroups : [];
  if (B.length < 3) {
    return { insufficient: true, reason: "有效板數少於 3 片，無法計算滑動 Cpk 趨勢", windowSize, slope: null, pts: [] };
  }
  const W = Math.max(2, Math.min(Math.floor(windowSize) || 5, B.length));

  // 預先計算每片的 n, sum, sum2
  const stats = B.map((bg) => {
    const vals = bg && Array.isArray(bg.vals) ? bg.vals : [];
    let n = 0, sum = 0, sum2 = 0;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v != null && Number.isFinite(v)) { n++; sum += v; sum2 += v * v; }
    }
    return { lab: bg.lab, n, sum, sum2 };
  });

  let winN = 0, winSum = 0, winSum2 = 0;
  const pts = [];
  for (let i = 0; i < stats.length; i++) {
    winN += stats[i].n;
    winSum += stats[i].sum;
    winSum2 += stats[i].sum2;
    if (i >= W) {
      winN -= stats[i - W].n;
      winSum -= stats[i - W].sum;
      winSum2 -= stats[i - W].sum2;
    }
    if (i >= W - 1) {
      let cp = null, cpk = null;
      if (winN >= 2) {
        const mu = winSum / winN;
        const vr = Math.max(0, (winSum2 - (winSum * winSum) / winN) / (winN - 1));
        const s = Math.sqrt(vr);
        if (s > 1e-12) {
          cp = (spec.usl - spec.lsl) / (6 * s);
          cpk = Math.min((spec.usl - mu) / (3 * s), (mu - spec.lsl) / (3 * s));
        }
      }
      pts.push({ lab: stats[i].lab, cp, cpk, n: winN });
    }
  }

  // 線性斜率（每片板 Cpk 變化量）
  const valid = pts.map((p, idx) => (p.cpk != null && Number.isFinite(p.cpk) ? { x: idx, y: p.cpk } : null)).filter(Boolean);
  let slope = null;
  if (valid.length >= 2) {
    let sx = 0, sy = 0;
    for (let i = 0; i < valid.length; i++) { sx += valid[i].x; sy += valid[i].y; }
    const mx = sx / valid.length, my = sy / valid.length;
    let num = 0, den = 0;
    for (let i = 0; i < valid.length; i++) {
      const dx = valid[i].x - mx;
      num += dx * (valid[i].y - my);
      den += dx * dx;
    }
    slope = den > 0 ? num / den : 0;
  }

  return {
    insufficient: false,
    windowSize: W,
    downgraded: W < (Math.floor(windowSize) || 5),
    slope,
    pts,
  };
}

/* ==================== 階段二純統計引擎 ==================== */

function _extErfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(
    -z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
    t * (-0.82215223 + t * 0.17087277))))))))
  );
  return x >= 0 ? r : 2 - r;
}

function _extTwoTailNormalP(z) {
  if (!Number.isFinite(z)) return 1;
  return Math.max(0, Math.min(1, _extErfc(Math.abs(z) / Math.SQRT2)));
}

function _extTwoTailTP(tAbs, df) {
  if (!Number.isFinite(tAbs) || df <= 0) return 1;
  if (df >= 120) return _extTwoTailNormalP(tAbs);
  // Hill / Cornish-Fisher 精確近似（誤差 < 1e-4）
  const a = df - 0.5;
  const b = 48 * a * a;
  const z2 = a * Math.log(1 + (tAbs * tAbs) / df);
  const z = Math.sqrt(Math.max(0, z2)) * (1 + (((-0.4 * z2 - 3.3) * z2 - 24.0) * z2 - 85.5) / (0.8 * z2 * z2 + 100 + b));
  return _extTwoTailNormalP(z);
}

function _extStrokeNorm(r) {
  if (!r || r.stroke == null) return null;
  const s = String(r.stroke).trim().toUpperCase();
  if (!s) return null;
  if (/^(F|FWD|FORWARD|FRONT|1|A|前|正|去|\+)$/.test(s)) return "F";
  if (/^(R|REV|REVERSE|BACK|BWD|2|B|後|反|回|-)$/.test(s)) return "R";
  return s;
}

function _extPhysXY(r) {
  if (!r) return null;
  if (r.x != null && r.y != null && Number.isFinite(r.x) && Number.isFinite(r.y) && !r.gridPos) {
    return { x: r.x, y: r.y, level: "pad" };
  }
  if (r.componentX != null && r.componentY != null && Number.isFinite(r.componentX) && Number.isFinite(r.componentY)) {
    return { x: r.componentX, y: r.componentY, level: "comp" };
  }
  return null;
}

/**
 * 2.1a 變異數分解（序列型群組調整＋巢狀 板間 → 子板間 → 板內殘差，單趟 O(N)）
 */
export function calcVarianceComponents(rows, metric) {
  const valid = [];
  for (let i = 0; i < (rows ? rows.length : 0); i++) {
    const r = rows[i];
    const v = r && r[metric];
    if (v != null && Number.isFinite(v)) valid.push(r);
  }
  const N = valid.length;
  if (N < 6) {
    return { insufficient: true, reason: "有效樣本少於 6 筆，無法進行變異數分解", n: N, layers: [], dominant: null };
  }

  // Step 1: 統計群組均值與總均值
  let totSum = 0;
  const gStat = new Map();
  for (let i = 0; i < N; i++) {
    const r = valid[i];
    const v = r[metric];
    totSum += v;
    const g = r.group != null && String(r.group).trim() ? String(r.group).trim() : "未分類";
    let gs = gStat.get(g);
    if (!gs) { gs = { n: 0, sum: 0 }; gStat.set(g, gs); }
    gs.n += 1;
    gs.sum += v;
  }
  const grandMean = totSum / N;
  let ssTotal = 0;
  for (let i = 0; i < N; i++) {
    const d = valid[i][metric] - grandMean;
    ssTotal += d * d;
  }
  if (ssTotal <= 1e-12) {
    return { insufficient: true, reason: "範圍內量測值無變異，無法分解變異來源", n: N, layers: [], dominant: null };
  }

  const hasMultiGroup = gStat.size > 1;
  const gMeanMap = new Map();
  let ssGroup = 0;
  for (const [g, gs] of gStat.entries()) {
    const mu = gs.sum / gs.n;
    gMeanMap.set(g, mu);
    if (hasMultiGroup) {
      const d = mu - grandMean;
      ssGroup += gs.n * d * d;
    }
  }

  // Step 2: 對群組去中心後之殘差做嚴格巢狀分解：板間 → 子板間（若同板具 >1 子板）→ 板內焊墊殘差
  const bMap = new Map();
  const bfMap = new Map();
  const figPerBoard = new Map();
  for (let i = 0; i < N; i++) {
    const r = valid[i];
    const g = r.group != null && String(r.group).trim() ? String(r.group).trim() : "未分類";
    const e = hasMultiGroup ? (r[metric] - gMeanMap.get(g)) : (r[metric] - grandMean);
    const b = r.board != null ? String(r.board) : "";
    const fig = r.figure != null && String(r.figure).trim() ? String(r.figure).trim() : "";

    let bs = bMap.get(b);
    if (!bs) { bs = { n: 0, sum: 0 }; bMap.set(b, bs); }
    bs.n += 1;
    bs.sum += e;

    if (fig) {
      let fset = figPerBoard.get(b);
      if (!fset) { fset = new Set(); figPerBoard.set(b, fset); }
      fset.add(fig);
    }
    const bfk = b + "\x1f" + fig;
    let bfs = bfMap.get(bfk);
    if (!bfs) { bfs = { b, fig, n: 0, sum: 0 }; bfMap.set(bfk, bfs); }
    bfs.n += 1;
    bfs.sum += e;
  }

  let hasMultiFigure = false;
  for (const fset of figPerBoard.values()) {
    if (fset.size > 1) { hasMultiFigure = true; break; }
  }
  const hasMultiBoard = bMap.size > 1;

  let ssBoard = 0;
  const bMeanMap = new Map();
  for (const [b, bs] of bMap.entries()) {
    const mu = bs.sum / bs.n;
    bMeanMap.set(b, mu);
    if (hasMultiBoard) ssBoard += bs.n * mu * mu;
  }

  let ssFigure = 0;
  if (hasMultiFigure) {
    for (const bfs of bfMap.values()) {
      const bMu = bMeanMap.get(bfs.b) || 0;
      const fMu = bfs.sum / bfs.n;
      const d = fMu - bMu;
      ssFigure += bfs.n * d * d;
    }
  }

  const ssWithin = Math.max(0, ssTotal - ssGroup - ssBoard - ssFigure);

  const layers = [];
  const pushLayer = (key, label, ss) => {
    const pct = (ss / ssTotal) * 100;
    layers.push({ key, label, ss, pct });
  };
  if (hasMultiGroup) pushLayer("group", "元件群組間（開孔／設計）", ssGroup);
  if (hasMultiBoard) pushLayer("board", "板間（製程漂移）", ssBoard);
  if (hasMultiFigure) pushLayer("figure", "子板間（拼板／支撐）", ssFigure);
  pushLayer("within", "板內焊墊殘差（位置／脫模）", ssWithin);

  // 確保百分比總和精確為 100%
  const rawSum = layers.reduce((s, l) => s + l.pct, 0) || 1;
  for (let i = 0; i < layers.length; i++) layers[i].pct = (layers[i].pct / rawSum) * 100;
  const dominant = layers.reduce((best, cur) => (!best || cur.pct > best.pct ? cur : best), null);

  return {
    insufficient: false,
    n: N,
    ssTotal,
    hasMultiGroup,
    hasMultiBoard,
    hasMultiFigure,
    layers,
    dominant,
  };
}

/**
 * 2.1b 多變異圖（Multi-Vari：各板內分層平均與 P10–P90 跨度）
 */
export function calcMultiVari(rows, metric, boardOrder, maxBoards = 30) {
  const valid = [];
  for (let i = 0; i < (rows ? rows.length : 0); i++) {
    const r = rows[i];
    const v = r && r[metric];
    if (v != null && Number.isFinite(v)) valid.push(r);
  }
  if (valid.length < 6) return { insufficient: true, reason: "有效樣本不足，無法繪製多變異圖", boards: [], strata: [] };

  const byBoard = new Map();
  const figSet = new Set();
  const grpCounts = new Map();
  for (let i = 0; i < valid.length; i++) {
    const r = valid[i];
    const b = r.board != null ? String(r.board) : "";
    let list = byBoard.get(b);
    if (!list) { list = []; byBoard.set(b, list); }
    list.push(r);
    if (r.figure != null && String(r.figure).trim()) figSet.add(String(r.figure).trim());
    const g = r.group != null && String(r.group).trim() ? String(r.group).trim() : "未分類";
    grpCounts.set(g, (grpCounts.get(g) || 0) + 1);
  }

  let boards = Array.isArray(boardOrder) && boardOrder.length
    ? boardOrder.filter((b) => byBoard.has(String(b))).map(String)
    : [...byBoard.keys()];
  for (const b of byBoard.keys()) if (!boards.includes(b)) boards.push(b);
  if (!boards.length) return { insufficient: true, reason: "無有效板序資料", boards: [], strata: [] };

  let subsampled = false;
  if (boards.length > maxBoards) {
    subsampled = true;
    const picked = [];
    for (let i = 0; i < maxBoards; i++) {
      const idx = Math.min(boards.length - 1, Math.round((i * (boards.length - 1)) / (maxBoards - 1)));
      if (!picked.includes(boards[idx])) picked.push(boards[idx]);
    }
    boards = picked;
  }

  // 分層優先序：子板（>1）→ 前 3 大群組（>1）→ 全板單層
  let strataBy = "board";
  let strataKeys = ["全板"];
  if (figSet.size > 1) {
    strataBy = "figure";
    strataKeys = [...figSet].sort().slice(0, 6);
  } else if (grpCounts.size > 1) {
    strataBy = "group";
    strataKeys = [...grpCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x[0]);
  }

  const quantOf = (sorted, q) => {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };

  const strata = strataKeys.map((sk) => {
    const pts = boards.map((b) => {
      const rs = byBoard.get(b) || [];
      const vals = [];
      let sum = 0;
      for (let i = 0; i < rs.length; i++) {
        const r = rs[i];
        const match = strataBy === "board" ? true
          : strataBy === "figure" ? String(r.figure ?? "").trim() === sk
            : (String(r.group ?? "").trim() || "未分類") === sk;
        if (!match) continue;
        const v = r[metric];
        if (v != null && Number.isFinite(v)) { vals.push(v); sum += v; }
      }
      if (!vals.length) return { board: b, n: 0, mean: null, p10: null, p90: null };
      vals.sort((a, b2) => a - b2);
      return { board: b, n: vals.length, mean: sum / vals.length, p10: quantOf(vals, 0.1), p90: quantOf(vals, 0.9) };
    });
    return { key: sk, pts };
  });

  return { insufficient: false, strataBy, subsampled, totalBoards: byBoard.size, boards, strata };
}

/**
 * 2.2 二維偏移靶心圖與 95% 信賴橢圓（含前／後行程雙橢圓與雙變量 Hotelling T² 背隙檢定）
 */
export function calcOffsetEllipse(rows, specs, opts = {}) {
  const coreOnly = Boolean(opts && opts.coreOnly);
  const maxScatter = (opts && opts.maxScatter) || 4000;
  const pts = [];
  for (let i = 0; i < (rows ? rows.length : 0); i++) {
    const r = rows[i];
    if (r && r.offx != null && r.offy != null && Number.isFinite(r.offx) && Number.isFinite(r.offy)) {
      pts.push({ x: r.offx, y: r.offy, s: _extStrokeNorm(r) });
    }
  }
  const N = pts.length;
  if (N < 5) {
    return { insufficient: true, reason: "有效 X／Y 偏移量測少於 5 筆，無法繪製二維偏移靶心圖", n: N };
  }

  const fit2D = (arr) => {
    const n = arr.length;
    if (n < 3) return null;
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += arr[i].x; sy += arr[i].y; }
    const mx = sx / n, my = sy / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      const dx = arr[i].x - mx, dy = arr[i].y - my;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    const denom = Math.max(1, n - 1);
    const cxx = sxx / denom, cyy = syy / denom, cxy = sxy / denom;
    const det = cxx * cyy - cxy * cxy;
    const singular = !Number.isFinite(det) || det <= 1e-12;
    const ellipse = [];
    if (!coreOnly && !singular) {
      const tr = cxx + cyy;
      const disc = Math.sqrt(Math.max(0, (cxx - cyy) * (cxx - cyy) + 4 * cxy * cxy));
      const l1 = Math.max(0, (tr + disc) / 2);
      const l2 = Math.max(0, (tr - disc) / 2);
      const a = Math.sqrt(5.9914645 * l1);
      const b = Math.sqrt(5.9914645 * l2);
      const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
      const ct = Math.cos(theta), st = Math.sin(theta);
      const segs = 64;
      for (let i = 0; i <= segs; i++) {
        const ang = (i / segs) * Math.PI * 2;
        const ex = a * Math.cos(ang), ey = b * Math.sin(ang);
        ellipse.push({ x: mx + ex * ct - ey * st, y: my + ex * st + ey * ct });
      }
    }
    return { n, mx, my, cxx, cyy, cxy, det, singular, ellipse };
  };

  const overall = fit2D(pts);
  const fwd = pts.filter((p) => p.s === "F");
  const rev = pts.filter((p) => p.s === "R");
  let strokeSplit = { valid: false, backlashUm: null, p: null, t2: null, fwd: null, rev: null };

  if (fwd.length >= 5 && rev.length >= 5) {
    const fFit = fit2D(fwd);
    const rFit = fit2D(rev);
    const dx = fFit.mx - rFit.mx;
    const dy = fFit.my - rFit.my;
    const backlashUm = Math.hypot(dx, dy);
    // Pooled 2x2 covariance for 2-sample Hotelling T²
    const df = fFit.n + rFit.n - 2;
    const pxx = ((fFit.n - 1) * fFit.cxx + (rFit.n - 1) * rFit.cxx) / df;
    const pyy = ((fFit.n - 1) * fFit.cyy + (rFit.n - 1) * rFit.cyy) / df;
    const pxy = ((fFit.n - 1) * fFit.cxy + (rFit.n - 1) * rFit.cxy) / df;
    const pDet = pxx * pyy - pxy * pxy;
    let t2 = null, p = null;
    if (Number.isFinite(pDet) && pDet > 1e-12 && df > 2) {
      const invXX = pyy / pDet, invYY = pxx / pDet, invXY = -pxy / pDet;
      const quad = dx * dx * invXX + 2 * dx * dy * invXY + dy * dy * invYY;
      t2 = ((fFit.n * rFit.n) / (fFit.n + rFit.n)) * quad;
      const Fstat = ((df - 1) / (2 * df)) * t2;
      // 精確 F(2, df-1) 上尾機率：P(F_{2, v} > x) = (1 + 2x/v)^(-v/2)
      const v = df - 1;
      p = Fstat > 0 ? Math.pow(1 + (2 * Fstat) / v, -v / 2) : 1;
    }
    strokeSplit = { valid: true, backlashUm, dx, dy, t2, p, fwd: fFit, rev: rFit };
  }

  // 散點抽樣（僅供繪點，統計與橢圓採 100% 全量）
  let scatter = [];
  let sampled = false;
  if (!coreOnly) {
    if (N <= maxScatter) {
      scatter = pts;
    } else {
      sampled = true;
      const step = N / maxScatter;
      for (let i = 0; i < maxScatter; i++) scatter.push(pts[Math.floor(i * step)]);
    }
  }

  const spX = specs && specs.offx ? specs.offx : null;
  const spY = specs && specs.offy ? specs.offy : null;

  return {
    insufficient: false,
    n: N,
    sampled,
    shownCount: scatter.length,
    overall,
    strokeSplit,
    scatter,
    specBox: spX && spY && spX.lsl != null && spX.usl != null && spY.lsl != null && spY.usl != null
      ? { x0: spX.lsl, x1: spX.usl, y0: spY.lsl, y1: spY.usl }
      : null,
  };
}

/**
 * 2.3 板面 X / Y 邊際剖面梯度圖（嚴格遵守實體座標優先與虛擬網格 fail-visible 守則）
 */
export function calcBoardProfileXY(rows, metric, opts = {}) {
  const binCount = Math.max(4, Math.min(20, Math.floor((opts && opts.bins) || 10)));
  const phys = [];
  let padCount = 0, compCount = 0;
  for (let i = 0; i < (rows ? rows.length : 0); i++) {
    const r = rows[i];
    const v = r && r[metric];
    if (v == null || !Number.isFinite(v)) continue;
    const xy = _extPhysXY(r);
    if (!xy) continue;
    if (xy.level === "pad") padCount++; else compCount++;
    phys.push({ x: xy.x, y: xy.y, v, s: _extStrokeNorm(r) });
  }
  if (phys.length < 6) {
    return {
      insufficient: true,
      reason: "virtual_grid",
      message: "無實際物理座標（或僅有虛擬網格示意排列），無法計算板面 X／Y 邊際梯度",
      n: phys.length,
    };
  }

  const analyzeAxis = (coordKey) => {
    let lo = Infinity, hi = -Infinity;
    let sx = 0, sy = 0;
    for (let i = 0; i < phys.length; i++) {
      const c = phys[i][coordKey];
      if (c < lo) lo = c;
      if (c > hi) hi = c;
      sx += c;
      sy += phys[i].v;
    }
    const span = hi - lo;
    const n = phys.length;
    if (!Number.isFinite(span) || span <= 1e-6) {
      const mu = sy / n;
      return {
        degenerate: true,
        min: lo,
        max: hi,
        span: 0,
        slopePer100mm: null,
        p: null,
        bins: [{ center: lo, lo, hi, n, mean: mu, ciLo: mu, ciHi: mu, fwdMean: null, revMean: null }],
      };
    }

    // 全量線性迴歸斜率與雙尾 t 檢定 p 值
    const mx = sx / n, my = sy / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = phys[i][coordKey] - mx, dy = phys[i].v - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    const slope = sxx > 0 ? sxy / sxx : 0;
    const slopePer100mm = slope * 100;
    const sse = Math.max(0, syy - slope * sxy);
    const seSlope = n > 2 && sxx > 0 ? Math.sqrt((sse / (n - 2)) / sxx) : NaN;
    const tStat = Number.isFinite(seSlope) && seSlope > 1e-12 ? Math.abs(slope / seSlope) : 0;
    const p = n > 2 ? _extTwoTailTP(tStat, n - 2) : 1;

    // 等寬區帶統計（含前／後行程分線）
    const acc = Array.from({ length: binCount }, (_, idx) => ({
      lo: lo + (idx * span) / binCount,
      hi: lo + ((idx + 1) * span) / binCount,
      n: 0, sum: 0, sum2: 0,
      fN: 0, fSum: 0, rN: 0, rSum: 0,
    }));
    for (let i = 0; i < n; i++) {
      const c = phys[i][coordKey], v = phys[i].v;
      const bi = Math.min(binCount - 1, Math.max(0, Math.floor(((c - lo) / span) * binCount)));
      const b = acc[bi];
      b.n++; b.sum += v; b.sum2 += v * v;
      if (phys[i].s === "F") { b.fN++; b.fSum += v; }
      else if (phys[i].s === "R") { b.rN++; b.rSum += v; }
    }
    const bins = acc.map((b) => {
      const center = (b.lo + b.hi) / 2;
      if (!b.n) return { center, lo: b.lo, hi: b.hi, n: 0, mean: null, ciLo: null, ciHi: null, fwdMean: null, revMean: null };
      const mu = b.sum / b.n;
      const vr = b.n > 1 ? Math.max(0, (b.sum2 - (b.sum * b.sum) / b.n) / (b.n - 1)) : 0;
      const se = b.n > 1 ? Math.sqrt(vr / b.n) : 0;
      const half = 1.96 * se;
      return {
        center, lo: b.lo, hi: b.hi, n: b.n,
        mean: mu, ciLo: mu - half, ciHi: mu + half,
        fwdMean: b.fN > 0 ? b.fSum / b.fN : null,
        revMean: b.rN > 0 ? b.rSum / b.rN : null,
      };
    });
    return { degenerate: false, min: lo, max: hi, span, slopePer100mm, p, bins };
  };

  const hasStroke = phys.some((p) => p.s === "F") && phys.some((p) => p.s === "R");
  return {
    insufficient: false,
    n: phys.length,
    coordLevel: padCount >= compCount ? "pad" : "comp",
    hasStroke,
    xAxis: analyzeAxis("x"),
    yAxis: analyzeAxis("y"),
  };
}

/**
 * 2.4 鋼板開孔方向效應（0° 平行 vs 90° 垂直刮刀方向，含無方向性欄位防呆與面積比分層）
 */
export function calcApertureOrientation(rows, metric, sqDir = "Y", opts = {}) {
  const thkUm = (opts && opts.stencilUm) || 120;
  const thkMm = thkUm / 1000;
  const par = [], perp = [], sq = [];
  const buckets = {
    low: { par: [], perp: [], label: "AR < 0.66" },
    mid: { par: [], perp: [], label: "0.66 ≤ AR ≤ 0.75" },
    high: { par: [], perp: [], label: "AR > 0.75" },
  };
  let usedAperture = 0, usedPad = 0;
  for (let i = 0; i < (rows ? rows.length : 0); i++) {
    const r = rows[i];
    const v = r && r[metric];
    if (v == null || !Number.isFinite(v)) continue;
    let lx = null, ly = null;
    if (r.apl != null && r.apw != null && r.apl > 0 && r.apw > 0) { lx = r.apl; ly = r.apw; usedAperture++; }
    else if (r.padl != null && r.padw != null && r.padl > 0 && r.padw > 0) { lx = r.padl; ly = r.padw; usedPad++; }
    if (lx == null || ly == null) continue;

    const ar = (lx * ly) / (2 * (lx + ly) * thkMm);
    const bk = ar < 0.66 ? buckets.low : ar <= 0.75 ? buckets.mid : buckets.high;
    const ratio = Math.max(lx, ly) / Math.min(lx, ly);
    if (ratio < 1.25) {
      sq.push(v);
    } else {
      const longIsX = lx > ly;
      const isParallel = (sqDir === "X" && longIsX) || (sqDir !== "X" && !longIsX);
      if (isParallel) { par.push(v); bk.par.push(v); }
      else { perp.push(v); bk.perp.push(v); }
    }
  }

  const total = par.length + perp.length + sq.length;
  if (total < 6) {
    return { insufficient: true, reason: "缺少開孔或焊墊長寬尺寸（apl/apw 或 padl/padw），無法分析開孔方向效應", total };
  }

  const statOf = (arr) => {
    const n = arr.length;
    if (!n) return { n: 0, mean: null, sd: null, ciHalf: null };
    let s = 0, s2 = 0;
    for (let i = 0; i < n; i++) { s += arr[i]; s2 += arr[i] * arr[i]; }
    const mu = s / n;
    const vr = n > 1 ? Math.max(0, (s2 - (s * s) / n) / (n - 1)) : 0;
    const sd = Math.sqrt(vr);
    return { n, mean: mu, sd, ciHalf: n > 1 ? 1.96 * (sd / Math.sqrt(n)) : 0 };
  };

  const sPar = statOf(par), sPerp = statOf(perp), sSq = statOf(sq);
  const singleAxisOnly = (par.length === 0 && perp.length > 0) || (perp.length === 0 && par.length > 0);
  if (singleAxisOnly || (par.length < 2 && perp.length < 2)) {
    return {
      insufficient: false,
      singleAxisOnly: true,
      message: "僅偵測到單一長軸方向，可能因匯入欄位為不分軸向的長／寬而非 X／Y 軸尺寸",
      dimSource: usedAperture >= usedPad ? "開孔尺寸" : "焊墊尺寸",
      sqDir: sqDir === "X" ? "X" : "Y",
      parallel: sPar,
      perpendicular: sPerp,
      square: sSq,
      diff: null,
      p: null,
      cohenD: null,
      arBuckets: [],
    };
  }

  // Welch t-test & Cohen's d
  const diff = sPar.mean - sPerp.mean;
  const v1 = (sPar.sd * sPar.sd) / sPar.n;
  const v2 = (sPerp.sd * sPerp.sd) / sPerp.n;
  const se = Math.sqrt(v1 + v2);
  let p = 1;
  if (se > 1e-12) {
    const t = Math.abs(diff) / se;
    const dfNum = (v1 + v2) * (v1 + v2);
    const dfDen = (v1 * v1) / Math.max(1, sPar.n - 1) + (v2 * v2) / Math.max(1, sPerp.n - 1);
    const df = dfDen > 0 ? dfNum / dfDen : sPar.n + sPerp.n - 2;
    p = _extTwoTailTP(t, df);
  }
  const pooledSd = Math.sqrt((((sPar.n - 1) * sPar.sd * sPar.sd) + ((sPerp.n - 1) * sPerp.sd * sPerp.sd)) / Math.max(1, sPar.n + sPerp.n - 2));
  const cohenD = pooledSd > 1e-12 ? diff / pooledSd : 0;

  const arBuckets = Object.values(buckets).map((bk) => ({
    label: bk.label,
    parallel: statOf(bk.par),
    perpendicular: statOf(bk.perp),
  })).filter((b) => b.parallel.n > 0 || b.perpendicular.n > 0);

  return {
    insufficient: false,
    singleAxisOnly: false,
    dimSource: usedAperture >= usedPad ? "開孔尺寸" : "焊墊尺寸",
    sqDir: sqDir === "X" ? "X" : "Y",
    parallel: sPar,
    perpendicular: sPerp,
    square: sSq,
    diff,
    p,
    cohenD,
    arBuckets,
  };
}
