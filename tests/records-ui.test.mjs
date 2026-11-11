// 資料庫介面測試（本機模式：claude.ai／本機檔案時存在瀏覽器 IndexedDB）
// 必填檢查 → 存入後建立回合（回合帶批號／料號／指紋）→ 資料庫頁列出、驗證、下載原始檔 → 從資料庫開啟 → 重複檔 → 刪除與稽核紀錄
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { JSDOM } = (() => { try { return require("jsdom"); } catch { return {}; } })();
const fs = require("fs");
const { HTML, withIdb, seedPartSpec } = require("./_load.js");
import { createCloudHarness, installBrowserCloud } from './_cloud-harness.mjs';
import { uploadPlaceViaPicker, openPlacePicker, openPickerTab, getPlacePart, getPlaceRev, until as placeUntil, applyPlaceFromPicker } from './_place-picker.mjs';
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

function page(saved, cloud, preloadPlace) {
  const html = fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");
  const errs = [];
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://example.test/", beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
    Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { let e = this; while (e) { if (e.hidden) return null; e = e.parentElement; } return w.document.body; } });
    w.Element.prototype.scrollIntoView = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {} }); w.ResizeObserver = class { observe() {} }; w.scrollTo = () => {}; w.scrollBy = () => {};
    w.Chart = class { constructor() {} destroy() {} static register() {} };
    // 模擬 claude.ai 的下載功能，記下收到的檔名與內容
    w.claude = { use: async (n) => (n === "downloads" ? { save: async (x) => { saved.push(x); return { status: "saved" }; } } : null) };
    Object.assign(w, { Response, DecompressionStream });
    withIdb(w);
    if (cloud) installBrowserCloud(w, cloud);
    if (preloadPlace) w.localStorage.setItem('spi-place', preloadPlace);
    w.SPI_TEST_HOOK = {};
    w.addEventListener("error", (e) => errs.push(e.message));
  } });
  return { dom, errs };
}
const CSV = "Board,Pad,Component,Volume,Height(um),Area\n" + Array.from({ length: 60 }, (_, i) => `B${Math.floor(i / 6) + 1},P${i % 6},U1,${100 + (i % 5)},120,100`).join("\n");
async function until(fn, n = 150) { for (let i = 0; i < n; i++) { if (fn()) return true; await tick(20); } return false; }
async function pickFile(dom, name, text) {
  const w = dom.window, inp = w.document.querySelector("#fileIn");
  Object.defineProperty(inp, "files", { configurable: true, value: [new w.File([Buffer.from(text)], name)] });
  inp.dispatchEvent(new w.Event("change"));
  await until(() => !w.document.querySelector("#mapBox").hidden || w.document.querySelector("#parseErr").textContent);
}
async function cloudPage(saved = []) {
  const cloud = await createCloudHarness();
  const result = page(saved, cloud);
  await result.dom.window.SPI_TEST_HOOK.RecDB.ready;
  await result.dom.window.SPI_TEST_HOOK.RecDB.list();
  return { ...result, cloud };
}
async function selectPlace(dom, cloud, part, rev = 'V1', side = 'TOP', ref = 'U1') {
  const w = dom.window, d = dom.window.document;
  const rec = await cloud.upload({ kind: 'place', part, rev, side, unit: 'mm', name: `${part}-${rev}.csv` },
    `RefDes,X,Y,Layer\n${ref},1,2,${side}\n`);
  d.querySelector('#btnSelectPlace').click();
  assert.ok(await until(() => [...d.querySelectorAll('#tblPickPlace tr')].some(tr => tr.textContent.includes(part) && tr.querySelector('[data-pact="use-place"]'))));
  [...d.querySelectorAll('#tblPickPlace tr')].find(tr => tr.textContent.includes(part)).querySelector('[data-pact="use-place"]').click();
  assert.ok(await placeUntil(() => getPlacePart(w) === part));
  d.querySelector('#recPickerClose').click();
  d.querySelector('#selSide').value = side;
  return rec;
}
async function uploadSpec(dom, cloud, part) {
  const w = dom.window;
  const bytes = w.eval(`(()=>{const sp={schema:"spi-part-spec/1",part:${JSON.stringify(part)},stencilRef:120,specs:{},groups:{},note:"測試"};for(const k of PART_SPEC_METRICS)sp.specs[k]={...DEF_SPECS[k]};return partSpecEncode(sp).bytes})()`);
  await cloud.upload({ kind: 'spec', part, makeDefault: true }, bytes);
}
function setImportFields(d, part, lot, rev = 'V1', workOrder = `WO-${lot}`) {
  d.querySelector('#inLot').value = lot;
  d.querySelector('#inPart').value = part;
  d.querySelector('#inRev').value = rev;
  d.querySelector('#inWorkOrder').value = workOrder;
  d.querySelector('#inImpStencil').value = '120';
}
let historicalSeq = 0;
async function seedHistorical(w, rec, source) {
  const bytes = Buffer.from(source);
  const row = { id: rec.id || `historical${String(++historicalSeq).padStart(12, '0')}`,
    user: 'historical@example.test', created: Date.now(), bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), lifecycle: 'legacy', ...rec };
  const db = await w.SPI_TEST_HOOK.LocalRec.open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['files', 'meta'], 'readwrite');
    tx.objectStore('files').put(new w.Uint8Array(bytes), row.id);
    tx.objectStore('meta').put(row);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return row;
}

