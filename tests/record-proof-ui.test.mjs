// 量測記錄與座標檔的對應證明（RFC-SPI-PROOF-20261028）：驗證對話框、舊紀錄重新受控匯入、相近料號提醒與新存入資料的可見性
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const { JSDOM } = (() => { try { return require("jsdom"); } catch { return {}; } })();
const fs = require("fs");
const { HTML, withIdb } = require("./_load.js");
import { createCloudHarness, installBrowserCloud } from './_cloud-harness.mjs';
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, n = 200) { for (let i = 0; i < n; i++) { if (fn()) return true; await tick(20); } return false; }

async function cloudPage() {
  const cloud = await createCloudHarness();
  const html = fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");
  const errs = [];
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://example.test/", beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
    Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { let e = this; while (e) { if (e.hidden) return null; e = e.parentElement; } return w.document.body; } });
    w.Element.prototype.scrollIntoView = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {} }); w.ResizeObserver = class { observe() {} }; w.scrollTo = () => {}; w.scrollBy = () => {};
    w.Chart = class { constructor() {} destroy() {} static register() {} };
    Object.assign(w, { Response, DecompressionStream });
    withIdb(w);
    installBrowserCloud(w, cloud);
    w.SPI_TEST_HOOK = { bootSample: true };
    w.addEventListener("error", (e) => errs.push(e.message));
  } });
  await dom.window.SPI_TEST_HOOK.RecDB.ready;
  await dom.window.SPI_TEST_HOOK.RecDB.list();
  return { dom, errs, cloud, w: dom.window, d: dom.window.document, $: s => dom.window.document.querySelector(s) };
}
const PLACE_CSV = "RefDes,X,Y,Layer\nC1,10,20,TOP\n";
const WIDE = "Component ID,Height(%)1,Volume(%)1,Area(%)1,PAD ID,Result1,Height(%)2,Volume(%)2,Area(%)2,Result2\nC1_1,100,101,99,1,PASS,102,103,98,PASS\nC1_1,100,101,99,2,PASS,102,103,98,PASS\n";
const rowOf = (d, sel, text) => [...d.querySelectorAll(`${sel} tbody tr`)].find(tr => tr.textContent.includes(text));
// 等選取的分頁實際渲染完成（表格已產生、品質篩選依分頁顯示或隱藏），不用固定休眠
async function openPicker(t, tab = "spi") {
  t.$("#btnOpenRecModal").click();
  t.$(tab === "place" ? "#btnPickPlace" : "#btnPickSpi").click();
  const box = tab === "place" ? "#boxPickPlace" : "#boxPickSpi", tbl = tab === "place" ? "#tblPickPlace" : "#tblPickSpi";
  assert.ok(await until(() => !t.$("#recPickerModal").hidden && !t.$(box).hidden && t.$(`${tbl} tbody`)
    && (t.$("#pickQualitySeg").style.display === "none") === (tab === "place")), `資料庫 ${tab} 分頁應完成渲染`);
}
async function seedLegacy(cloud, rec, source) {
  const raw = Buffer.from(source);
  const row = { kind: 'spi', user: 'old@example.test', created: Date.now() - 1000, bytes: raw.length,
    sha256: createHash('sha256').update(raw).digest('hex'), ...rec };
  const res = await cloud.repo.createRecord(row, gzipSync(raw));
  assert.ok(res.record, JSON.stringify(res));
  return res.record;
}

