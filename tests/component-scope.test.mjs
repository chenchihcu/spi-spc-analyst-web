// 元件分析範圍（v10.26.0）：選單位號／群組後，圖表、問題清單、報告、匯出與 AI 皆依同一範圍
// 規格：docs/spec-component-scope-rfc.md；規則：AGENTS.md「分析範圍一致」
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { loadCore, baseState, HTML, withIdb } = require("./_load.js");
const SRC = readFileSync(HTML, "utf8");
const core = loadCore();
const key = (comp, figure = "") => JSON.stringify([figure, "comp", comp]);

let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); } catch { /* 未安裝 jsdom */ }

/* ---------- 核心：範圍篩選與分析 ---------- */
test("單一元件範圍的分析＝只含該元件資料的分析；全部範圍不變", () => {
  const rows = core.sampleData();
  const u2 = rows.filter((r) => r.comp === "U2");
  assert.ok(u2.length > 0 && u2.length < rows.length);
  const scoped = core.analyze(baseState(core, { rows, group: "ALL", comp: key("U2") }));
  const alone = core.analyze(baseState(core, { rows: u2.map((r) => ({ ...r })), group: "ALL" }));
  const whole = core.analyze(baseState(core, { rows, group: "ALL" }));
  assert.equal(scoped.N, u2.filter((r) => r.volume != null).length);
  assert.equal(scoped.N, alone.N);
  assert.equal(scoped.gMean, alone.gMean);
  assert.equal(scoped.cap.cpk, alone.cap.cpk);
  assert.deepEqual([...scoped.boards], [...alone.boards]);
  assert.equal(whole.N, rows.filter((r) => r.volume != null).length, "全部範圍仍是全部資料");
  assert.notEqual(scoped.N, whole.N);
});

test("群組＋元件：元件不屬於所選群組時範圍退回群組（不報錯）", () => {
  const rows = core.sampleData();
  const st = baseState(core, { rows, group: "C 0402", comp: key("U2") });
  assert.equal(core.normalizeScope(st), true);
  assert.equal(st.comp, null);
  const st2 = baseState(core, { rows, group: "U2 BGA", comp: key("U2") });
  assert.equal(core.normalizeScope(st2), false);
  assert.equal(st2.comp, key("U2"));
  const gone = baseState(core, { rows, group: "ALL", comp: key("ZZ9") });
  core.normalizeScope(gone);
  assert.equal(gone.comp, null, "回合中已不存在的元件：退回全部");
});

