import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadCore, baseState, HTML, withIdb } = require("./_load.js");
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); } catch {}

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

test("reportMd 與 renderReport：第二章在原清單前輸出焦點問題摘要；0 筆時不輸出；窄範圍全板區與分頁跳轉正常", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const html = fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    virtualConsole: vc,
    url: "https://example.test/",
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
      w.Element.prototype.scrollIntoView = () => {};
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} };
      w.scrollTo = () => {};
      w.Chart = class { constructor() {} destroy() {} static register() {} };
      withIdb(w);
      w.SPI_TEST_HOOK = { bootSample: true };
    },
  });
  try {
    const w = dom.window, d = w.document, H = w.SPI_TEST_HOOK;
    for (let i = 0; i < 200 && !(H.S?.F?.length && !H.S.F.pending); i++) await new Promise((r) => setTimeout(r, 20));
    const S = H.S;
    assert.ok(S.F.length > 0);

    // 1. reportMd 與 renderReport：摘要段在清單之前
    const md = H.reportMd();
    const sec2Idx = md.indexOf("## 二、問題偵測清單");
    const sumIdx = md.indexOf("### 焦點問題摘要");
    const itemIdx = md.indexOf("\n- #", sumIdx);
    assert.ok(sec2Idx > 0 && sumIdx > sec2Idx && itemIdx > sumIdx, "reportMd 第二章中『### 焦點問題摘要』須位於問題清單之前");

    H.renderReport();
    const repSec3 = d.querySelector("#repSec3");
    const h3 = repSec3.querySelector("h3");
    const tables = repSec3.querySelectorAll("table");
    assert.ok(h3 && /焦點問題摘要/.test(h3.textContent), "renderReport #repSec3 應含『焦點問題摘要』標題");
    assert.equal(tables.length, 2, "#repSec3 應含摘要表與明細表兩張表");
    assert.match(tables[0].textContent, /焦點問題/, "第一張表應為焦點問題摘要表");
    assert.match(tables[1].textContent, /規則 ID 與名稱/, "第二張表應為原統計發現明細表");

    // 2. 0 筆時不輸出焦點問題摘要
    const origF = S.F;
    S.F = [];
    const emptyMd = H.reportMd();
    assert.equal(emptyMd.includes("焦點問題摘要"), false, "0 筆時 reportMd 不應輸出焦點問題摘要");
    H.renderReport();
    assert.equal(d.querySelector("#repSec3").textContent.includes("焦點問題摘要"), false, "0 筆時 renderReport 不應輸出焦點問題摘要");
    S.F = origF;

    // 3. 窄範圍只有全板問題（0 own）且先前 S.issLv="ng" 時，仍應重設 S.issLv="all" 並顯示 #issBoardScope
    const sc = H.issueScope();
    assert.equal(sc, null);
    S.issLv = "ng";
    const warnBoardCard = {
      ...origF[0],
      id: 9001,
      lv: "warn",
      sig: { t: "fig" },
      ents: [],
      corrob: [],
      same_phenomenon: [],
      title: "跨子板均勻性警示",
    };
    const manyBoard = Array.from({ length: 160 }, (_, idx) => ({
      ...warnBoardCard,
      id: 9002 + idx,
      title: `全板背景警示 ${idx + 1}`,
    }));
    H.setComp(H.compCandidates("")[0].key);
    S.F = manyBoard;
    S.issLv = "ng";
    H.renderIssues();
    assert.equal(S.issLv, "all", "窄範圍無 own 問題時應重設 S.issLv 為 all 以免隱藏全板問題");
    assert.ok(d.querySelectorAll("#issBoardScope .iss-focus").length > 0, "應顯示 #issBoardScope 焦點問題");
    assert.ok(d.querySelector("#issMore"), "全板問題超過 150 項時即使 own 為 0 也應顯示 #issMore 按鈕");

    // 4. flashIssue 跳轉至 #issBoardScope 內第 155 張（超過 ISS_PAGE=150）卡片時應自動翻頁並展開
    const targetId = manyBoard[155].id;
    assert.equal(d.querySelector(`#iss-${targetId}`), null, "跳轉前第 156 張尚未渲染");
    H.flashIssue(targetId);
    const jumped = d.querySelector(`#iss-${targetId}`);
    assert.ok(jumped, "flashIssue 應將 #issBoardScope 翻頁至目標卡片");
    assert.equal(jumped.open, true, "目標卡片應展開");
    assert.equal(jumped.closest("details.iss-ev-fold")?.open, true, "外層證據折疊區應展開");
    assert.equal(d.querySelector("#issBoardScope")?.open, true, "外層 #issBoardScope 應展開");

    // 5. 窄範圍列印：不重複列出全板問題，且展開 #issBoardScope 後還原
    d.querySelector("#issBoardScope").open = false;
    d.querySelector("#issBoardScope").dispatchEvent(new w.Event("toggle"));
    H.beforePrint();
    const boardScope = d.querySelector("#issBoardScope");
    assert.equal(boardScope.open, true, "列印時應展開 #issBoardScope");
    const ownAreaIds = [...d.querySelectorAll("#issList > .iss-focus .iss-card")].map((e) => +e.dataset.id);
    assert.equal(ownAreaIds.length, 0, "列印時窄範圍主區不應重複塞入全板問題");
    H.afterPrint();
    assert.equal(d.querySelector("#issBoardScope").open, false, "列印後應還原 #issBoardScope 收合狀態");
  } finally {
    dom.window.close();
  }
});