test("驗證有效紀錄：對應證明對話框顯示已證明與位號 N/M；確認位號不一致時判定落差", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const t = await cloudPage(), { d, $, cloud } = t;
  const place = await cloud.upload({ kind: 'place', part: 'PF-1', rev: 'V2', side: 'TOP', unit: 'mm', name: 'pf.csv' }, PLACE_CSV);
  const spi = await cloud.upload({ kind: 'spi', part: 'PF-1', rev: 'V2', side: 'TOP', placeId: place.id, workOrder: 'WO-1', lot: 'LOT-A', name: 'm.csv', vendor: 'lirong' }, WIDE);
  await t.w.SPI_TEST_HOOK.RecDB.list();
  await openPicker(t);
  assert.ok(await until(() => rowOf(d, "#tblPickSpi", "LOT-A")));
  assert.match(rowOf(d, "#tblPickSpi", "LOT-A").textContent, /PF-1 V2/, "關聯座標欄顯示座標料號與版次，不再只寫已綁定");
  assert.ok(d.querySelector(`#cardsPickSpi [data-pact="ver"][data-id="${spi.id}"]`), "手機卡片也有驗證按鈕");
  rowOf(d, "#tblPickSpi", "LOT-A").querySelector('[data-pact="ver"]').click();
  assert.ok(await until(() => /已證明對應：位號 1\/1/.test($("#proofBody").textContent)), $("#proofBody").textContent);
  assert.equal($("#proofModal").hidden, false);
  assert.match($("#proofTitle").textContent, /批號 LOT-A/);
  assert.match($("#proofBody").textContent, /與快照相同/);
  assert.match($("#proofBody").textContent, /PF-1[\s\S]*PF-1/);
  assert.ok(await until(() => /對應 ✓/.test(rowOf(d, "#tblPickSpi", "LOT-A").textContent)), "指紋欄顯示對應結果");
  $("#proofModal").dispatchEvent(new t.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal($("#proofModal").hidden, true);
  assert.equal($("#recPickerModal").hidden, false, "Esc 只關閉證明對話框");

  cloud.db.prepare(`UPDATE records SET unmatched_refs = '["Z9"]' WHERE id = ?`).run(spi.id);
  rowOf(d, "#tblPickSpi", "LOT-A").querySelector('[data-pact="ver"]').click();
  assert.ok(await until(() => /兩檔未被修改，但重新比對的無座標位號與上傳時確認的不同/.test($("#proofBody").textContent)));
  assert.match($("#proofBody").textContent, /上傳時確認但重算沒有：Z9/);
  assert.deepEqual(t.errs, []);
});

test("座標檔驗證列出引用的量測；指向不存在座標時顯示座標檔不存在；品質篩選只在量測分頁", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const t = await cloudPage(), { d, $, cloud } = t;
  const place = await cloud.upload({ kind: 'place', part: 'PR-1', rev: 'V1', side: 'TOP', unit: 'mm', name: 'pr.csv' }, PLACE_CSV);
  await cloud.upload({ kind: 'spi', part: 'PR-1', rev: 'V1', side: 'TOP', placeId: place.id, workOrder: 'WO-7', lot: 'LOT-R', name: 'm.csv' }, WIDE);
  await seedLegacy(cloud, { id: 'legacymissingplace0001', part: 'PR-1', lot: 'LOT-GONE', side: 'TOP', name: 'g.csv', placeId: 'missingplace0000000000' }, WIDE);
  await t.w.SPI_TEST_HOOK.RecDB.list();
  await openPicker(t);
  assert.ok(await until(() => rowOf(d, "#tblPickSpi", "LOT-GONE")));
  assert.match(rowOf(d, "#tblPickSpi", "LOT-GONE").textContent, /✗ 座標檔不存在/);
  assert.match(rowOf(d, "#tblPickSpi", "LOT-GONE").textContent, /舊資料・未受控/);
  rowOf(d, "#tblPickSpi", "LOT-GONE").querySelector('[data-pact="ver"]').click();
  assert.ok(await until(() => /無法證明對應：引用的座標檔紀錄不存在/.test($("#proofBody").textContent)), $("#proofBody").textContent);
  assert.match($("#proofBody").textContent, /沒有可比對的座標檔/);
  assert.doesNotMatch($("#proofBody").textContent, /undefined/, "座標檔不存在時不顯示 undefined");
  $("#proofModal").querySelector("[data-close]").click();
  assert.notEqual($("#pickQualitySeg").style.display, "none");
  await openPicker(t, "place");
  assert.equal($("#pickQualitySeg").style.display, "none", "座標檔庫隱藏品質篩選");
  assert.ok(await until(() => rowOf(d, "#tblPickPlace", "PR-1")));
  assert.match(rowOf(d, "#tblPickPlace", "PR-1").textContent, /pr\.csv/, "座標檔庫顯示原始檔名");
  rowOf(d, "#tblPickPlace", "PR-1").querySelector('[data-pact="ver"]').click();
  assert.ok(await until(() => /被 1 筆量測引用/.test($("#proofBody").textContent)), $("#proofBody").textContent);
  assert.match($("#proofBody").textContent, /座標原檔指紋與入庫時相同/);
  assert.match($("#proofBody").textContent, /LOT-R/);
  assert.deepEqual(t.errs, []);
});

