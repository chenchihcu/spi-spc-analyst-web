import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { loadCore, baseState, HTML, withIdb } from "./_load.js";
import { createCloudHarness } from "./_cloud-harness.mjs";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");

const c = loadCore();

function st(rows, extra = {}) {
  return baseState(c, {
    rows,
    metrics: ["volume", "height", "area"],
    metric: "volume",
    group: c.ALL_GRP,
    chart: "xbars",
    specs: { volume: { lsl: 70, usl: 130, tgt: 100 }, height: { lsl: 100, usl: 140, tgt: 120 }, area: { lsl: 80, usl: 120, tgt: 100 } },
    specSrc: "custom",
    ...extra,
  });
}

test("PR-B adSample: n≤4000 回傳原參照", () => {
  const v = [1, 2, 3, 4, 5];
  assert.equal(c.adSample(v), v);
});

test("PR-B adSample: 相同多重集、不同列順序 → 相同 AD p", () => {
  let seed = 7319;
  const rnd = () => ((seed = (1664525 * seed + 1013904223) >>> 0) + 0.5) / 4294967296;
  const normalValues = [];
  for (let i = 0; i < 4000; i++) {
    let sum = 0;
    for (let j = 0; j < 12; j++) sum += rnd();
    normalValues.push(sum - 6);
  }
  const exponentialValues = Array.from({ length: 4000 }, () => -Math.log(rnd()));
  const values = [];
  for (let i = 0; i < 4000; i++) values.push(normalValues[i], exponentialValues[i]);
  const shuffled = values.slice(1).concat(values[0]);
  const pA = c.andersonDarling(c.adSample(values)).p;
  const pB = c.andersonDarling(c.adSample(shuffled)).p;
  assert.equal(pA, pB);
  assert.ok(c.adSample(values).length === 4000);
});

test("PR-B poissonSf: 大 k 上尾以 log 域累加仍為有限遞減值", () => {
  const l = 80;
  const sf40 = c.poissonSf(40, l);
  const sf41 = c.poissonSf(41, l);
  assert.ok(sf40 > sf41, "上尾機率應隨 k 遞減");
  assert.ok(sf41 > 0);
  const legacy = (() => {
    let s = 0;
    let term = Math.exp(-l);
    for (let i = 0; i < 41; i++) {
      s += term;
      term *= l / (i + 1);
    }
    return Math.max(0, 1 - s);
  })();
  assert.ok(Math.abs(sf41 - legacy) < 1e-10 || sf41 > legacy, "log 域實作不應比級數下溢更差");
});

test("PR-B robust: 零變異 fail-closed（s 為 NaN）", () => {
  const { m, s } = c.robust([5, 5, 5, 5]);
  assert.equal(m, 5);
  assert.ok(Number.isNaN(s));
});

test("FIX-1 Nelson 規則 8：兩側皆 |z|>1（回歸 #93）", () => {
  const r8pos = c.nelson(Array(8).fill(1.1)).rules.find((r) => r.id === 8);
  assert.equal(r8pos.idx.length, 0);
  const r8mix = c.nelson([...Array(7).fill(1.1), -1.1]).rules.find((r) => r.id === 8);
  assert.ok(r8mix.idx.length === 8 && r8mix.idx.every((v, i) => v === i));
});

test("FIX-11 空間梯度 rule_name 揭露 N−G−1 自由度", () => {
  const rows = [];
  for (let g = 0; g < 3; g++) {
    for (let p = 0; p < 20; p++) {
      rows.push({
        board: "B01",
        pad: `G${g}-P${p}`,
        comp: `C${g}`,
        group: `G${g}`,
        x: p * 2 + g * 10,
        y: (p * 7) % 5,
        volume: 100 + g * 0.5 + p * 0.02,
        height: 120,
        area: 100,
      });
    }
  }
  const issue = c.detectIssues(st(rows)).find((x) => x.rule_id.startsWith("空間偏相關"));
  if (issue) assert.match(issue.rule_name, /N−群組數−1/);
});

test("v10.14.3: issuesMd 匯出與 APP 版本更新時間整合", () => {
  const md = c.issuesMd([], { source: "測試資料", stencil: 120 });
  assert.ok(md.includes("版本："), "issuesMd 應包含版本標頭");
  assert.ok(md.includes("產生時間："), "issuesMd 應包含產生時間");
  assert.ok(!md.includes("版本：undefined"), "issuesMd 不得顯示 undefined");
});

test("v10.14.3: X̄-S 管制圖小樣本副標不包含原始 HTML 標籤", () => {
  const html = fs.readFileSync(HTML, "utf8");
  assert.doesNotMatch(html, /A\.xs\.subgroupWarning \? ` · <span class="note">/, "warnText 不得帶有 raw span 標籤");
  assert.doesNotMatch(html, /A\.xs\.reason \? ` · <span class="pill warn">/, "rejText 不得帶有 raw span 標籤");
});