test("匯入來源未標高度單位時顯示未知並阻止套用；明確選 µm 後顯示 µm", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { dom, errs } = await cloudPage();
  const w = dom.window, d = w.document;
  await pickFile(dom, "unitless.csv", "Board,Pad,Component,Volume,Height,Area\nB1,P1,U1,100,120,100\n");
  assert.match(d.querySelector("#mapPrev").textContent, /高度 120（單位未確認）/);
  assert.doesNotMatch(d.querySelector("#mapPrev").textContent, /高度 120 µm/);
  assert.equal(d.querySelector("#btnApply").disabled, true, "未確認高度單位前不可套用分析");
  d.querySelector("#optH").value = "um";
  d.querySelector("#optH").dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.match(d.querySelector("#mapPrev").textContent, /高度 120 µm/);
  assert.equal(d.querySelector("#btnApply").disabled, false, "明確指定 µm 後不再因單位阻擋");
  const unknown = w.SPI_TEST_HOOK.specDownloadInfo({ part: "P1" });
  assert.equal(unknown.filename, "料號規格_P1_版本未知.json");
  assert.match(unknown.warning, /沒有版本號/);
  const known = w.SPI_TEST_HOOK.specDownloadInfo({ part: "P1", ver: 3 });
  assert.equal(known.filename, "料號規格_P1_v3.json");
  assert.equal(known.warning, "");
  w.eval("SPI_TEST_HOOK.S.runId=null;SPI_TEST_HOOK.S.rows=[{group:'0402',groupBasis:'package'}];SPI_TEST_HOOK.updateRailSummary()");
  assert.match(d.querySelector("#railChipSummary").textContent, /分組依據：封裝/);
  assert.deepEqual(errs, []);
  dom.window.close();
});