test("舊紀錄：驗證顯示無座標引用，一鍵重新受控匯入後建立附證明的新紀錄並回連舊紀錄", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const t = await cloudPage(), { d, $, w, cloud } = t;
  const legacy = await seedLegacy(cloud, { id: 'legacyrecordforproof01', part: 'PL-9', lot: 'OLD-1', side: 'TOP', vendor: 'lirong', name: 'old_TOP.csv', stencil: 120 }, WIDE);
  const place = await cloud.upload({ kind: 'place', part: 'PL-9', rev: 'V3', side: 'TOP', unit: 'mm', name: 'pl.csv' }, PLACE_CSV);
  await w.SPI_TEST_HOOK.RecDB.list();
  await openPicker(t);
  assert.ok(await until(() => rowOf(d, "#tblPickSpi", "OLD-1")));
  assert.match(rowOf(d, "#tblPickSpi", "OLD-1").textContent, /未記錄/, "舊資料的板數與焊墊數標示未記錄");
  rowOf(d, "#tblPickSpi", "OLD-1").querySelector('[data-pact="ver"]').click();
  assert.ok(await until(() => /這筆是舊資料，沒有座標引用/.test($("#proofBody").textContent)));
  $('#proofBody [data-reimport]').click();
  assert.ok(await until(() => !$("#mapBox").hidden && $("#inLot").value === "OLD-1"), "帶入舊紀錄原檔與批號");
  assert.equal($("#inLot").readOnly, false, "重新匯入的欄位可修改");
  assert.equal($("#inPart").value, "PL-9");
  assert.equal($("#inRev").value, "");
  assert.match($("#recNote").textContent, /重新匯入舊紀錄 OLD-1/);
  assert.match($("#impSourceSummary").textContent, /原紀錄未記錄座標引用；本次尚未選取受控座標檔/);
  // 選受控座標、填版次與工單後套用
  $('#btnSelectPlace').click();
  assert.ok(await until(() => rowOf(d, "#tblPickPlace", "PL-9")?.querySelector('[data-pact="use-place"]')));
  rowOf(d, "#tblPickPlace", "PL-9").querySelector('[data-pact="use-place"]').click();
  assert.ok(await until(() => w.SPI_TEST_HOOK.getPlace()?.part === 'PL-9'));
  $('#recPickerClose').click();
  assert.match($("#impSourceSummary").textContent, /原紀錄未記錄座標引用；PL-9 V3 TOP（本次重新受控匯入使用）/);
  assert.doesNotMatch($("#impSourceSummary").textContent, /不套用目前選取座標/);
  $("#inRev").value = "V3"; $("#inWorkOrder").value = "WO-RE"; $("#inImpStencil").value = "120";
  const before = w.eval("S.runs.length");
  $("#btnApply").click();
  assert.ok(await until(() => w.eval("S.runs.length") === before + 1), `建立回合：${$("#recNote").textContent}`);
  const list = await w.SPI_TEST_HOOK.RecDB.list();
  const created = list.find(r => r.sourceLegacyId === legacy.id);
  assert.ok(created, "新紀錄指向舊紀錄");
  assert.equal(created.placeId, place.id);
  assert.equal(created.placeProof.sha256, place.sha256);
  assert.equal(list.find(r => r.id === legacy.id).validation_source, "legacy", "舊紀錄保留");
  await openPicker(t);
  const legacyRow = () => d.querySelector(`#tblPickSpi tr[data-row-id="${legacy.id}"]`);
  assert.ok(await until(() => /已重新匯入/.test(legacyRow()?.textContent || "")), "新紀錄沿用批號，舊紀錄列顯示已重新匯入");
  legacyRow().querySelector('[data-pact="goto"]').click();
  assert.ok(await until(() => d.querySelector(`#tblPickSpi tr.rec-new[data-row-id="${created.id}"]`)), "跳到並標亮新紀錄");
  d.querySelector(`#tblPickSpi tr[data-row-id="${created.id}"] [data-pact="ver"]`).click();
  assert.ok(await until(() => /已證明對應：位號 1\/1/.test($("#proofBody").textContent)), $("#proofBody").textContent);
  assert.deepEqual(t.errs, []);
});

