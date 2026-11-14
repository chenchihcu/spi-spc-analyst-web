// 板面圖檔介面：登錄表單、匯入步驟 ① 查詢、開啟紀錄自動套用、問題地圖改畫焊墊、分享不帶幾何。規格：docs/spec-gerber-layout-rfc.md
// 同一個 jsdom 頁面跑完整個檔案（每開一頁約 2.5–5 秒）
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { JSDOM } = (() => { try { return require("jsdom"); } catch { return {}; } })();
const fs = require("fs");
const { HTML, withIdb } = require("./_load.js");
import { createCloudHarness, installBrowserCloud } from "./_cloud-harness.mjs";
const tick = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 300) { for (let i = 0; i < n; i++) { try { if (fn()) return true; } catch {} await tick(20); } return false; }

const PART = "LAY-UI", REV = "V1";
const FOOT = { R: [[-0.5, 0], [0.5, 0]], U: [-1.905, -0.635, 0.635, 1.905].flatMap(y => [[-2.7, y], [2.7, y]]) };
const PARTS = [];
for (let j = 0; j < 3; j++) for (let i = 0; i < 5; i++) PARTS.push({ ref: `${(i + j) % 2 ? "U" : "R"}${PARTS.length + 1}`, x: 8 + i * 9, y: 6 + j * 8 });
const kind = ref => ref[0];
const at = (x, y) => `X${Math.round(x * 1e6)}Y${Math.round(y * 1e6)}`;
const PLACE_CSV = "RefDes,X,Y,Layer\n" + PARTS.map(p => `${p.ref},${p.x},${p.y},TOP`).join("\n") + "\n";
// 錫膏層座標系與座標檔不同：整體平移 (20, 5) mm
const PASTE = "%FSLAX46Y46*%\n%MOMM*%\n%TF.FileFunction,Paste,Top*%\n%ADD10R,0.6X0.5*%\n%ADD11R,1.5X0.6*%\n" +
  PARTS.map(p => (kind(p.ref) === "R" ? "D10*\n" : "D11*\n") + FOOT[kind(p.ref)].map(([dx, dy]) => `${at(p.x + dx + 20, p.y + dy + 5)}D03*`).join("\n")).join("\n") + "\nM02*\n";
// 量測：U2 焊墊體積明顯偏低，使問題偵測有焊墊級發現
function spiCsv() {
  const lines = ["Board,RefDes,PadID,Volume,Height(um),Area"];
  for (let b = 1; b <= 6; b++) for (const p of PARTS) FOOT[kind(p.ref)].forEach((_, k) => {
    const low = p.ref === "U2" ? 45 : 0, v = 100 - low + ((p.x * 7 + k * 13 + b * 5) % 9) - 4;
    lines.push(`B${b},${p.ref},${k + 1},${v},${120 + (k % 3)},${98 + (k % 5)}`);
  });
  return lines.join("\n") + "\n";
}

let PAGE = null;
async function page() {
  if (PAGE) return PAGE;
  const cloud = await createCloudHarness();
  const html = fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");
  const errs = [];
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://example.test/", beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
    Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { let e = this; while (e) { if (e.hidden) return null; e = e.parentElement; } return w.document.body; } });
    w.Element.prototype.scrollIntoView = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {} }); w.ResizeObserver = class { observe() {} disconnect() {} }; w.scrollTo = () => {}; w.scrollBy = () => {};
    w.requestAnimationFrame = fn => setTimeout(fn, 0);
    w.Chart = class { constructor() {} destroy() {} update() {} static register() {} };
    Object.assign(w, { Response, DecompressionStream });
    withIdb(w);
    installBrowserCloud(w, cloud);
    w.SPI_TEST_HOOK = {};
    w.addEventListener("error", e => errs.push(e.message));
  } });
  const w = dom.window, hook = w.SPI_TEST_HOOK;
  assert.ok(await until(() => hook.RecDB && hook.RecDB.ready), "頁面初始化");
  await hook.RecDB.ready;
  // 資料：受控座標、料號規格、錫膏層、引用錫膏層的量測
  const place = await cloud.upload({ kind: "place", part: PART, rev: REV, side: "TOP", unit: "mm", name: "place.csv" }, PLACE_CSV);
  const body = w.eval(`(()=>{const sp={schema:"spi-part-spec/1",part:${JSON.stringify(PART)},stencilRef:120,specs:{},groups:{},note:"測試"};for(const k of PART_SPEC_METRICS)sp.specs[k]={...DEF_SPECS[k]};return partSpecEncode(sp).bytes})()`);
  await cloud.upload({ kind: "spec", part: PART, makeDefault: true }, body);
  const paste = await cloud.upload({ kind: "layout", part: PART, rev: REV, side: "TOP", layer: "paste", name: "top.gtp" }, PASTE);
  const spi = await cloud.upload({ kind: "spi", part: PART, rev: REV, side: "TOP", placeId: place.id, workOrder: "WO-1", lot: "L1", name: "m.csv", vendor: "generic", layoutIds: [paste.id] }, spiCsv());
  PAGE = { dom, w, hook, d: w.document, cloud, errs, place, paste, spi };
  return PAGE;
}