test("UNKNOWN_UNIT 恢復舊回合時停用高度分析與規格比較", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { dom, errs } = page([], null);
  const w = dom.window, d = w.document, h = w.SPI_TEST_HOOK, S = h.S;
  w.eval("saveRunsSoon=()=>{};updateStartupDbBanner=()=>{}");
  assert.ok(await until(() => S.runId != null && d.querySelector("#selRun option:checked")?.textContent), "等待舊回合測試頁面完成初始載入");
  const rows = [];
  for (let b = 1; b <= 10; b++) for (let i = 0; i < 6; i++) rows.push({
    board: `B${b}`, pad: `P${i}`, comp: `P${i}`, group: "G", volume: 100 + (i % 5), height: 200 + i, area: 100
  });
  const id = Math.max(0, ...S.runs.map(r => r.id)) + 1;
  S.runs.push({ id, name: "舊版未知單位回合", rows, metrics: ["volume", "height", "hpct", "area"], info: {}, sample: false,
    cfg: { specs: JSON.parse(JSON.stringify(S.specs)), specSrc: "none", partSpec: null, specDraft: null, specsG: null,
      stencil: 120, htol: { lo: 75, hi: 125 }, step: { on: false, zones: [] }, aperture: { groups: {} }, wipe: 5 } });
  S.metric = "height";
  h.switchRun(id);
  d.querySelector('[data-tab=capability]').click();
  assert.ok(await until(() => d.querySelector("#selRun option:checked")?.textContent === "舊版未知單位回合" && d.querySelector("#selMetric").value === S.metric), "等待回合切換完成");
  assert.ok(await until(() => d.querySelector("#stencilNote")), "規格頁應顯示鋼板厚度說明");
  assert.equal(S.heightUnit, "unknown");
  assert.ok(!S.metrics.includes("height") && !S.metrics.includes("hpct"), "高度與高度%不得留在舊回合的可選分析項目");
  assert.notEqual(S.metric, "height", "選取的分析項目須回到可用指標");
  assert.match(d.querySelector("#stencilNote").textContent, /高度不以 µm 規格判讀/);
  assert.doesNotMatch(d.querySelector("#stencilNote").textContent, /\d+\s*~\s*\d+\s*µm/);
  assert.ok(await until(() => [...d.querySelectorAll("#specTbl th[scope=row]")].some(x => x.textContent.includes("高度"))), "規格表應載入高度列");
  const heightHeader = [...d.querySelectorAll("#specTbl th[scope=row]")].find(x => x.textContent.includes("高度"));
  assert.match(heightHeader.textContent, /單位未知/);
  const out = h.buildStatsData(S);
  assert.equal(out.filter(x => x.metric === "height" && /^OOC/.test(x.rule)).length, 0, "舊回合不可用未知高度單位輸出規格異常");
  assert.deepEqual(errs, []);
  dom.window.close();
});

test("JS 版 SHA-256（瀏覽器不支援內建時使用）與標準結果相同", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { dom } = page([]);
  await tick(50);
  const w = dom.window;
  for (const s of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "中文批號 L2410", "x".repeat(100000)]) {
    const hex = w.eval(`SPI_TEST_HOOK.sha256js(new TextEncoder().encode(${JSON.stringify(s)}))`);
    assert.equal(hex, createHash("sha256").update(s).digest("hex"), `長度 ${s.length}`);
  }
});

test("受控欄位必填；存入後才建立回合，回合帶來源資訊；資料庫頁可列出、驗證、下載原始檔（內容不變）", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const saved = [], { dom, errs, cloud } = await cloudPage(saved);
  await tick(50);
  const w = dom.window, d = w.document, $ = (s) => d.querySelector(s);
  await selectPlace(dom, cloud, '301-000100124');
  $("[data-tab=data]").click();
  await pickFile(dom, "批次A_TOP.csv", CSV);
  assert.equal($("#recRow").hidden, false);
  $("#inLot").value = ""; $("#inPart").value = "";
  $("#btnApply").click(); await tick(50);
  assert.match($("#recNote").textContent, /請填寫料號、版次，以及製令工單或量測日期/);
  assert.equal(w.eval("S.runs.length"), 2, "未填不建立回合");
  setImportFields(d, '301-000100124', 'L2410-01');
  await uploadSpec(dom, cloud, '301-000100124');
  $("#btnApply").click();
  assert.ok(await until(() => w.eval("S.runs.length") === 3), "存入後建立回合");
  const src = JSON.parse(w.eval("JSON.stringify(SPI_TEST_HOOK.curRun().info.src)"));
  assert.equal(src.lot, "L2410-01"); assert.equal(src.part, "301-000100124"); assert.equal(src.store, "cloud"); assert.equal(src.user, "admin@example.test");
  assert.equal(src.sha256, createHash("sha256").update(CSV).digest("hex"), "指紋為原始檔的 SHA-256");
  assert.match(w.eval("SPI_TEST_HOOK.reportMd()"), /批號 L2410-01｜產品料號 301-000100124/, "報告帶批號與料號");
  // 資料庫頁
  openPickerTab(d, 'spi');
  assert.ok(await until(() => !$("#recPickerModal").hidden && /L2410-01/.test($("#tblPickSpi").textContent)));
  assert.equal(w.eval("SPI_TEST_HOOK.RecDB.mode"), "cloud");
  $('#tblPickSpi [data-pact="ver"]').click();
  assert.ok(await until(() => !$("#proofModal").hidden && $("#proofBody").textContent.length > 20), "驗證對話框應顯示證明內容");
  assert.match($("#proofBody").textContent, /指紋|SHA|相同|一致/);
  $('#tblPickSpi [data-pact="dl"]').click();
  assert.ok(await until(() => saved.length === 1));
  assert.equal(saved[0].filename, "批次A_TOP.csv");
  const txt = await saved[0].data.text();
  assert.equal(txt, CSV, "下載的原始檔與上傳完全相同");
  // 回合清單顯示批號
  $('.subtab[data-sub="runs"]').click();
  assert.match($("#runTbl").textContent, /L2410-01/);
  assert.deepEqual(errs, []);
});