test("座標登錄：相近料號要再按一次才存入；存入後篩選切到新料號並標亮剛存入", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const t = await cloudPage(), { d, $, w, cloud } = t;
  await cloud.upload({ kind: 'place', part: '301-0011001123', rev: 'v5', side: 'TOP', unit: 'mm', name: 'a.csv' }, PLACE_CSV);
  await w.SPI_TEST_HOOK.RecDB.list();
  await openPicker(t, "place");
  assert.ok(await until(() => rowOf(d, "#tblPickPlace", "301-0011001123")));
  $("#pickPartFilter").value = "301-0011001123";
  $("#pickPartFilter").dispatchEvent(new w.Event("change"));
  assert.match($("#partList").innerHTML, /301-0011001123/, "料號輸入框可選既有料號");
  $("#upPlacePart").value = "301-001100123";
  $("#upPlacePart").dispatchEvent(new w.Event("input"));
  assert.match($("#upPlacePartHint").textContent, /與既有料號 301-0011001123 相近/);
  $("#upPlaceRev").value = "v1"; $("#upPlaceSide").value = "TOP"; $("#upPlaceUnit").value = "mm";
  const inp = $("#upPlaceFile");
  Object.defineProperty(inp, "files", { configurable: true, value: [new w.File([Buffer.from(PLACE_CSV)], "typo.csv")] });
  inp.dispatchEvent(new w.Event("change"));
  $("#btnSubmitPlace").click();
  assert.ok(await until(() => $("#btnSubmitPlace").textContent === "確認是新料號並存入"), "第一次只提醒");
  assert.equal((await w.SPI_TEST_HOOK.RecDB.list()).filter(r => r.kind === "place").length, 1, "尚未存入");
  $("#btnSubmitPlace").click();
  assert.ok(await until(() => /已存入座標檔 301-001100123 v1（TOP，1 個元件）/.test($("#upPlaceState").textContent)), $("#upPlaceState").textContent, $("#recPickerModal").hidden, $("#recPickerNotice").textContent, (await w.SPI_TEST_HOOK.RecDB.list()).filter(r=>r.kind==="place").map(r=>r.part).join(","));
  assert.ok(await until(() => $("#pickPartFilter").value === "301-001100123"), "篩選切到剛存入的料號");
  const row = rowOf(d, "#tblPickPlace", "301-001100123");
  assert.ok(row && row.classList.contains("rec-new") && /剛存入/.test(row.textContent), "新列標亮");
  assert.equal($("#btnSubmitPlace").textContent, "存入資料庫");
  $("#upPlacePart").value = "301-0011001123";
  $("#upPlacePart").dispatchEvent(new w.Event("input"));
  assert.match($("#upPlacePartHint").textContent, /既有料號/);
  assert.deepEqual(t.errs, []);
});

