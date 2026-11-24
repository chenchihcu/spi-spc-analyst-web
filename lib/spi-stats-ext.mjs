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