test("分析快取鍵包含元件：不同元件不會共用同一份結果", () => {
  const rows = core.sampleData();
  const a = core.anKey(baseState(core, { rows, comp: key("U1") }));
  const b = core.anKey(baseState(core, { rows, comp: key("U2") }));
  const c = core.anKey(baseState(core, { rows, comp: null }));
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("元件清單：自然排序、子板分開、以位號分群時隱藏重複選單", () => {
  const mk = (comp, group, figure) => ({ board: "B1", pad: comp + "-1", comp, group, figure, volume: 100 });
  const P = core.scopeParts([mk("U10", "QFN"), mk("U2", "QFN"), mk("U2", "QFN", "2"), mk("R1", "0402")]);
  assert.deepEqual(Array.from(P.list, (p) => p.label), ["R1", "U2", "U2 · 子板 2", "U10"]);
  assert.equal(P.byRef, false);
  const byRef = core.scopeParts([mk("U1", "U1"), mk("U2", "U2")]);
  assert.equal(byRef.byRef, true);
  assert.equal(core.scopeParts([{ board: "B1", pad: "P1", group: "全部", volume: 1 }]).list.length, 0, "無位號欄：沒有元件可選");
});

test("規格群組與範圍文字", () => {
  const rows = core.sampleData();
  const st = baseState(core, { rows, group: "ALL", comp: key("U2") });
  assert.equal(core.scopeSpecGroup(st), "U2 BGA");
  assert.equal(core.scopeLabel(st), "元件 U2（群組 U2 BGA）");
  assert.equal(core.scopeLabel(baseState(core, { rows, group: "ALL" })), "全部元件");
  assert.equal(core.scopeLabel(baseState(core, { rows, group: "R 0603" })), "元件群組 R 0603");
  const esc = core.scopeLabel(baseState(core, { rows: [{ board: "B", pad: "p", comp: "<b>&", group: "G", volume: 1 }], comp: key("<b>&") }));
  assert.equal(esc, "元件 <b>&（群組 G）", "純文字：不轉成 HTML，由 textContent／esc 處理");
});

test("統計異常點清單依範圍篩選", () => {
  const rows = core.sampleData();
  const st = baseState(core, { rows, group: "ALL", comp: key("U1") });
  st.A = core.analyze(st);
  const out = core.buildStatsData(st);
  assert.ok(out.every((d) => d.refdes === "U1" || d.refdes === "全部" || d.refdes === "—"), "只留 U1 與範圍內的板級列");
  const all = baseState(core, { rows, group: "ALL" });
  all.A = core.analyze(all);
  assert.ok(core.buildStatsData(all).some((d) => d.refdes !== "U1" && d.refdes !== "全部"));
});

/* ---------- 登錄表：每個分頁與全板區塊都要歸類 ---------- */
test("每個分頁都登記在 SCOPE_PANELS；全板區塊都有提示", () => {
  const panels = [...SRC.matchAll(/<section class="panel" id="p-([a-z0-9]+)"/g)].map((m) => m[1]);
  assert.ok(panels.length >= 10);
  for (const p of panels) assert.ok(Object.hasOwn(core.SCOPE_PANELS, p), `分頁 p-${p} 未登記範圍屬性`);
  for (const id of core.SCOPE_BOARD_CARDS) {
    const at = SRC.indexOf(`id="${id}"`);
    assert.ok(at > 0, `全板區塊 #${id} 不存在`);
    const near = SRC.slice(at, at + 400);
    assert.match(near, /class="note scope-board-note"[^>]*>全板分析，不隨元件範圍變動</, `#${id} 缺少全板提示`);
  }
});

test("不再有繞過 scopeFilter 的行內群組篩選", () => {
  assert.doesNotMatch(SRC, /r\.group\s*===\s*S\.group/, "請改用 inScopeS(r)");
  assert.doesNotMatch(SRC, /isAllGrp\(st\.group\)\s*\|\|\s*r\.group/, "請改用 scopeFilter(st)");
  // 以列資料畫圖的範圍頁面必須經由範圍判斷或 S.A（已篩選）
  const body = (name) => { const a = SRC.indexOf(`function ${name}(`); const b = SRC.indexOf("\nfunction ", a + 10); return SRC.slice(a, b); };
  for (const fn of ["renderOverview", "renderBoard2D", "build3D", "drawVec", "renderRelChartUI", "renderSidedPpmBlock"]) {
    const s = body(fn);
    if (/S\.rows\.filter\(/.test(s)) assert.match(s, /inScopeS/, `${fn} 直接讀 S.rows 卻沒有套用範圍`);
  }
  assert.match(body("preSet"), /comp:S\.comp/, "背景預算的設定需帶元件，否則快取鍵與結果不一致");
  for (const fn of ["reportMd", "aiPayload", "renderReport", "generateReportPdfBlob", "initMailPage", "exportIssuesXlsx"]) {
    assert.doesNotMatch(body(fn), /S\.F\.(slice|filter|map|length)|overallVerdict\(S,S\.F\)|issuesXlsx\(S\.F\)/, `${fn} 需用 scopedFindings()`);
  }
});

test("scopedDfmTable 與 statsDataCsv 在窄範圍下只保留範圍內群組與標示分析範圍", () => {
  const rows = core.sampleData();
  const stAll = baseState(core, { rows, group: "ALL" });
  const stU2 = baseState(core, { rows, group: "ALL", comp: key("U2") });
  stU2.A = core.analyze(stU2);
  const allDfm = core.scopedDfmTable(stAll);
  const u2Dfm = core.scopedDfmTable(stU2);
  assert.ok(allDfm.length > 1, "全板應有多個群組");
  assert.deepEqual(Array.from(u2Dfm, (d) => d.group), ["U2 BGA"], "窄範圍 DFM 表只留範圍內元件群組");
  const csvU2 = core.statsDataCsv(stU2);
  assert.match(csvU2, /^分析範圍,"?元件 U2（群組 U2 BGA）"?/, "窄範圍統計異常 CSV 首列需標示分析範圍");
});

/* ---------- 介面：選單、提示列、問題清單、報告、匯出、AI、分享 ---------- */
/* 所有介面測試共用同一個頁面：每開一次 jsdom 頁面約 2.5–5 秒，Cloudflare 建置有時間上限（v10.27.1）。
   每個測試開始前 resetPage 還原到相同起點：原始量測列、全部元件、無元件範圍、問題頁、清空錯誤紀錄。 */
let PAGE = null;
async function openPage() {
  if (!PAGE) PAGE = createPage();
  const p = await PAGE;
  resetPage(p);
  return p;
}
function resetPage({ d, H, errs, rows0 }) {
  errs.length = 0;
  const dirty = H.S.rows !== rows0 || H.S.group !== "ALL" || H.S.comp != null;
  if (H.S.rows !== rows0) H.S.rows = rows0;
  H.S.group = "ALL";
  const sel = d.querySelector("#selGroup");
  if (sel) sel.value = "ALL";
  if (dirty) H.setComp(null); // 只在偏離起點時重算
  d.querySelector(".tab[data-tab=issues]").click();
  const pd = d.querySelector("#pmapDetails");
  if (pd) pd.open = false;
  errs.length = 0;
}
async function createPage() {
  const html = SRC.replace(/<script src=[^>]+><\/script>/g, "");
  const errs = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errs.push(e.message));
  const dom = new JSDOM(html, {
    runScripts: "dangerously", virtualConsole: vc, url: "https://example.test/",
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
      w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { let e = this; while (e) { if (e.hidden) return null; e = e.parentElement; } return w.document.body; } });
      w.Element.prototype.scrollIntoView = () => {};
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} };
      w.scrollTo = () => {};
      w.Chart = class { constructor(_c, cfg) { if (!cfg || !cfg.data) throw new Error("圖表設定錯誤"); } destroy() {} static register() {} };
      withIdb(w);
      w.SPI_TEST_HOOK = { bootSample: true };
    },
  });
  const w = dom.window;
  const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("等待逾時"); await new Promise((r) => setTimeout(r, 10)); } };
  await until(() => w.SPI_TEST_HOOK.S && w.SPI_TEST_HOOK.S.A && w.SPI_TEST_HOOK.S.F && !w.SPI_TEST_HOOK.S.F.pending);
  return { w, d: w.document, H: w.SPI_TEST_HOOK, errs, until, rows0: w.SPI_TEST_HOOK.S.rows };
}

