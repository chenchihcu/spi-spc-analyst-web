#!/usr/bin/env node
import fs from "node:fs";
import { loadCoreFromHtml } from "./html-core.mjs";

const HTML = "/tmp/spi-db17c7ba.html";
const { core } = loadCoreFromHtml(HTML);

function baseSt(rows, specsOverride) {
  return {
    ...core.S,
    rows,
    metrics: ["volume", "height", "hpct", "area", "offx", "offy"],
    metric: "volume",
    group: core.ALL_GRP,
    stencil: 120,
    specSrc: "part",
    specs: { ...core.DEF_SPECS, ...specsOverride },
    specsG: {},
    partSpec: { part: "SYN", ver: 1, sha: "0", stencilRef: 120 },
    step: { on: false, zones: [] },
    sqDir: "Y",
  };
}

function mkRows(boards, padsPerBoard, valFn) {
  const rows = [];
  for (const b of boards) {
    for (let p = 0; p < padsPerBoard; p++) {
      const v = valFn(b, p);
      rows.push({
        board: b,
        pad: `${b}-P${p + 1}`,
        comp: "U1",
        group: "U1",
        x: p * 2,
        y: 0,
        w: 0.5,
        d: 0.5,
        volume: v.volume ?? 100,
        height: v.height ?? 120,
        hpct: v.hpct ?? 100,
        area: v.area ?? 100,
        offx: 0,
        offy: 0,
        bridgemargin: v.bridgemargin,
        peaking: v.peaking,
        ts: v.ts,
      });
    }
  }
  return rows;
}

const out = { sha: "db17c7bae687ec141511ee52828b2ad61fd50606" };

// X1 M-03
{
  const boards = ["B01", "B02", "B03", "B04", "B05", "B06"];
  const bmWide = [0, 1, 0, 1, 0, 1];
  const rowsWide = mkRows(boards, 2, (b) => {
    const m = bmWide[boards.indexOf(b)];
    return { volume: m + 0.05, height: 120, area: 100 };
  });
  const stWide = baseSt(rowsWide, { volume: { lsl: -1000, usl: 1000, tgt: 0 } });
  const Fw = core.detectIssues(stWide);
  const m03w = Fw.filter((x) => x.rule_id === "M-03 單位不符");
  const bmShift = [99, 100, 99, 100, 99, 100];
  const rowsShift = mkRows(boards, 2, (b) => {
    const m = bmShift[boards.indexOf(b)];
    return { volume: m + 0.05, height: 120, area: 100 };
  });
  const stShift = baseSt(rowsShift, { volume: { lsl: 0, usl: 20, tgt: 10 } });
  const Fs = core.detectIssues(stShift);
  const m03s = Fs.filter((x) => x.rule_id === "M-03 單位不符");
  const kv = rowsWide.map((r) => r.volume);
  const mu = core.mean(kv);
  const sd = core.sd(kv);
  const sc = 0;
  const cpk =
    sd > 0
      ? Math.min((stWide.specs.volume.usl - mu) / (3 * sd), (mu - stWide.specs.volume.lsl) / (3 * sd))
      : NaN;
  out.m03 = {
    wide: { cpk, centerDistOverSd: sd > 0 ? Math.abs(sc - mu) / sd : null, m03Cards: m03w.length },
    shift: {
      m03Cards: m03s.length,
      title: m03s[0]?.title,
    },
  };
}