test("配對卡：未成對顯示尚未搭配與座標檔不存在；從卡片匯入帶入料號版次面別", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const t = await cloudPage(), { d, $, w, cloud } = t;
  $("#btnOpenRecModal").click();
  $("#btnPickPlace").click();
  assert.ok(await until(() => /尚無座標檔/.test($("#tblPickPlace").textContent)), $("#tblPickPlace").textContent);
  assert.doesNotMatch($("#tblPickPlace").textContent, /於匯入時上傳/);
  $("#recPickerClose").click();
  const place = await cloud.upload({ kind: "place", part: "PAIR-1", rev: "V4", side: "TOP", unit: "mm", name: "pair.csv" }, PLACE_CSV);
  await cloud.upload({ kind: "spi", part: "PAIR-1", rev: "V4", side: "TOP", placeId: place.id, workOrder: "WO-P", lot: "LOT-PAIR", name: "m.csv", vendor: "lirong" }, WIDE);
  await seedLegacy(cloud, { id: "legacynopairrecord0001", part: "PAIR-1", lot: "LOT-NONE", side: "TOP", name: "none.csv", stencil: 120 }, WIDE);
  await seedLegacy(cloud, { id: "legacymissingpair00001", part: "PAIR-1", lot: "LOT-MISS", side: "TOP", name: "miss.csv", placeId: "missingplace0000000000" }, WIDE);
  await w.SPI_TEST_HOOK.RecDB.list();
  $("#btnOpenRecModal").click();
  assert.ok(await until(() => !$("#boxPickPairs").hidden && /LOT-NONE/.test($("#pairBoard").textContent)));
  assert.match($("#pairBoard").textContent, /尚未搭配/);
  assert.match($("#pairBoard").textContent, /座標檔不存在/);
  assert.match($("#pairBoard").textContent, /身分相符/);
  assert.match($("#pairBoard").textContent, /被 1 筆量測引用/);
  const imp = [...d.querySelectorAll("#pairBoard [data-pair-import]")].find(b => b.dataset.pairPart === "PAIR-1" && b.dataset.pairRev === "V4" && b.dataset.placeId === place.id);
  assert.ok(imp, "已配對的卡片可匯入量測");
  imp.click();
  const filled = await until(() => $("#inPart").value === "PAIR-1" && $("#inRev").value === "V4" && $("#selSide").value === "TOP" && w.SPI_TEST_HOOK.getPlace()?.recId === place.id);
  assert.ok(filled, JSON.stringify({ part: $("#inPart") && $("#inPart").value, rev: $("#inRev") && $("#inRev").value, side: $("#selSide") && $("#selSide").value, place: w.SPI_TEST_HOOK.getPlace(), toast: $("#toast") && $("#toast").textContent, errs: t.errs, tab: $("#p-data") && $("#p-data").hidden }));
  $("#inRev").value = "V9";
  $("#inRev").dispatchEvent(new w.Event("input"));
  assert.match($("#inRevError").textContent, /版次/);
  assert.deepEqual(t.errs, []);
});