test("選元件 → 提示列、分析、問題清單、報告、AI、匯出與分享一致", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, d, H, errs } = await openPage();
  const S = H.S, $ = (s) => d.querySelector(s);
  const click = (t) => d.querySelector(`.tab[data-tab=${t}]`).click();
  click("capability");
  assert.equal($("#compField").hidden, false, "分析頁顯示元件選單");
  assert.equal($("#scopeBar").hidden, true, "未選元件不顯示範圍提示列");

  // 搜尋：不分大小寫子字串
  const hits = Array.from(H.compSearch("u"), (p) => p.label);
  assert.deepEqual(hits, ["U1", "U2"]);
  assert.equal(H.compSearch("zzz").length, 0);

  // 透過選單鍵盤操作選取 U2
  const inp = $("#inComp");
  inp.dispatchEvent(new w.Event("focus"));
  inp.value = "u2"; inp.dispatchEvent(new w.Event("input"));
  assert.equal($("#compList").hidden, false);
  assert.equal(inp.getAttribute("aria-expanded"), "true");
  inp.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowDown" }));
  inp.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowDown" }));
  inp.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter" }));
  assert.equal(S.comp, key("U2"));
  assert.equal($("#scopeBar").hidden, false);
  assert.match($("#scopeText").textContent, /^範圍：U2 · U2 BGA · \d+ 焊墊$/);
  assert.match($("#railChipSummary").textContent, / U2 /);
  const nU2 = S.rows.filter((r) => r.comp === "U2" && r.volume != null).length;
  assert.equal(S.A.N, nU2, "分析只用 U2 的資料");
  assert.equal(S.A.sp, H.S.specsG && H.S.specsG["U2 BGA"] ? H.S.specsG["U2 BGA"].volume : S.specs.volume, "規格取元件所屬群組");
  for (const n of d.querySelectorAll(".scope-board-note")) assert.equal(n.hidden, false, "全板區塊顯示提示");

  // 問題清單：只留 U2 的發現；全板問題另列；其他元件的發現不列
  click("issues");
  const sc = H.issueScope();
  assert.ok(sc && sc.own.size > 0, "樣本資料中 U2 應有歸屬發現");
  const listed = [...d.querySelectorAll("#issList > details.iss-case .iss-card, #issList > h3 ~ details.iss-card")].map((e) => +e.dataset.id);
  for (const id of listed) assert.ok(sc.own.has(id), `#${id} 不屬於 U2 卻列在清單`);
  const boardIds = [...d.querySelectorAll("#issBoardScope .iss-card")].map((e) => +e.dataset.id);
  for (const id of boardIds) assert.ok(sc.board.has(id));
  const other = S.F.filter((x) => !sc.own.has(x.id) && !sc.board.has(x.id));
  assert.ok(other.length > 0, "樣本資料中應有其他元件的發現（否則本測試無鑑別力）");
  const shown = new Set([...d.querySelectorAll("#issList .iss-card")].map((e) => +e.dataset.id));
  for (const x of other) assert.ok(!shown.has(x.id), `其他元件的發現 #${x.id} 不應出現`);
  assert.match($("#issHead").textContent, /^元件 U2（群組 U2 BGA）：/);
  const own = S.F.filter((x) => sc.own.has(x.id));
  const sev = { ng: 0, warn: 0, info: 0 }; own.forEach((x) => sev[x.lv]++);
  const caseView = S.issGroup === "cases";
  if (!caseView) assert.match($("#issHead").textContent, new RegExp(`嚴重 ${sev.ng}、警示 ${sev.warn}、資訊 ${sev.info}`));
  const SF = H.scopedFindings();
  assert.ok(SF.every((x) => sc.own.has(x.id) || sc.board.has(x.id)));

  // 報告、列印頁首、AI、匯出
  const repMdU2 = H.reportMd();
  assert.match(repMdU2, /分析範圍：元件 U2（群組 U2 BGA）/);
  assert.match(repMdU2, new RegExp(`納入分析筆數：${nU2} 筆`));
  const sec7 = repMdU2.slice(repMdU2.indexOf("## 七、DFM 開孔建議"), repMdU2.indexOf("## 八、資料範圍揭露"));
  assert.match(sec7, /U2 BGA/);
  assert.doesNotMatch(sec7, /C 0402|R 0603/, "報告第七章 DFM 不可包含範圍外群組");
  H.renderReport();
  const sec2 = d.querySelector("#repSec2").textContent;
  assert.doesNotMatch(sec2, /NaN/);
  const muCell = d.querySelector("#repSec2 table tbody tr td.num.mono")?.textContent?.trim();
  const u2VolMean = S.rows.filter((r) => r.comp === "U2" && r.volume != null).reduce((a, r, _, arr) => a + r.volume / arr.length, 0);
  assert.equal(muCell, u2VolMean.toFixed(1), "報告預覽五大項目 μ 需為當前分析範圍平均值");
  assert.match(d.querySelector("#repSec9").textContent, new RegExp(`範圍內|${nU2}`));
  assert.match(H.buildPrintHeadHtml("分析報告"), /分析範圍：元件 U2/);
  assert.match(H.buildMailSummary(S), /• 分析範圍：元件 U2（群組 U2 BGA）/);
  const ai = H.aiPayload();
  assert.equal(ai.分析範圍, "元件 U2（群組 U2 BGA）");
  assert.ok(ai.系統偵測問題清單.every((x) => sc.own.has(x.編號) || sc.board.has(x.編號)));
  assert.match(H.issuesMd(SF), /- 分析範圍：元件 U2（群組 U2 BGA）/);
  for (const x of other) assert.doesNotMatch(H.issuesCsv(SF), new RegExp(`^${x.id},`, "m"));

  // 分享連結保存範圍
  assert.equal(typeof H.sharePack, "function");
  assert.equal(H.sharePack().view.comp, key("U2"));

  // 清除：回到群組範圍
  $("#scopeClear").click();
  assert.equal(S.comp, null);
  assert.equal($("#scopeBar").hidden, true);
  assert.equal(H.issueScope(), null);

  // 換群組時清除不屬於該群組的元件
  H.setComp(key("U2"));
  const sel = $("#selGroup"); sel.value = "C 0402"; sel.dispatchEvent(new w.Event("change"));
  assert.equal(S.comp, null);
  assert.equal($("#scopeBar").hidden, true);
  assert.deepEqual(errs, []);
});