// X2 morph + pause
{
  const boards = ["B01", "B02", "B03", "B04", "B05", "B06"];
  const rowsBridge = mkRows(boards, 4, (b, p) => ({
    volume: 100,
    height: 120,
    bridgemargin: b === "B01" && p < 3 ? 10 : 50,
  }));
  const Fb = core.detectIssues(baseSt(rowsBridge, {}));
  const bridge = Fb.find((x) => x.rule_id === "形貌缺陷 橋接餘裕");
  const rowsPeak = mkRows(boards, 4, (b, p) => ({
    volume: 100,
    height: 120,
    peaking: b === "B02" && p < 3 ? 40 : 5,
  }));
  const Fp = core.detectIssues(baseSt(rowsPeak, {}));
  const peak = Fp.find((x) => x.rule_id === "形貌缺陷 脫模拉尖");
  const t0 = Date.parse("2026-01-01T08:00:00Z");
  const bmPause = [150, 120, 90, 130, 110, 100];
  const rowsPause = mkRows(boards, 2, (b) => {
    const i = boards.indexOf(b);
    return { volume: bmPause[i], ts: t0 + i * (i === 2 ? 25 * 60 * 1000 : 5 * 60 * 1000) };
  });
  const Fpause = core.detectIssues(baseSt(rowsPause, {}));
  const pause = Fpause.find((x) => x.rule_id === "停線時效 PauseDecay");
  out.morph = {
    bridge: bridge
      ? { values: bridge.ev?.values, unit: bridge.ev?.unit, perBoardCounts: boards.map((b) => rowsBridge.filter((r) => r.board === b && r.bridgemargin < 25).length) }
      : null,
    peak: peak
      ? { values: peak.ev?.values, unit: peak.ev?.unit, perBoardCounts: boards.map((b) => rowsPeak.filter((r) => r.board === b && r.peaking > 35).length) }
      : null,
    pause: pause
      ? {
          values: pause.ev?.values,
          boardMeans: bmPause,
          avgDrop: pause.observed,
        }
      : null,
  };
}

// X3 rule 7 + crossValidate text
{
  const boards = Array.from({ length: 15 }, (_, i) => `B${String(i + 1).padStart(2, "0")}`);
  const delta = [1, -1, 1, -1, 1, -1, 1, 1, 1, -1, 1, -1, 1, -1, 1];
  const rows = mkRows(boards, 2, (b) => {
    const i = boards.indexOf(b);
    return { volume: 100 + delta[i] + 0.05 };
  });
  const st = baseSt(rows, { volume: { lsl: 70, usl: 130, tgt: 100 } });
  const A = core.analyze(st);
  const xv = core.crossValidate(A);
  const xvRows = xv.rows || xv;
  const r7 = A.nelX.rules.find((r) => r.id === 7);
  const other = A.nelX.rules.filter((r) => r.id !== 7 && r.idx.length);
  out.rule7 = {
    rule7Hits: r7.idx.length,
    otherRuleHits: other.map((r) => ({ id: r.id, n: r.idx.length })),
    stable: A.stable,
    flagSize: A.nelX.flag.size,
    crossValidateControl: (Array.isArray(xvRows) ? xvRows : []).find((x) => x.k === "管制狀態")?.ev,
  };
}

