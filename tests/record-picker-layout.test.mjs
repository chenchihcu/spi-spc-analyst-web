// 記錄庫版面守衛（v10.35.0）：守住「清單看得到」這件事本身。
// 根因：過去每次改版都在清單上方或外層再加一塊（配對卡、常駐登錄表單、多排篩選、分頁內 max-height），
// 手機上清單只剩 1/4 螢幕且雙重捲動。這裡的斷言讓那幾種加法直接變紅。
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const { JSDOM } = (() => { try { return require("jsdom"); } catch { return {}; } })();
const fs = require("fs");
const { HTML, withIdb } = require("./_load.js");
import { createCloudHarness, installBrowserCloud } from "./_cloud-harness.mjs";

const SRC = fs.readFileSync(HTML, "utf8");
const tick = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 200) { for (let i = 0; i < n; i++) { if (fn()) return true; await tick(20); } return false; }
const PLACE_CSV = "RefDes,X,Y,Layer\nC1,10,20,TOP\n";
const WIDE = "Component ID,Height(%)1,Volume(%)1,Area(%)1,PAD ID,Result1,Height(%)2,Volume(%)2,Area(%)2,Result2\nC1_1,100,101,99,1,PASS,102,103,98,PASS\nC1_1,100,101,99,2,PASS,102,103,98,PASS\n";

/* 取出記錄庫對話框的原始標記 */
function pickerMarkup() {
  const a = SRC.indexOf('id="recPickerModal"'), b = SRC.indexOf("<!-- 全域資料與報告匯出中心");
  assert.ok(a > 0 && b > a, "找不到記錄庫標記");
  return SRC.slice(a, b);
}

test("記錄庫原始碼：單一捲動區，分頁內不設高度上限，沒有第二份手機標記", () => {
  const html = pickerMarkup();
  assert.doesNotMatch(html, /max-height\s*:\s*\d+vh/, "分頁內不得再寫 max-height:NNvh（會與外層形成雙重捲動並壓縮清單）");
  assert.doesNotMatch(html, /style="[^"]*overflow-y\s*:\s*(auto|scroll)/, "記錄庫標記內不得以行內樣式新增捲動區");
  assert.equal((html.match(/class="rec-scroll"/g) || []).length, 1, "只能有一個 .rec-scroll");
  assert.match(SRC, /\.rec-scroll\{[^}]*flex:1 1 auto;[^}]*min-height:0;[^}]*overflow-y:auto/, ".rec-scroll 必須吃滿剩餘高度並自行捲動");
  for (const cls of ["rec-head", "rec-toolbar", "rec-foot"]) assert.match(SRC, new RegExp(`\\.${cls}\\{[^}]*flex:none`), `.${cls} 不可被壓縮或捲動`);
  assert.doesNotMatch(SRC, /rec-desktop-view|rec-mobile-view|id="pairBoard"|id="cardsPick/, "桌面與手機共用同一份清單標記");
  // 清單一定排在捲動區的第一個分頁；登錄表單移入專用對話框
  const spiPane = html.slice(html.indexOf('id="boxPickSpi"'), html.indexOf('id="boxPickPlace"'));
  assert.doesNotMatch(spiPane, /<form|class="field"|id="boxUpload/, "量測分頁只放清單，不放表單");
  assert.match(SRC, /id="uploadRefModal"[^>]*\shidden/, "受控檔案登錄共用對話框預設關閉");
  assert.ok(SRC.includes('id="upPlaceFields"') && SRC.includes('id="upLayFields"'), "座標與板面圖檔欄位於共用對話框內分區存在");
  assert.doesNotMatch(html, /id="btnPick(Spi|Place|Layout|Specs|Import)"[^>]*\shidden/, "五大功能分頁按鈕皆不可隱藏");
});

