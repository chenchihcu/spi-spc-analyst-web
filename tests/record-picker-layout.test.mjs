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
  // 清單一定排在捲動區的第一個分頁；登錄表單不在量測分頁
  const spiPane = html.slice(html.indexOf('id="boxPickSpi"'), html.indexOf('id="boxPickPlace"'));
  assert.doesNotMatch(spiPane, /<form|class="field"|id="boxUpload/, "量測分頁只放清單，不放表單");
  assert.match(html, /id="boxUploadPlaceForm"[^>]*\shidden/, "座標登錄表單預設收合");
  assert.match(html, /id="boxUploadLayoutForm"[^>]*\shidden/, "板面圖檔登錄表單預設收合");
  assert.doesNotMatch(html, /id="btnPick(Spi|Place|Specs)"[^>]*\shidden/, "分頁按鈕不可隱藏（入口會開到這些分頁）");
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

  // 座標檔分頁：登錄表單收合，按下才展開；量測分頁的對應篩選不帶過來
  $('#recQuickFilters [data-link="unlinked"]').click();
  assert.ok(await until(() => d.querySelectorAll("#tblPickSpi tr[data-row-id]").length === 1));
  $("#btnPickPlace").click();
  assert.ok(await until(() => d.querySelectorAll("#tblPickPlace tr[data-row-id]").length === 2), "換到座標檔分頁不沿用量測的對應篩選");
  assert.equal($("#recPlaceAdminBar").hidden, false, "管理者看得到登錄按鈕");
  assert.equal($("#boxUploadPlaceForm").hidden, true, "登錄表單預設收合");
  $("#btnShowPlaceForm").click();
  assert.equal($("#boxUploadPlaceForm").hidden, false);
  assert.equal($("#btnShowPlaceForm").getAttribute("aria-expanded"), "true");
  assert.match($('#recQuickFilters [data-link="unused"]').textContent, /無量測引用 1$/);

  // 「尚未搭配」量測的選單可直接帶料號去登錄座標檔
  $("#btnPickSpi").click();
  assert.ok(await until(() => d.querySelectorAll("#tblPickSpi tr[data-row-id]").length === 2));
  assert.equal($("#boxUploadPlaceForm").hidden, true, "離開座標檔分頁後表單不出現在量測清單上方");
  const up = [...d.querySelectorAll("#tblPickSpi tr[data-row-id]")].find(tr => /LOT-OLD/.test(tr.textContent)).querySelector(".rec-menu [data-pair-upload]");
  assert.ok(up, "尚未搭配的量測可從選單登錄座標檔");
  up.click();
  assert.ok(await until(() => !$("#boxPickPlace").hidden && !$("#boxUploadPlaceForm").hidden && $("#upPlacePart").value === "LAY-1"), "切到座標檔分頁、展開表單並帶入料號");

  assert.deepEqual(errs, []);
  cloud.close();
});
