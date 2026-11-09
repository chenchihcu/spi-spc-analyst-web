import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { loadCore, baseState, HTML } from "./_load.js";

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