test("配對審查修正：捷徑選座標會重轉、身分警示不被冒泡清除、篩選保留引用座標、狀態徽章、取消登錄不殘留", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const t = await cloudPage(), { d, $, w, cloud } = t;
  const place = await cloud.upload({ kind: "place", part: "REV-1", rev: "V1", side: "TOP", unit: "mm", name: "rev.csv" }, PLACE_CSV);
  await cloud.upload({ kind: "spi", part: "REV-1", rev: "V1", side: "TOP", placeId: place.id, workOrder: "WO-R", lot: "LOT-ONLY-SPI", name: "m.csv", vendor: "lirong" }, WIDE);
  await w.SPI_TEST_HOOK.RecDB.list();

  // 篩選只命中量測（批號）時，配對卡仍顯示它引用的座標，匯入鈕帶既有座標 ID，並顯示狀態徽章
  $("#btnOpenRecModal").click();
  assert.ok(await until(() => !$("#boxPickPairs").hidden && /LOT-ONLY-SPI/.test($("#pairBoard").textContent)));
  $("#recPickerQ").value = "LOT-ONLY-SPI";
  await w.SPI_TEST_HOOK.renderRecPicker();
  assert.ok(/LOT-ONLY-SPI/.test($("#pairBoard").textContent));
  const card = [...d.querySelectorAll("#pairBoard .pair-card")].find(c => /LOT-ONLY-SPI/.test(c.textContent));
  assert.ok(card, $("#pairBoard").textContent);
  assert.doesNotMatch(card.textContent, /此版次還沒有座標檔/, "引用的座標不應被篩選成空位");
  assert.match(card.textContent, /被 1 筆量測引用/);
  assert.equal(card.querySelector("[data-pair-import]").dataset.placeId, place.id);
  assert.match(card.querySelector(`[data-row-id] .pill`)?.textContent || "", /有效/, "量測列顯示生命週期徽章");

  // 按「先登錄座標檔」後關閉，返回匯入的意圖要清除
  $("#recPickerClose").click();
  w.SPI_TEST_HOOK.setTab("data"); w.SPI_TEST_HOOK.setSub("import");
  $("#btnRegisterPlace").click();
  assert.ok(await until(() => !$("#recPickerModal").hidden));
  $("#recPickerClose").click();
  $("#btnOpenRecModal").click();
  $("#upPlacePart").value = "OTHER-1"; $("#upPlaceRev").value = "V7"; $("#upPlaceSide").value = "TOP"; $("#upPlaceUnit").value = "mm";
  const up = $("#upPlaceFile");
  Object.defineProperty(up, "files", { configurable: true, value: [new w.File([Buffer.from(PLACE_CSV)], "other.csv")] });
  up.dispatchEvent(new w.Event("change"));
  $("#btnSubmitPlace").click();
  if (await until(() => /確認是新料號並存入/.test($("#btnSubmitPlace").textContent), 20)) $("#btnSubmitPlace").click();
  assert.ok(await until(() => /已存入座標檔 OTHER-1/.test($("#upPlaceState").textContent)), $("#upPlaceState").textContent);
  assert.equal($("#recPickerModal").hidden, false, "一般登錄留在記錄庫");
  assert.notEqual(w.SPI_TEST_HOOK.getPlace()?.part, "OTHER-1", "一般登錄不改目前選取的座標");
  $("#recPickerClose").click();

  // 匯入卡：解析量測後用「符合的座標檔」捷徑選取，待匯入資料要依新座標重轉
  w.SPI_TEST_HOOK.setTab("data"); w.SPI_TEST_HOOK.setSub("import");
  $("#inPart").value = "REV-1"; $("#inRev").value = "V1"; $("#selSide").value = "TOP";
  $("#selSide").dispatchEvent(new w.Event("change", { bubbles: true }));
  const fin = $("#fileIn");
  Object.defineProperty(fin, "files", { configurable: true, value: [new w.File([Buffer.from(WIDE)], "m2.csv")] });
  fin.dispatchEvent(new w.Event("change"));
  assert.ok(await until(() => !$("#mapBox").hidden || $("#parseErr").textContent), "量測已解析");
  $("#inPart").value = "REV-1"; $("#inRev").value = "V1"; $("#selSide").value = "TOP";
  $("#inRev").dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.match($("#mapBox").textContent, /尚未選取受控座標檔/, "選座標前的轉換沒有座標");
  const btn = await until(() => $(`#placeChoices [data-pick-place="${place.id}"]`)) && $(`#placeChoices [data-pick-place="${place.id}"]`);
  assert.ok(btn, $("#placeChoices").textContent);
  btn.click();
  assert.ok(await until(() => w.SPI_TEST_HOOK.getPlace()?.recId === place.id));
  assert.ok(await until(() => /座標檔對應 1\/1 個元件/.test($("#mapBox").textContent)), "選取座標後依新座標重新轉換待匯入資料：" + $("#mapBox").textContent.slice(0, 300));

  // 版次與座標不符的警示，經過匯入卡的冒泡清除後仍保留
  $("#inRev").value = "V9";
  $("#inRev").dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.match($("#inRevError").textContent, /與所選座標版次 V1 不同/);
  assert.equal($("#inRev").getAttribute("aria-invalid"), "true");
  assert.deepEqual(t.errs, []);
});