test("重複檔沿用既有紀錄；從資料庫開啟不重複存；受控原始檔不可刪且稽核保留", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { dom, errs, cloud } = await cloudPage();
  await tick(50);
  const w = dom.window, d = w.document, $ = (s) => d.querySelector(s);
  await selectPlace(dom, cloud, 'P1');
  await uploadSpec(dom, cloud, 'P1');
  $("[data-tab=data]").click();
  for (let k = 0; k < 2; k++) {
    await pickFile(dom, "a.csv", CSV);
    setImportFields(d, 'P1', 'L1'); $("#btnApply").click();
    assert.ok(await until(() => w.eval("S.runs.length") === 3 + k));
  }
  const recs = await w.eval("SPI_TEST_HOOK.RecDB.list()");
  assert.equal(recs.filter(r => r.kind === 'spi').length, 1, "相同原始檔與料號版次面別只存一筆");
  assert.equal(w.eval("S.runs[2].info.src.id"), w.eval("S.runs[3].info.src.id"), "兩個回合連到同一筆紀錄");
  assert.equal($("#impDupNotice").hidden, false, "409 後應保留可讀的重複檔提示");
  // 從資料庫開啟
  openPickerTab(d, 'spi');
  assert.ok(await until(() => d.querySelector('#tblPickSpi [data-pact="open"]')));
  $('#tblPickSpi [data-pact="open"]').click();
  assert.ok(await until(() => !$("#mapBox").hidden && $("#inLot").value === "L1"));
  assert.equal($("#inLot").readOnly, true); assert.equal($("#inPart").readOnly, true);
  assert.match($("#recNote").textContent, /不會重複存檔/);
  $("#btnApply").click();
  assert.ok(await until(() => w.eval("S.runs.length") === 5));
  assert.equal((await w.eval("SPI_TEST_HOOK.RecDB.list()")).filter(r => r.kind === 'spi').length, 1, "開啟後套用不新增紀錄");
  assert.equal($("#tblPickSpi [data-pact=del]"), null, "正式量測原始檔沒有刪除鈕");
  await assert.rejects(w.eval(`SPI_TEST_HOOK.RecDB.del(${JSON.stringify(recs.find(r => r.kind === 'spi').id)})`), /原始檔須保留/);
  assert.equal((await w.eval("SPI_TEST_HOOK.RecDB.list()")).filter(r => r.kind === 'spi').length, 1, "拒絕刪除後仍可讀取");
  openPickerTab(d, 'specs');
  $("#recAuditBox").open = true; $("#recAuditBox").dispatchEvent(new w.Event("toggle"));
  assert.ok(await until(() => /新增/.test($("#recAudit").textContent)));
  const audit = $("#recAudit").textContent;
  assert.match(audit, /L1/); assert.doesNotMatch(audit, /刪除/);
  assert.deepEqual(errs, []);
});

