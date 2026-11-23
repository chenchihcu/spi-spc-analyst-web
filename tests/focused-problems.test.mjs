import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadCore, baseState } = require("./_load.js");

test("buildFocusedProblems 與 focusedProblemsMd：空陣列回傳空結果", () => {
  const core = loadCore();
  assert.equal(typeof core.focusDomainOf, "function");
  assert.equal(typeof core.buildFocusedProblems, "function");
  assert.equal(typeof core.focusedProblemsMd, "function");
  assert.deepEqual(Array.from(core.buildFocusedProblems([])), []);
  assert.deepEqual(Array.from(core.buildFocusedProblems(null)), []);
  assert.equal(core.focusedProblemsMd([]), "");
});

test("buildFocusedProblems：範例資料收斂為 ≤ 6 個焦點問題且無遺漏、無重複、不改動原陣列", () => {
  const core = loadCore();
  const rows = core.sampleData();
  const st = baseState(core, { rows, specSrc: "sample", heightUnit: "um" });
  const F = core.detectIssues(st);
  const snap = JSON.stringify(F);

  const focused = core.buildFocusedProblems(F);
  assert.ok(focused.length >= 1 && focused.length <= 6, `焦點問題數應在 1..6，實得 ${focused.length}`);
  const totalCount = focused.reduce((s, g) => s + g.count, 0);
  assert.equal(totalCount, F.length, "焦點問題成員加總須嚴格等於 F.length");

  const seenIds = new Set();
  for (const g of focused) {
    assert.equal(g.count, g.members.length);
    assert.equal(g.ids.length, g.members.length);
    assert.ok(["aperture", "align", "process", "squeegee", "spike", "measurement"].includes(g.key));
    assert.ok(g.name && !/[（(][A-Za-z]/.test(g.name), `類別名不可附英文譯名：${g.name}`);
    assert.match(g.title, / → /, `白話標題句須含「 → 」：${g.title}`);
    assert.ok(["ng", "warn", "info"].includes(g.lv));
    assert.ok(g.highlights.length >= 1 && g.highlights.length <= 2);
    assert.ok(g.actions.length >= 1 && g.actions.length <= 2);
    for (const m of g.members) {
      assert.equal(seenIds.has(m.id), false, `發現 #${m.id} 重複歸類`);
      seenIds.add(m.id);
    }
  }
  assert.equal(seenIds.size, F.length);
  assert.equal(JSON.stringify(F), snap, "buildFocusedProblems 不可改動原 F 陣列");
});

test("focusDomainOf：涵蓋全部 21 種已知 sig.t、分流條件與未知類型保底", () => {
  const core = loadCore();
  const cases = [
    // 1. measurement
    [{ sig: { t: "unit" } }, "measurement"],
    [{ sig: { t: "msa" } }, "measurement"],
    // 2. align
    [{ sig: { t: "align", ty: "shift" } }, "align"],
    [{ sig: { t: "board", off: true, b: "B01" } }, "align"],
    [{ sig: { t: "local", off: true, b: "B01", g: "U2 BGA" } }, "align"],
    [{ sig: { t: "nelson", k: "offx", ruleId: 1 } }, "align"],
    [{ sig: { t: "nelson", k: "offy", ruleId: 2 } }, "align"],
    [{ sig: { t: "iso", k: "offx" } }, "align"],
    [{ sig: { t: "iso", k: "offy" } }, "align"],
    // 3. aperture
    [{ sig: { t: "sys" } }, "aperture"],
    [{ sig: { t: "pad" } }, "aperture"],
    [{ sig: { t: "dfm" } }, "aperture"],
    [{ sig: { t: "lowte" } }, "aperture"],
    [{ sig: { t: "mcd" } }, "aperture"],
    [{ sig: { t: "repeated" } }, "aperture"],
    // 4. process
    [{ sig: { t: "drift" } }, "process"],
    [{ sig: { t: "wipe" } }, "process"],
    [{ sig: { t: "pause" } }, "process"],
    [{ sig: { t: "nelson", k: "volume", ruleId: 2 } }, "process"],
    [{ sig: { t: "nelson", k: "volume", ruleId: 3 } }, "process"],
    [{ sig: { t: "nelson", k: "volume", ruleId: 5 } }, "process"],
    [{ sig: { t: "nelson", k: "volume", ruleId: 6 } }, "process"],
    [{ sig: { t: "nelson", k: "volume", ruleId: 8 } }, "process"],
    // 5. squeegee
    [{ sig: { t: "stroke" } }, "squeegee"],
    [{ sig: { t: "grad" } }, "squeegee"],
    [{ sig: { t: "fig" } }, "squeegee"],
    [{ sig: { t: "spatial" } }, "squeegee"],
    [{ sig: { t: "nelson", k: "volume", ruleId: 4 } }, "squeegee"],
    // 6. spike (incl. non-offset board/local/iso, morph, nelson rule 1, unknown/missing sig)
    [{ sig: { t: "board", off: false, b: "B01" } }, "spike"],
    [{ sig: { t: "local", off: false, b: "B01", g: "U2 BGA" } }, "spike"],
    [{ sig: { t: "iso", k: "volume" } }, "spike"],
    [{ sig: { t: "morph", k: "bridgemargin" } }, "spike"],
    [{ sig: { t: "morph", k: "peaking" } }, "spike"],
    [{ sig: { t: "nelson", k: "volume", ruleId: 1 } }, "spike"],
    [{ sig: { t: "future_new_rule" } }, "spike"],
    [{ sig: null }, "spike"],
    [{}, "spike"],
  ];

  const allKnownTypes = new Set([
    "align", "board", "dfm", "drift", "fig", "grad", "iso", "local", "lowte",
    "mcd", "morph", "msa", "nelson", "pad", "pause", "repeated", "spatial",
    "stroke", "sys", "unit", "wipe",
  ]);
  const testedTypes = new Set();
  for (const [card, expected] of cases) {
    if (card.sig && card.sig.t && allKnownTypes.has(card.sig.t)) testedTypes.add(card.sig.t);
    assert.equal(core.focusDomainOf(card), expected, `卡片 ${JSON.stringify(card)} 應歸入 ${expected}`);
  }
  assert.deepEqual([...testedTypes].sort(), [...allKnownTypes].sort(), "必須測試全部 21 種已知 sig.t");
});

test("buildFocusedProblems：白話標題句、佔位值過濾、排序與 20 群組截斷守衛", () => {
  const core = loadCore();
  const manySys = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    lv: i === 0 ? "ng" : "warn",
    cat: "系統性偏移",
    sig: { t: "sys", g: `G${String(i + 1).padStart(2, "0")}`, k: "volume" },
    title: `G${String(i + 1).padStart(2, "0")} 體積偏低`,
    group: `G${String(i + 1).padStart(2, "0")}`,
    boards: i < 8 ? `B${String(i + 1).padStart(2, "0")}` : "全部板",
    metric: "體積",
    action: i % 2 === 0 ? "檢查鋼板開孔面積比" : "清潔鋼板底部",
  }));
  const alignWarn = {
    id: 21,
    lv: "warn",
    cat: "對位",
    sig: { t: "align", ty: "shift", bs: ["B02", "B05"] },
    title: "B02、B05 整板平移偏移",
    group: "全部元件",
    boards: "B02; B05",
    metric: "X 偏移",
    action: "校正鋼板對位補償",
  };
  const unitInfo = {
    id: 22,
    lv: "info",
    cat: "資料品質",
    sig: { t: "unit" },
    title: "高度單位待確認",
    group: "ALL（全部元件）",
    boards: "—",
    metric: "高度",
    action: "確認匯入高度單位",
  };

  const out = core.buildFocusedProblems([unitInfo, alignWarn, ...manySys]);
  assert.deepEqual(Array.from(out, (g) => g.key), ["aperture", "align", "measurement"]);

  const ap = out[0];
  assert.equal(ap.lv, "ng");
  assert.equal(ap.count, 20);
  assert.equal(ap.groups.length, 6, "群組最多保留 6 項");
  assert.equal(ap.moreGroups, 14, "超出 6 項應記錄 moreGroups=14");
  assert.equal(ap.boards.length, 6, "板號最多保留 6 項");
  assert.equal(ap.moreBoards, 2, "8 個具體板號超出 6 項應記錄 moreBoards=2（且過濾『全部板』）");
  assert.equal(ap.title, "G01 等 20 群組製程能力不足 → 檢查鋼板開孔與厚度");
  assert.equal(ap.highlights.length, 2);
  assert.equal(ap.actions.length, 2);

  const al = out[1];
  assert.equal(al.groups.length, 0, "『全部元件』佔位值應被過濾");
  assert.deepEqual(Array.from(al.boards), ["B02", "B05"]);
  assert.equal(al.title, "B02 等 2 片板印刷偏移 → 校正鋼板對位");

  const ms = out[2];
  assert.equal(ms.groups.length, 0, "『ALL（全部元件）』應被過濾");
  assert.equal(ms.boards.length, 0, "『—』應被過濾");
  assert.equal(ms.title, "量測或規格待確認 → 確認量測設定與規格");
});