test("記錄庫行為：預設是量測清單，新到舊，每列一顆主鈕，例外用帶筆數的篩選", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const cloud = await createCloudHarness();
  const place = await cloud.upload({ kind: "place", part: "LAY-1", rev: "V1", side: "TOP", unit: "mm", name: "lay.csv" }, PLACE_CSV);
  await cloud.upload({ kind: "place", part: "LAY-2", rev: "V1", side: "TOP", unit: "mm", name: "lay2.csv" }, PLACE_CSV + "C2,1,2,TOP\n");
  const raw = Buffer.from(WIDE);
  const legacy = await cloud.repo.createRecord({ id: "legacylayoutrecord0001", kind: "spi", user: "old@example.test", created: Date.now() - 86400000, bytes: raw.length,
    sha256: createHash("sha256").update(raw).digest("hex"), part: "LAY-1", lot: "LOT-OLD", side: "TOP", name: "old.csv", vendor: "lirong" }, gzipSync(raw));
  assert.ok(legacy.record);
  await cloud.upload({ kind: "spi", part: "LAY-1", rev: "V1", side: "TOP", placeId: place.id, workOrder: "WO-1", lot: "LOT-NEW", name: "new.csv", vendor: "lirong" }, WIDE);

  const errs = [];
  const dom = new JSDOM(SRC.replace(/<script src=[^>]+><\/script>/g, ""), { runScripts: "dangerously", url: "https://example.test/", beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
    Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { let e = this; while (e) { if (e.hidden) return null; e = e.parentElement; } return w.document.body; } });
    w.Element.prototype.scrollIntoView = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {} }); w.ResizeObserver = class { observe() {} }; w.scrollTo = () => {}; w.scrollBy = () => {};
    w.Chart = class { constructor() {} destroy() {} static register() {} };
    Object.assign(w, { Response, DecompressionStream });
    withIdb(w);
    installBrowserCloud(w, cloud);
    w.SPI_TEST_HOOK = { bootSample: true };
    w.addEventListener("error", e => errs.push(e.message));
  } });
  const w = dom.window, d = w.document, $ = s => d.querySelector(s);
  await w.SPI_TEST_HOOK.RecDB.ready;

  $("#btnOpenRecModal").click();
  assert.ok(await until(() => d.querySelectorAll("#tblPickSpi tr[data-row-id]").length === 2), "量測清單應渲染 2 筆");
  assert.equal($("#boxPickSpi").hidden, false, "預設分頁是量測清單");
  assert.equal($("#btnPickSpi").getAttribute("aria-selected"), "true");
  assert.equal($("#recPickerScroll").firstElementChild.nextElementSibling, $("#boxPickSpi"), "捲動區內清單前面只有登入提示");
  assert.equal($("#recPickerAuthNotice").hidden, true);

  const rows = [...d.querySelectorAll("#tblPickSpi tr[data-row-id]")];
  assert.match(rows[0].textContent, /LOT-NEW/, "最新的量測排第一，不被未成對的舊資料擠到後面");
  assert.ok(rows[0].querySelector('.rec-acts>[data-pact="load"]'), "第一列不捲動就能按載入分析");
  for (const tbl of ["#tblPickSpi", "#tblPickPlace"]) for (const tr of d.querySelectorAll(`${tbl} tr[data-row-id]`)) {
    const outside = [...tr.querySelectorAll("button")].filter(b => !b.closest(".rec-menu") && !b.classList.contains("linkbtn"));
    assert.ok(outside.length <= 1, `${tbl} 每列在「⋯」選單外最多一顆按鈕，實得 ${outside.map(b => b.textContent).join("、")}`);
    assert.equal(tr.querySelectorAll("details.rec-menu").length, 1, "每列一個「⋯」選單");
  }

  // 例外筆數與 measurementLink 的判定一致
  const list = w.SPI_TEST_HOOK.RecDB.cache;
  const unlinked = list.filter(r => r.kind === "spi" && !r.placeId).length;
  assert.equal(unlinked, 1);
  assert.match($('#recQuickFilters [data-link="unlinked"]').textContent, new RegExp(`尚未搭配座標 ${unlinked}$`));
  assert.equal($('#recQuickFilters [data-link="missing"]'), null, "筆數為 0 的篩選不顯示");

  // 座標檔分頁：登錄改為獨立對話框（不常駐清單上方），按下才開啟；量測分頁的對應篩選不帶過來
  $('#recQuickFilters [data-link="unlinked"]').click();
  assert.ok(await until(() => d.querySelectorAll("#tblPickSpi tr[data-row-id]").length === 1));
  $("#btnPickPlace").click();
  assert.ok(await until(() => d.querySelectorAll("#tblPickPlace tr[data-row-id]").length === 2), "換到座標檔分頁不沿用量測的對應篩選");
  assert.equal($("#recPlaceAdminBar").hidden, false, "管理者看得到登錄按鈕");
  assert.equal($("#uploadRefModal").hidden, true, "受控檔案登錄對話框預設關閉");
  $("#btnShowPlaceForm").click();
  assert.equal($("#uploadRefModal").hidden, false);
  $("#uploadRefClose").click();
  assert.match($('#recQuickFilters [data-link="unused"]').textContent, /無量測引用 1$/);

  // 「尚未搭配」量測的選單可直接帶料號開啟座標登錄對話框
  $("#btnPickSpi").click();
  assert.ok(await until(() => d.querySelectorAll("#tblPickSpi tr[data-row-id]").length === 2));
  const up = [...d.querySelectorAll("#tblPickSpi tr[data-row-id]")].find(tr => /LOT-OLD/.test(tr.textContent)).querySelector(".rec-menu [data-pair-upload]");
  assert.ok(up, "尚未搭配的量測可從選單登錄座標檔");
  up.click();
  assert.ok(await until(() => !$("#boxPickPlace").hidden && !$("#uploadRefModal").hidden && $("#upPlacePart").value === "LAY-1"), "切到座標檔分頁、開啟座標登錄對話框並帶入料號");
  $("#uploadRefClose").click();

  assert.deepEqual(errs, []);
  cloud.close();
});