test("座標檔：受控欄位未填不能上傳；存入後可在資料庫選取；料號與量測不同時提醒", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { dom } = await cloudPage();
  await tick(50);
  const w = dom.window, d = w.document, $ = (s) => d.querySelector(s);
  const sv = $("#selVendor"); sv.value = "lirong"; sv.dispatchEvent(new w.Event("change"));
  const PL = "RefDes,X,Y,PartType,Layer\nC1,10,20,C0402,TOP\n";
  await openPlacePicker(d);
  const inp = $('#upPlaceFile');
  Object.defineProperty(inp, 'files', { configurable: true, value: [new w.File([Buffer.from(PL)], 'p.csv')] });
  inp.dispatchEvent(new w.Event('change'));
  await tick(50);
  $('#btnSubmitPlace').click();
  assert.match($("#upPlaceState").textContent || $("#upPlaceState").innerHTML, /請填寫正式料號、版次/);
  assert.equal((await w.eval("SPI_TEST_HOOK.RecDB.list()")).length, 0);
  await uploadPlaceViaPicker(w, d, {
    part: 'X3000', rev: 'V5', side: 'TOP', unit: 'mm',
    body: Buffer.from(PL), name: 'p.csv',
  });
  assert.match($("#placeState").textContent, /料號 X3000 版次 V5.*1 個元件/);
  const list = await w.eval("SPI_TEST_HOOK.RecDB.list()");
  assert.equal(list.length, 1); assert.equal(list[0].kind, "place"); assert.equal(list[0].comps, 1);
  // 料號不同的提醒（量測檔用通用格式）
  $("[data-tab=data]").click(); sv.value = "generic"; sv.dispatchEvent(new w.Event("change"));
  await pickFile(dom, "m_TOP.csv", CSV.replace("Board,Pad,Component,Volume,Height,Area", "Board,Pad,Component,Volume,Height,Area"));
  $("#inPart").value = "OTHER"; $("#inPart").dispatchEvent(new w.Event("input"));
  assert.match($("#recNote").textContent, /座標檔料號為 X3000，與量測料號不同/);
  // 移除後再從資料庫設為目前座標檔
  $("#placeClear").click();
  assert.match($("#placeState").textContent, /未套用受控座標檔/);
  openPickerTab(d, 'place');
  assert.ok(await until(() => d.querySelector('#tblPickPlace [data-pact="use-place"]')));
  $('#tblPickPlace [data-pact="use-place"]').click();
  assert.ok(await until(() => /料號 X3000 版次 V5/.test($("#placeState").textContent)));
  assert.ok(await until(() => /目前已選取/.test($("#tblPickPlace").textContent)));
});

test("開啟歷史立榮紀錄：無原座標不借用目前座標；有原座標則帶回原座標", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const placeText = "RefDes,X,Y,PartType,Layer\nC1,10,20,C0402,TOP\n";
  const placeId = 'historicalplace0000001';
  const tab = { head: placeText.trim().split('\n')[0].split(','), data: [placeText.trim().split('\n')[1].split(',')] };
  const preload = JSON.stringify({ recId: placeId, part: 'PW', rev: 'V1', name: 'pl.csv', tab, unit: 'mm', side: 'TOP' });
  const { dom, errs } = page([], null, preload);
  await tick(50);
  const w = dom.window, d = w.document, $ = (s) => d.querySelector(s);
  const head = ["Component ID", "Height(%)1", "Volume(%)1", "Area(%)1", "PAD ID", "Result1", "Height(%)2", "Volume(%)2", "Area(%)2", "Result2"].join(",");
  const WIDE = head + "\nC1_1,100,101,99,1,PASS,102,103,98,PASS\nC1_1,100,101,99,2,PASS,102,103,98,PASS\n";
  const noPlace = await seedHistorical(w, { kind: 'spi', part: 'PW', lot: 'LW', side: 'TOP', vendor: 'lirong', name: 'W_TOP.csv', stencil: 120 }, WIDE);
  const place = await seedHistorical(w, { id: placeId, kind: 'place', part: 'PW', rev: 'V1', side: 'TOP', unit: 'mm', name: 'pl.csv' }, placeText);
  assert.match($('#placeState').textContent, /料號 PW 版次 V1/);
  await w.SPI_TEST_HOOK.openRecord(noPlace, { autoApply: false });
  assert.match($('#mapPrev').textContent, /尚未選取受控座標檔/, '歷史紀錄不得借用後來載入的座標');
  assert.match($('#toast').textContent, /當時沒有使用座標檔/);
  const withPlace = await seedHistorical(w, { kind: 'spi', part: 'PW', lot: 'LP', side: 'TOP', vendor: 'lirong', name: 'W_TOP.csv', stencil: 120, placeId: place.id }, WIDE);
  $('#placeClear').click();
  await w.SPI_TEST_HOOK.openRecord(withPlace, { autoApply: false });
  assert.match($('#mapPrev').textContent, /座標檔對應 1\/1/, '帶回歷史紀錄實際引用的座標檔');
  assert.equal($('#inLot').value, 'LP');
  assert.deepEqual(errs, []);
});