test("元件問題地圖可一鍵縮到該元件", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { d, H } = await openPage();
  const S = H.S;
  d.querySelector('.tab[data-tab=issues]').click();
  d.querySelector("#pmapDetails").open = true;
  const btn = d.querySelector("#pmap [data-part]");
  assert.ok(btn, "無座標時地圖以清單呈現，仍需有零件按鈕");
  btn.click();
  const only = d.querySelector('#pmap [data-scope-comp]');
  assert.ok(only, "零件明細需提供「只分析此元件」");
  assert.equal(only.textContent, "只分析此元件");
  only.click();
  assert.ok(S.comp, "按下後設定元件範圍");
  assert.equal(d.querySelector("#scopeBar").hidden, false);
});

test("樣本極少的元件：管制圖與能力頁不出現 NaN", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { d, H, errs } = await openPage();
  const S = H.S;
  const b0 = S.rows[0].board;
  S.rows = S.rows.filter((r) => r.board === b0);
  H.setComp(key("C1"));
  assert.equal(S.comp, key("C1"));
  for (const t of ["overview", "control", "capability", "report"]) {
    d.querySelector(`.tab[data-tab=${t}]`).click();
    const txt = d.querySelector("#p-" + t).textContent;
    assert.doesNotMatch(txt, /\bNaN\b/, `${t} 頁出現 NaN`);
  }
  assert.deepEqual(errs, []);
});