test("issuesMd 與 focusedProblemsMd：在原統計發現清單前輸出焦點問題摘要且證據編號超過 10 項時截斷", () => {
  const core = loadCore();
  const cards = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    lv: i === 0 ? "ng" : "warn",
    cat: "系統性偏移",
    rule_id: "SYS-1",
    rule_name: "群組均值偏移",
    sig: { t: "sys", g: `G${i + 1}`, k: "volume" },
    title: `G${i + 1} 體積偏低`,
    group: `G${i + 1}`,
    boards: "全部板",
    subboard: "—",
    refdes: "—",
    pads: "—",
    metric: "體積",
    observed: "72%",
    limit: "70–130%",
    z: "-3.1",
    p: "0.001",
    facts: ["均值偏低"],
    cause: "開孔面積比不足",
    conf: "高",
    action: "檢查鋼板開孔",
    corrob: [],
  }));
  cards.push({
    id: 13,
    lv: "warn",
    cat: "量測系統",
    rule_id: "MSA-1",
    rule_name: "GR&R 偏高",
    sig: { t: "msa" },
    title: "量測系統變異偏大",
    group: "全部元件",
    boards: "全部板",
    subboard: "—",
    refdes: "—",
    pads: "—",
    metric: "體積",
    observed: "35%",
    limit: "<30%",
    z: "—",
    p: "—",
    facts: ["%GRR 35%"],
    cause: "量測重現性不足",
    conf: "中",
    action: "校正 SPI 機台",
    corrob: [],
  });

  const md = core.issuesMd(cards, { source: "test.csv", stencil: 120, step: { on: false }, group: "ALL" });
  const sumIdx = md.indexOf("## 焦點問題摘要");
  const listIdx = md.indexOf("## 統計發現清單");
  assert.ok(sumIdx > 0, "issuesMd 應含『## 焦點問題摘要』");
  assert.ok(listIdx > sumIdx, "『## 焦點問題摘要』須位於『## 統計發現清單』之前");
  assert.match(md, /量測系統變異偏大，以下判讀可信度降低/);
  assert.match(md, /G1 等 12 群組製程能力不足 → 檢查鋼板開孔與厚度/);
  assert.match(md, /另 6 個/, "超過 6 個群組應截斷為『另 6 個』");
  assert.match(md, /另 2 項/, "超過 10 個證據編號應截斷為『另 2 項』");
});