test("開啟沒有座標引用的通用格式歷史紀錄：不論加工廠格式都不借用目前座標", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const placeText = "RefDes,X,Y,PartType,Layer\nU1,10,20,C0402,TOP\n";
  const tab = { head: placeText.trim().split('\n')[0].split(','), data: [placeText.trim().split('\n')[1].split(',')] };
  const preload = JSON.stringify({ recId: 'currentplace0000000001', part: 'PG', rev: 'V1', name: 'pl.csv', tab, unit: 'mm', side: 'TOP' });
  const { dom, errs } = page([], null, preload);
  await tick(50);
  const w = dom.window, $ = (s) => w.document.querySelector(s);
  const generic = await seedHistorical(w, { kind: 'spi', part: 'PG', lot: 'LG', side: 'TOP', vendor: 'generic', name: 'g.csv', stencil: 120 }, CSV);
  assert.match($('#placeState').textContent, /料號 PG 版次 V1/);
  await w.SPI_TEST_HOOK.openRecord(generic, { autoApply: false });
  assert.doesNotMatch($('#mapPrev').textContent, /座標檔已套用/, '歷史通用格式紀錄不得借用目前座標');
  assert.match($('#toast').textContent, /當時沒有使用座標檔/);
  assert.deepEqual(errs, []);
});

test("歷史紀錄開啟失敗不污染下一次匯入；原座標缺失時可檢視且不借用其他座標", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { dom, errs } = page([]);
  await tick(50);
  const w = dom.window, d = w.document, $ = (s) => d.querySelector(s);
  // 以歷史資料快照重現既有壞檔；正式新匯入不能在本機寫入。
  await seedHistorical(w, { kind: 'spi', lot: 'BAD', part: 'P', side: 'TOP', vendor: 'generic', name: 'bad.xlsx' }, 'not a zip at all, broken');
  openPickerTab(d, 'spi');
  assert.ok(await until(() => d.querySelector('#tblPickSpi [data-pact="open"]')));
  $('#tblPickSpi [data-pact="open"]').click();
  assert.ok(await until(() => /無法開啟/.test(($("#toast") || {}).textContent || "")));
  // 接著手動匯入：批號可填、會另存新紀錄
  await pickFile(dom, "ok.csv", CSV);
  assert.equal($("#inLot").readOnly, false, "沒有沿用失敗的紀錄");
  assert.equal($("#inLot").value, "");
  assert.equal(w.eval('S.runs.length'), 2, '壞檔沒有建立分析回合');
  // 歷史量測原先連結的座標已不存在；讀取時不能套用當前座標。
  const WIDE = "Component ID,Height(%)1,Volume(%)1,Area(%)1,PAD ID,Result1,Height(%)2,Volume(%)2,Area(%)2,Result2\nC1_1,100,101,99,1,PASS,102,103,98,PASS\n";
  const missing = 'missingplace0000000000';
  const historical = await seedHistorical(w, { kind: 'spi', lot: 'LP', part: 'P', side: 'TOP', vendor: 'lirong', name: 'L_TOP.csv', placeId: missing, stencil: 120 }, WIDE);
  assert.equal(historical.placeId, missing);
  openPickerTab(d, 'spi');
  $("#recPickerReload").click();
  assert.ok(await until(() => [...d.querySelectorAll("#tblPickSpi tbody tr")].some((tr) => tr.textContent.includes("LP"))));
  [...d.querySelectorAll("#tblPickSpi tbody tr")].find((tr) => tr.textContent.includes("LP")).querySelector('[data-pact="open"]').click();
  assert.ok(await until(() => !$("#mapBox").hidden && $("#inLot").value === "LP"));
  assert.match($("#toast").textContent, /當時的座標檔無法取回或缺少已驗證設定/);
  assert.match($("#mapPrev").textContent, /尚未選取受控座標檔/);
  assert.deepEqual(errs, []);
});

