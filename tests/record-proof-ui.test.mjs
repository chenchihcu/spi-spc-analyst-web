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
    w.SPI_TEST_HOOK = {};
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
  // 選受控座標、填版次與工單後套用
  $('#btnSelectPlace').click();
  assert.ok(await until(() => rowOf(d, "#tblPickPlace", "PL-9")?.querySelector('[data-pact="use-place"]')));
  rowOf(d, "#tblPickPlace", "PL-9").querySelector('[data-pact="use-place"]').click();
  assert.ok(await until(() => $('#placePart').value === 'PL-9'));
  $('#recPickerClose').click();
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