test("開啟引用板面圖檔的量測：自動套用、問題地圖改畫焊墊並顯示對應說明", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, hook, d, spi, errs } = await page();
  await hook.RecDB.list();
  const rec = (await hook.RecDB.list()).find(r => r.id === spi.id);
  assert.ok(rec, "量測紀錄應在清單中");
  assert.equal(rec.meta.layoutProof.length, 1);
  await hook.openRecord(rec, { autoApply: true });
  assert.ok(await until(() => hook.curRun() && hook.curRun().info.layout), "套用後回合應有板面圖檔結果");
  const L = hook.curRun().info.layout;
  assert.equal(L.source, "proof");
  assert.equal(L.level, "near");
  assert.deepEqual([L.tf.o, L.tf.tx, L.tf.ty], [0, 20, 5]);
  assert.equal(Object.keys(L.matched).length, PARTS.length);
  assert.ok(hook.pmapLayout(), "地圖應使用板面圖檔");
  hook.setTab("issues");
  assert.ok(await until(() => w.eval("S.F&&!S.F.pending") && d.querySelector("#pmap .pmap-canvas")), "問題地圖應改畫 canvas");
  assert.equal(d.querySelector("#pmap svg"), null, "有板面圖檔時不畫元件中心圖");
  const status = [...d.querySelectorAll("#pmap p.note[role=status]")].map(p => p.textContent).join(" ");
  assert.match(status, /錫膏層 · 依零件標示；無法對應到單一焊墊 · 15 顆零件對上；已平移 20, 5 mm/);
  assert.equal(d.querySelectorAll("#pmap .pmap-zoom button").length, 3);
  for (const b of d.querySelectorAll("#pmap .pmap-zoom button")) b.click();
  // 以零件清單選取零件：沿用既有選取流程
  const btn = [...d.querySelectorAll("#pmap .part-map-list button")].find(b => b.textContent.includes("U2"));
  assert.ok(btn, "零件清單應有 U2");
  btn.click();
  assert.ok(await until(() => d.querySelector("#pmap .part-map-detail h4")?.textContent.includes("U2")), "選取後顯示零件明細");
  assert.ok(d.querySelector("#pmap .pmap-canvas"), "選取後仍為焊墊圖");
  assert.deepEqual(errs, []);
});

test("鋼板檔開孔：開啟紀錄後寫入回合設定，面積比表標示來源與套用數（v10.31.0）", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, hook, d } = await page();
  assert.ok(await until(() => w.eval("S.aperture&&S.aperture.file&&Object.keys(S.aperture.file).length") === 15), "15 顆零件開孔尺寸一致，應全部套用");
  assert.ok(hook.curRun().cfg.aperture.file, "回合設定應保存鋼板檔開孔");
  hook.setTab("data"); hook.setSub("settings");
  assert.ok(await until(() => /鋼板檔開孔已套用 15 顆零件/.test(d.querySelector("#apNote")?.textContent || "")), d.querySelector("#apNote")?.textContent);
  assert.ok([...d.querySelectorAll("#apTbl td .note")].some(n => n.textContent === "鋼板檔"), "實際開孔欄應標示來源「鋼板檔」");
  hook.setTab("issues");
});