test("歷史舊資料回合在選取相符座標檔後即時套用檢視座標；不符則防護提醒並維持示意網格", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { dom, errs } = page([]);
  await tick(50);
  const w = dom.window, d = w.document, $ = (s) => d.querySelector(s);
  const hook = w.SPI_TEST_HOOK;

  // 1. 建立未受控歷史量測紀錄（301-000100124，TOP 面，無 placeId）
  const head = ["Component ID", "Height(%)1", "Volume(%)1", "Area(%)1", "PAD ID", "Result1", "Height(%)2", "Volume(%)2", "Area(%)2", "Result2"].join(",");
  const WIDE = head + "\nC1_1,100,101,99,1,PASS,102,103,98,PASS\nC1_1,100,101,99,2,PASS,102,103,98,PASS\n";
  const part = "301-000100124";
  const legacyRec = await seedHistorical(w, {
    kind: "spi",
    part,
    lot: "B09-LOT",
    side: "TOP",
    vendor: "lirong",
    name: "301-000100124 TOP 量測紀錄.csv",
    stencil: 90,
    lifecycle: "legacy",
    validation_source: "legacy"
  }, WIDE);

  // 2. 建立同料號受控座標檔 (包含 C1 在 TOP 面)
  const placeText = "RefDes,X,Y,PartType,Layer\nC1,12.5,34.8,C0402,TOP\n";
  const placeRec = await seedHistorical(w, {
    id: "place301000100124top",
    kind: "place",
    part,
    rev: "V1",
    side: "TOP",
    unit: "mm",
    name: "301-000100124_V1.csv",
    lifecycle: "active",
    validation_source: "server_verified"
  }, placeText);

  // 3. 建立不符料號的座標檔 (BOT 面或不同料號)
  const otherPlace = await seedHistorical(w, {
    id: "otherplace0000000001",
    kind: "place",
    part: "999-DIFFERENT",
    rev: "V1",
    side: "BOT",
    unit: "mm",
    name: "other.csv",
    lifecycle: "active",
    validation_source: "server_verified"
  }, "RefDes,X,Y,PartType,Layer\nR1,1,2,R0402,BOT\n");

  // 4. 開啟歷史紀錄並套用至分析回合
  await hook.openRecord(legacyRec, { autoApply: false });
  $("#btnApply").click();
  assert.ok(await until(() => hook.curRun() && hook.curRun().name.includes(part)), "應已建立並載入分析回合");
  const cur = hook.curRun();
  assert.equal(cur.rows[0].gridPos, true, "剛開啟無座標歷史紀錄時應為虛擬網格");
  assert.match($("#statePlace").textContent, /未套用/, "尚未選取座標檔時應顯示未套用");

  // 5. 選取不相符料號的座標檔 -> 應提示不符，且不套用至目前回合
  await hook.usePlaceRec(otherPlace);
  hook.syncPlaceToCurrentRun({ notify: true });
  assert.match($("#statePlace").textContent, /已選取/, "不符座標檔應僅顯示已選取，不顯示已套用");
  assert.equal(cur.rows[0].gridPos, true, "不符料號不得清除 gridPos");

  // 6. 選取相符料號與面別的座標檔 -> 應自動套用檢視座標
  await hook.usePlaceRec(placeRec);
  hook.syncPlaceToCurrentRun({ notify: true });
  assert.match($("#statePlace").textContent, /座標檔：已套用（檢視）/, "相符座標檔應顯示已套用（檢視）");
  assert.equal($("#statePlace").dataset.state, "ok", "膠囊狀態應亮綠燈 ok");
  assert.equal(cur.rows[0].gridPos, undefined, "套用座標後應清除 gridPos");
  assert.equal(cur.rows[0].componentX, 12.5, "應填入對應的元件 X 座標");
  assert.equal(cur.rows[0].componentY, 34.8, "應填入對應的元件 Y 座標");
  assert.match(hook.pos3DNote(), /元件中心示意/, "3D 註記應為元件中心示意");
  assert.doesNotMatch(hook.pos3DNote(), /無實際座標，為排列示意網格/, "3D 註記不應再出現排列示意網格");

  // 7. 清除座標檔 -> 應還原為示意網格
  $("#placeClear").click();
  assert.equal(cur.rows[0].gridPos, true, "清除座標檔後應還原為 gridPos 虛擬網格");
  assert.match($("#statePlace").textContent, /座標檔：未套用/, "清除後應顯示未套用");
  assert.match(hook.pos3DNote(), /無實際座標，為排列示意網格/, "清除後 3D 應重新顯示排列示意網格");

  assert.deepEqual(errs, []);
});