test("v10.14.3: 刮刀方向卡事實欄無 aB 內部變數名、DFM 轉移效率卡無 VERIFY", () => {
  const html = fs.readFileSync(HTML, "utf8");
  assert.doesNotMatch(html, /門檻 aB =/, "刮刀方向事實欄不得出現內部變數名 門檻 aB");
  assert.ok(html.includes("Bonferroni 門檻 α ="), "刮刀方向事實欄應顯示 Bonferroni 門檻 α");
  assert.doesNotMatch(html, /面積比：VERIFY，缺焊墊尺寸/, "DFM 轉移效率卡不得殘留 VERIFY");
  assert.ok(html.includes("面積比：${PENDING_VERIFY_LABEL}，缺焊墊尺寸"), "DFM 轉移效率卡應使用 PENDING_VERIFY_LABEL");
});

test("v10.14.3: 焊墊位置穩健 Cpk 0.995~1.00 邊界精度呈現消除語意矛盾", () => {
  const html = fs.readFileSync(HTML, "utf8");
  assert.ok(html.includes("mcFmt=mc>=0.995&&mc<1?f(mc,3):f(mc)"), "穩健 Cpk 邊界應自動啟用 3 位小數精度");
});

test("v10.14.3: 全板級與重複不良卡 group 支援 topList 截斷防膨脹", () => {
  const html = fs.readFileSync(HTML, "utf8");
  assert.doesNotMatch(html, /group:groups\.join\("; "\)/, "全板級問題卡不得直接 groups.join 造成數百群組傾印");
  assert.ok(html.includes("group:topList(groups,10)"), "全板級問題卡應採用 topList(groups,10)");
  assert.ok(html.includes("group:topList([...new Set(offenders.map(o=>o.group))],10)"), "M-09 重複不良卡應採用 topList 截斷群組");
});

test("BUG-01: n>2000 不用固定步長，孤立點 |z| 不被解析度下限壓掉", () => {
  const small = [0, 0.5, 1.5, 1.5];
  assert.equal(c.resolutionOf(small), 0.5);
  assert.equal(c.resolutionOf([7, 7, 7]), 0);
  assert.equal(c.resolutionOf([3]), 0);
  const nSmall = 2000;
  const under = new Array(nSmall).fill(100);
  for (let i = 0; i < nSmall; i++) if (i % 3 !== 0) under[i] = i % 2 === 0 ? 100 : 100.25;
  under[0] = 0;
  assert.equal(c.resolutionOf(under), 0.25, "n≤2000 仍用全部數值的最小正間距");

  const n = 4002;
  const v = new Array(n).fill(100);
  for (let i = 0; i < n; i++) if (i % 3 !== 0) v[i] = i % 2 === 0 ? 100 : 100.01;
  v[0] = 0;
  v[3] = 100;
  v[1] = 100.5;
  const step = Math.ceil(n / 2000);
  const sampled = v.filter((_, i) => i % step === 0);
  const uniq = Float64Array.from(new Set(sampled));
  uniq.sort();
  let aliased = Infinity;
  for (let i = 1; i < uniq.length; i++) {
    const d = uniq[i] - uniq[i - 1];
    if (d > 1e-9 && d < aliased) aliased = d;
  }
  assert.equal(aliased, 100, "這組資料的固定步長抽樣會把解析度看成 100");
  const stat = c.isoStat(v);
  assert.ok(Math.abs(stat.res - 0.01) < 1e-12, `resolutionOf 應為 0.01，實得 ${stat.res}`);
  const z = Math.abs(100.5 - stat.m) / stat.sg;
  assert.ok(z >= 5, `偏離中位數 0.5 的 |z| 應 ≥ 5，實得 ${z}`);
});