// T4 S03 — 6-board + 25-board weighted mismatch
{
  const boards6 = ["B01", "B02", "B03", "B04", "B05", "B06"];
  const nPer = [2, 10, 2, 10, 2, 10];
  const bm6 = [98, 102, 99, 103, 100, 104];
  const rows6 = [];
  boards6.forEach((b, bi) => {
    for (let p = 0; p < nPer[bi]; p++) {
      rows6.push({
        board: b,
        pad: `${b}-P${p}`,
        comp: "U1",
        group: "U1",
        volume: bm6[bi] + (p % 2 ? 0.1 : -0.1),
        height: 120,
        hpct: 100,
        area: 100,
        offx: 0,
        offy: 0,
      });
    }
  });
  const st6 = baseSt(rows6, { volume: { lsl: 70, usl: 130, tgt: 100 } });
  const A6 = core.analyze(st6);
  const F6 = core.detectIssues(st6);
  const nelCards6 = F6.filter((x) => x.rule_id?.includes("Nelson") || x.title?.includes("規則"));
  const chartMu = core.mean(rows6.map((r) => r.volume));
  const cardMu = core.mean(bm6);
  out.center6 = {
    chartCenter: A6.gMean,
    chartMuDirect: chartMu,
    cardCenter: cardMu,
    chartRules: A6.nel.rules.filter((r) => r.idx.length).map((r) => r.id),
    nelsonCards: nelCards6.map((c) => c.rule_id),
    nelXRules: A6.nelX.rules.filter((r) => r.idx.length).map((r) => r.id),
  };

  // 25-board Codex-style: seed 44293 first 24 normals + B10 n=1000
  const boards25 = Array.from({ length: 25 }, (_, i) => `B${String(i + 1).padStart(2, "0")}`);
  let seed = 44293;
  const randn = () => {
    seed = (seed * 48271) % 2147483647;
    const u1 = seed / 2147483647;
    seed = (seed * 48271) % 2147483647;
    const u2 = seed / 2147483647;
    return Math.sqrt(-2 * Math.log(u1 + 1e-12)) * Math.cos(2 * Math.PI * u2);
  };
  const bm25 = boards25.map((_, i) => (i === 9 ? 105 : 100 + randn() * 0.5));
  const rows25 = [];
  boards25.forEach((b, bi) => {
    const n = bi === 9 ? 1000 : 2;
    for (let p = 0; p < n; p++) {
      rows25.push({
        board: b,
        pad: `${b}-P${p}`,
        comp: "U1",
        group: "U1",
        volume: bm25[bi] + (p % 2 ? 0.1 : -0.1),
        height: 120,
        hpct: 100,
        area: 100,
        offx: 0,
        offy: 0,
      });
    }
  });
  const st25 = baseSt(rows25, { volume: { lsl: 70, usl: 130, tgt: 100 } });
  const A25 = core.analyze(st25);
  const F25 = core.detectIssues(st25);
  const nelIssue = F25.filter((x) => x.rule_id?.startsWith("Nelson 規則"));
  out.center25 = {
    chartCenter: A25.gMean,
    cardCenter: core.mean(bm25),
    chartTriggered: A25.nel.rules.filter((r) => r.idx.length && r.id !== 7).map((r) => r.id),
    nelXTriggered: A25.nelX.rules.filter((r) => r.idx.length && r.id !== 7).map((r) => r.id),
    stable: A25.stable,
    nelsonCardCount: nelIssue.length,
    nelsonCardRules: nelIssue.map((c) => c.title?.slice(0, 40)),
  };
}

// AD subsample replication (in JS same as app)
{
  const n = 3000;
  const q = [];
  for (let i = 0; i < n; i++) q.push(core.Phi ? null : null);
  // build quantiles via inverse normal approximation from sorted uniform grid
  const normQ = (p) => {
    // Beasley-Springer-Moro style not available — use precomputed via seed
    return 0;
  };
  const inv = [];
  for (let i = 1; i <= n; i++) {
    const p = (i - 0.5) / n;
    inv.push(Math.sqrt(2) * erfinv(2 * p - 1));
  }
  function erfinv(x) {
    const a = 0.147;
    const ln = Math.log(1 - x * x);
    const f = (2 / (Math.PI * a) + ln / 2) ** 2;
    return Math.sign(x) * Math.sqrt(f - ln / 2);
  }
  const batchA = inv.slice();
  const batchB = inv.map((v) => v + 4);
  const interleaved = [];
  for (let i = 0; i < n; i++) {
    interleaved.push(batchA[i]);
    interleaved.push(batchB[i]);
  }
  const sorted = [...interleaved].sort((a, b) => a - b);
  const step = Math.ceil(sorted.length / 4000);
  const sample = (arr) => arr.filter((_, i) => i % step === 0);
  const adA = core.andersonDarling(sample(interleaved));
  const adB = core.andersonDarling(sample(sorted));
  const adFull = core.andersonDarling(sorted);
  out.ad = {
    n: sorted.length,
    step,
    interleaved: { A: adA.A, p: adA.p },
    sortedSample: { A: adB.A, p: adB.p },
    fullData: { A: adFull.A, p: adFull.p },
  };
}

// D-30 hpct diff user export vs replay @120
{
  const { fullPipeline, PATHS } = await import("./html-core.mjs");
  const pip = fullPipeline({ htmlPath: HTML, stencilUm: 120 });
  const F = pip.F;
  const d30 = F.find((x) => x.rule_id === "孤立極端焊墊（D-30）" && x.metric === "高度%厚");
  out.d30Hpct = { title: d30?.title, level: d30?.level };
}

fs.writeFileSync("/workspace/artifacts/round4-data.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