test("記錄庫升級契約：五大分頁、檔名重新命名、批次刪除預檢與語意對話框（左確認右取消）", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const cloud = await createCloudHarness();
  const place = await cloud.upload({ kind: "place", part: "UX-1", rev: "V1", side: "TOP", unit: "mm", name: "ux1.csv" }, PLACE_CSV);
  const placeUnused = await cloud.upload({ kind: "place", part: "UX-2", rev: "V1", side: "TOP", unit: "mm", name: "ux2.csv" }, PLACE_CSV + "C2,1,2,TOP\n");
  const spi1 = await cloud.upload({ kind: "spi", part: "UX-1", rev: "V1", side: "TOP", placeId: place.id, workOrder: "WO-A", lot: "LOT-A", name: "a.csv", vendor: "lirong" }, WIDE);
  const gbr = "%FSLAX36Y36*%\n%MOMM*%\n%TF.FileFunction,Paste,Top*%\n%ADD10C,0.5*%\nD10*\nX1000000Y1000000D03*\nM02*\n";
  const layout = await cloud.upload({ kind: "layout", part: "UX-1", rev: "V1", side: "TOP", layer: "paste", name: "top.gtp" }, gbr);

  const errs = [];
  const dom = new JSDOM(SRC.replace(/<script src=[^>]+><\/script>/g, ""), { runScripts: "dangerously", url: "https://example.test/", beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
    Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { let e = this; while (e) { if (e.hidden) return null; e = e.parentElement; } return w.document.body; } });
    w.Element.prototype.scrollIntoView = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {} }); w.ResizeObserver = class { observe() {} }; w.scrollTo = () => {}; w.scrollBy = () => {};
    w.Chart = class { constructor() {} destroy() {} static register() {} };
    Object.assign(w, { Response, DecompressionStream });
    withIdb(w);
    installBrowserCloud(w, cloud);
    w.SPI_TEST_HOOK = { bootSample: true };
    w.addEventListener("error", e => errs.push(e.message));
  } });
  const w = dom.window, d = w.document, $ = s => d.querySelector(s);
  await w.SPI_TEST_HOOK.RecDB.ready;

  // 1. 驗證共用對話框頁尾按鈕順序為左確認、右取消
  for (const [okId, cancelId] of [
    ["#btnSubmitRef", "#uploadRefCancel"],
    ["#recEditSave", "#recEditCancel"],
    ["#confirmOk", "#confirmCancel"],
    ["#recAdjSave", "#recAdjCancel"],
  ]) {
    const okBtn = $(okId), cancelBtn = $(cancelId);
    assert.ok(okBtn && cancelBtn, `${okId} 與 ${cancelId} 應存在`);
    assert.ok(okBtn.compareDocumentPosition(cancelBtn) & 4, `${okId}（確認）應位於 ${cancelId}（取消）左側`);
  }

  // 2. 開啟記錄庫並切換至板面圖檔與匯入分頁
  $("#btnOpenRecModal").click();
  assert.ok(await until(() => d.querySelectorAll("#tblPickSpi tr[data-row-id]").length === 1), "量測分頁應顯示 1 筆");
  assert.equal($("#countPickLayout").textContent, "1", "板面圖檔分頁應顯示 1 筆");

  // 點擊 .rec-main 開啟檔案詳情檢視面板
  $("#tblPickSpi tr[data-row-id] .rec-main").click();
  assert.ok(await until(() => !$("#recDetailModal").hidden), "點擊主資訊欄應開啟檔案詳情檢視");
  assert.match($("#recDetailBody").textContent, new RegExp(spi1.sha256), "詳情應顯示完整 64 碼 SHA-256");
  $("#recDetailClose").click();

  // 板面圖檔分頁與匯入分頁切換
  $("#btnPickLayout").click();
  assert.ok(await until(() => !$("#boxPickLayout").hidden && d.querySelectorAll("#tblPickLayout tr[data-row-id]").length === 1), "板面圖檔分頁應列出 Gerber");
  assert.equal(layout.id, $("#tblPickLayout tr[data-row-id]").dataset.rowId);

  $("#btnPickImport").click();
  assert.ok(await until(() => !$("#boxPickImport").hidden && $("#recToolbarSearchGroup").hidden), "切到匯入分頁時隱藏列表搜尋列");
  $("#btnPickPlace").click();
  assert.ok(await until(() => !$("#boxPickPlace").hidden && d.querySelectorAll("#tblPickPlace tr[data-row-id]").length === 2), "切回座標分頁應列出 2 筆");

  // 3. 管理者快速重新命名（保留原始 SHA-256）
  const renameBtn = $(`#tblPickPlace tr[data-row-id="${placeUnused.id}"] [data-pact="rename"]`);
  assert.ok(renameBtn, "管理者應有重新命名動作");
  renameBtn.click();
  assert.ok(await until(() => !$("#recEditModal").hidden), "應開啟重新命名對話框");
  $("#recEditName").value = "ux2_renamed.txt";
  $("#recEditName").dispatchEvent(new w.Event("input"));
  assert.equal($("#recEditExtWarn").hidden, false, "更改副檔名應顯示提醒");
  $("#recEditSave").click();
  assert.ok(await until(() => $("#recEditModal").hidden && $("#tblPickPlace").textContent.includes("ux2_renamed.txt")), "應完成重命名並刷新清單");

  // 4. 管理者批次選取＋受引用安全預檢略過＋批次刪除
  $("#btnRecBatchSelectAll").click();
  assert.equal($("#recBatchBar").hidden, false, "勾選後應顯示批次動作列");
  assert.equal($("#recBatchDelNum").textContent, "2", "應選取 2 筆座標檔");
  $("#btnRecBatchDelete").click();
  assert.ok(await until(() => !$("#confirmModal").hidden), "應開啟批次刪除安全檢查對話框");
  assert.equal($("#confirmWarnBox").hidden, false, "被量測引用的座標應觸發警告");
  assert.equal($("#confirmExcludeRisk").hidden, false, "應顯示一鍵略過受引用項目按鈕");
  $("#confirmExcludeRisk").click();
  assert.match($("#confirmOk").textContent, /\(1\)/, "略過受引用項後應剩 1 筆可刪");
  $("#confirmOk").click();
  assert.ok(await until(() => $("#confirmModal").hidden && d.querySelectorAll("#tblPickPlace tr[data-row-id]").length === 1), "批次刪除未引用座標後應剩 1 筆受引用座標");
  assert.equal($("#recBatchBar").hidden, true, "刪除完成後批次列自動隱藏");

  // 5. 封存確認對話框（不使用 window.confirm）
  w.confirm = () => { throw new Error("檔案管理操作不應再呼叫 window.confirm"); };
  w.prompt = () => { throw new Error("檔案管理操作不應再呼叫 window.prompt"); };
  $(`#tblPickPlace tr[data-row-id="${place.id}"] [data-pact="archive-place"]`).click();
  assert.ok(await until(() => !$("#confirmModal").hidden), "封存應開啟語意確認對話框");
  $("#confirmOk").click();
  assert.ok(await until(() => $("#confirmModal").hidden && /已封存/.test($("#tblPickPlace").textContent)), "封存應成功更新清單狀態");

  assert.deepEqual(errs, []);
  cloud.close();
});