/* ---------- Codex 審查（PR #161）回歸 ---------- */
test("統計清單以完整元件鍵（含子板）篩選", () => {
  const base = core.sampleData();
  const rows = [...base.map((r) => ({ ...r, figure: "1" })), ...base.map((r) => ({ ...r, figure: "2" }))];
  const st = baseState(core, { rows, group: "ALL", comp: key("U2", "1") });
  st.A = core.analyze(st);
  const u2 = Array.from(core.buildStatsData(st)).filter((d) => d.refdes === "U2");
  assert.ok(u2.length > 0, "需有 U2 的異常列（否則無鑑別力）");
  assert.ok(u2.every((d) => String(d.figure) === "1"), "不可混入子板 2 的 U2");
});

test("分析概況 Cpk 快照鍵包含元件", () => {
  const rows = core.sampleData();
  assert.notEqual(core.overviewCpkSnapshotKey(baseState(core, { rows, comp: key("U1") })), core.overviewCpkSnapshotKey(baseState(core, { rows, comp: null })));
});

test("範圍內的判定與問題定義只引用範圍內的卡", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { H } = await openPage();
  H.setComp(key("U2"));
  const SF = H.scopedFindings(), keep = new Set(Array.from(SF, (x) => x.id));
  assert.ok(H.S.F.length > SF.length, "需有被排除的發現（否則無鑑別力）");
  for (const c of SF.meta.cases) for (const id of [...c.card_ids, ...(c.evidence_card_ids || [])]) assert.ok(keep.has(id), `案 ${c.id} 引用範圍外的 #${id}`);
  const v = H.overallVerdict(H.S, SF);
  for (const r of v.reasons) for (const m of r.matchAll(/#(\d+)/g)) assert.ok(keep.has(+m[1]), `判定理由引用範圍外的 #${m[1]}`);
  assert.ok(v.reasons.every((r) => !r.includes("最差群組")), "判定理由不可沿用全板最差群組");
  assert.equal(H.scopedFindings(), SF, "同一範圍重複呼叫回傳同一份結果");
});

test("問題清單分頁：同一範圍內「再顯示」不會被重設", () => {
  assert.match(SRC, /ISS_PG\.F!==F0/);
  assert.match(SRC, /const pgK=\[[^\]]*S\.comp/);
});

test("捷徑選到其他群組的元件時，先改到該元件的群組", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, d, H } = await openPage();
  const sel = d.querySelector("#selGroup"); sel.value = "C 0402"; sel.dispatchEvent(new w.Event("change"));
  assert.equal(H.S.group, "C 0402");
  H.setCompFromShortcut(key("U2"));
  assert.equal(H.S.comp, key("U2"));
  assert.equal(H.S.group, "U2 BGA");
  assert.equal(d.querySelector("#selGroup").value, "U2 BGA");
});