test("分享連結不帶板面圖檔幾何", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { hook } = await page();
  assert.ok(hook.curRun().info.layout);
  const pack = JSON.stringify(hook.sharePack());
  assert.ok(!pack.includes('"layout"'), "分享內容不得含 layout");
  assert.ok(!pack.includes('"file"'), "分享內容不得含鋼板檔開孔");
  assert.ok(hook.curRun().info.layout, "分享不改動目前回合");
});

test("匯入步驟 ①：選受控座標與面別後顯示已登錄圖層；新上傳引用這些圖檔", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, hook, d, place, paste } = await page();
  hook.setTab("data"); hook.setSub("import");
  d.querySelector("#selSide").value = "TOP";
  d.querySelector("#selSide").dispatchEvent(new w.Event("change"));
  hook.setPlace({ recId: place.id, part: PART, rev: REV, name: "place.csv", tab: w.eval("csvTable")(PLACE_CSV), side: "TOP", unit: "mm" });
  assert.ok(await until(() => d.querySelector("#layoutState").textContent === "已登錄：錫膏層"), "應顯示已登錄的圖層");
  assert.equal(d.querySelector("#layoutRow").hidden, false);
  assert.deepEqual([...hook.layoutIdsFor(PART, REV, "TOP")], [paste.id]);
  assert.deepEqual([...hook.layoutIdsFor(PART, REV, "BOT")], []);
  d.querySelector("#selSide").value = "BOT";
  d.querySelector("#selSide").dispatchEvent(new w.Event("change"));
  assert.ok(await until(() => d.querySelector("#layoutState").textContent === "未登錄板面圖檔"), "BOT 面沒有登錄");
});

test("紀錄庫登錄表單：管理者可見；解析並預選圖層與面別後存入，清單可刪除", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, hook, d } = await page();
  d.querySelector("#btnOpenRecModal").click();
  d.querySelector("#btnPickPlace").click();
  assert.ok(await until(() => !d.querySelector("#boxPickPlace").hidden && !d.querySelector("#boxUploadLayoutForm").hidden), "管理者應看到登錄表單");
  d.querySelector("#upLayPart").value = PART;
  d.querySelector("#upLayRev").value = REV;
  const bot = PASTE.replace("Paste,Top", "Paste,Bot");
  const file = new w.File([bot], "bottom.gbp");
  Object.defineProperty(d.querySelector("#upLayFile"), "files", { value: [file], configurable: true });
  d.querySelector("#upLayFile").dispatchEvent(new w.Event("change"));
  assert.ok(await until(() => d.querySelector("#upLayLayer").value === "paste" && d.querySelector("#upLaySide").value === "BOT"), "應依檔案預選");
  assert.match(d.querySelector("#upLayInfo").textContent, /個焊墊，範圍 .* mm，單位 mm/);
  d.querySelector("#btnSubmitLayout").click();
  assert.ok(await until(() => /已存入板面圖檔/.test(d.querySelector("#upLayState").textContent)), d.querySelector("#upLayState").textContent);
  assert.ok(await until(() => d.querySelectorAll("#upLayList [data-del-layout]").length === 2), "清單應列出兩份");
  // 錯誤：缺欄位、非 Gerber 檔
  const bad = new w.File(["RefDes,X,Y\nR1,1,2\n"], "x.gbr");
  Object.defineProperty(d.querySelector("#upLayFile"), "files", { value: [bad], configurable: true });
  d.querySelector("#upLayFile").dispatchEvent(new w.Event("change"));
  assert.ok(await until(() => /不是 Gerber 檔/.test(d.querySelector("#upLayState").textContent)), "非 Gerber 應說明");
  // 刪除剛存入的 BOT 檔
  w.confirm = () => true;
  const del = [...d.querySelectorAll("#upLayList [data-del-layout]")].find(b => /BOT/.test(b.getAttribute("aria-label")));
  del.click();
  assert.ok(await until(() => d.querySelectorAll("#upLayList [data-del-layout]").length === 1), "刪除後剩一份");
});