test("BUG-02: 非最差群組 |Cpk|>50 時 unitMismatch 與 M-03 同時成立", () => {
  const rows = [];
  for (let b = 1; b <= 12; b++) {
    const board = `B${String(b).padStart(2, "0")}`;
    rows.push({ board, pad: "T1", comp: "T1", group: "Tight", volume: 100, height: 120, area: 100 });
    rows.push({ board, pad: "T2", comp: "T2", group: "Tight", volume: 100.01, height: 120, area: 100 });
    rows.push({ board, pad: "W1", comp: "W1", group: "Wide", volume: 90, height: 120, area: 100 });
    rows.push({ board, pad: "W2", comp: "W2", group: "Wide", volume: 110, height: 120, area: 100 });
  }
  const S = st(rows);
  const A = c.analyze(S);
  assert.equal(A.cap.mixed, true);
  assert.ok(Math.abs(A.cap.cpk) <= 50, `最差群組 Cpk 應 ≤ 50，實得 ${A.cap.cpk}（${A.cap.worst}）`);
  assert.ok(A.cap.groups.some((g) => Number.isFinite(g.cpk) && Math.abs(g.cpk) > 50), "另一群組 |Cpk| 應 > 50");
  const center = (A.sp.usl + A.sp.lsl) / 2;
  assert.ok(Math.abs(center - A.gMean) <= 10 * A.overallSd, "此例不得靠規格中心偏移觸發旗標");
  assert.equal(A.unitMismatch, true);
  const issue = c.detectIssues(S).find((x) => x.rule_id === "M-03 單位不符");
  assert.ok(issue, "M-03 單位不符卡應出現");
  assert.ok(issue.facts.some((x) => /Cpk/.test(x)), "卡片需呈現 Cpk 證據");
  const html = fs.readFileSync(HTML, "utf8");
  assert.match(html, /A\.unitMismatch \? `<div class="pill warn"/, "能力頁警示藥丸綁定 A.unitMismatch");
});

test("BUG-05: 稽核 API 超過 50 筆回 hasMore 與 next，舊 entries 仍在", async () => {
  const h = await createCloudHarness();
  try {
    const ins = h.db.prepare("INSERT INTO audit_log (seq, at, by, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (let i = 1; i <= 60; i++) {
      ins.run(i, 1700000000000 + i, "u", "create", "record", `rec_${i}`, JSON.stringify({ kind: "spi", lot: "L1", part: "P1", name: "a.csv", sha256: "ab", done: true }));
    }
    const p1res = await h.fetch("/api/records?audit=1");
    assert.equal(p1res.status, 200);
    const p1 = await p1res.json();
    assert.equal(Array.isArray(p1.entries), true);
    assert.equal(p1.entries.length, 50);
    assert.equal(p1.hasMore, true);
    assert.equal(p1.next, p1.entries[p1.entries.length - 1].seq);
    assert.equal(p1.entries[0].seq, 60);
    assert.equal(p1.entries[0].action, "create");
    assert.equal(p1.entries[0].part, "P1");
    const seen = new Set(p1.entries.map((e) => e.seq));
    const p2res = await h.fetch(`/api/records?audit=1&before=${p1.next}`);
    assert.equal(p2res.status, 200);
    const p2 = await p2res.json();
    assert.equal(p2.entries.length, 10);
    assert.equal(p2.hasMore, false);
    assert.equal(p2.next, null);
    assert.ok(p2.entries.every((e) => !seen.has(e.seq)));
    assert.equal(p2.entries[p2.entries.length - 1].seq, 1);
    assert.equal(p1.entries.length + p2.entries.length, 60);
  } finally {
    h.close();
  }
});

test("BUG-05: 稽核面板截斷提示與載入更多", async () => {
  const html = fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://example.test/",
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
        get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})),
        set: (t, k, v) => { t[k] = v; return true; },
      });
      w.Element.prototype.scrollIntoView = () => {};
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.scrollTo = () => {};
      w.Chart = class { constructor() {} destroy() {} static register() {} };
      w.fetch = async () => new w.Response("{}", { status: 404 });
      withIdb(w);
      w.SPI_TEST_HOOK = { bootSample: false };
    },
  });
  const w = dom.window;
  const hook = w.SPI_TEST_HOOK;
  assert.equal(typeof hook.renderAudit, "function");
  const page = (from, count) => Array.from({ length: count }, (_, i) => {
    const seq = from - i;
    return { seq, at: 1700000000000 + seq, by: "u", action: "create", target_type: "record", kind: "spi", lot: "L1", part: "P1", rev: "", name: "a.csv", sha256: "0123456789abcdef", ok: true, status: "已存檔" };
  });
  const calls = [];
  hook.RecDB.mode = "cloud";
  hook.RecDB.isAdmin = false;
  hook.RecDB.ready = Promise.resolve();
  hook.RecDB.jfetch = async (url) => {
    calls.push(url);
    if (!url.includes("before=")) return { entries: page(60, 50), hasMore: true, next: 11 };
    assert.match(url, /before=11/);
    return { entries: page(10, 10), hasMore: false, next: null };
  };
  await hook.renderAudit();
  const box = w.document.querySelector("#recAudit");
  assert.equal(box.querySelectorAll("tbody tr").length, 50);
  assert.match(box.textContent, /只顯示最新 50 筆紀錄/);
  const btn = box.querySelector("#auditMore");
  assert.ok(btn, "應有載入更多");
  assert.equal(btn.textContent, "載入更多");
  btn.click();
  for (let i = 0; i < 50 && box.querySelectorAll("tbody tr").length !== 60; i++) await new Promise((r) => setImmediate(r));
  assert.equal(box.querySelectorAll("tbody tr").length, 60);
  assert.doesNotMatch(box.textContent, /只顯示最新 50 筆紀錄/);
  assert.equal(box.querySelector("#auditMore"), null);
  assert.deepEqual(calls, ["/api/records?audit=1", "/api/records?audit=1&before=11"]);
  dom.window.close();
});
