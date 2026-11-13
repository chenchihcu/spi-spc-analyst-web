// 離線版：打包產物不引用外部資源；SPI_OFFLINE 下匯入只在記憶體分析、規格只套用到本回合，不呼叫 RecDB.create。
// 沒有旗標的網站版仍維持「正式新匯入必須連線並登入」（AGENTS.md：RecDB.create fail-closed）。
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOffline } from "../tools/build-offline.mjs";

const require = createRequire(import.meta.url);
const { JSDOM } = (() => { try { return require("jsdom"); } catch { return {}; } })();
const fs = require("fs");
const { HTML, withIdb } = require("./_load.js");
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, n = 250) { for (let i = 0; i < n; i++) { if (fn()) return true; await tick(20); } return false; }

test("離線打包：單一檔案、無外部腳本或 vendor 資源、含離線旗標與內嵌資料", async () => {
  const out = await mkdtemp(join(tmpdir(), "spi-offline-"));
  try {
    const { file, bytes } = await buildOffline({ out, now: new Date("2026-01-02T03:04:05Z") });
    const html = fs.readFileSync(file, "utf8");
    assert.ok(bytes < 15 * 1024 * 1024, "產物需小於 15 MB");
    assert.doesNotMatch(html, /<script[^>]*\ssrc=/, "不可有外部 <script src>");
    assert.doesNotMatch(html, /url\(vendor\//, "字型不可引用 vendor/");
    assert.doesNotMatch(html, /document\.write\('<script src="https:/, "不可保留 CDN 備援");
    assert.match(html, /<head>\r?\n<script>window\.SPI_OFFLINE=true<\/script>/, "離線旗標需在 head 最前面");
    assert.match(html, /window\.SPI_PDF_FONTS=\{reg:"[A-Za-z0-9+/=]{1000,}",bold:"/, "需內嵌 PDF 中文字型");
    assert.match(html, /window\.SPI_KB_RULES=\{/, "需內嵌製程規則");
    assert.match(html, /id="appBuilt">2026-01-02 11:04:05</, "更新時間依 UTC+8 注入");
  } finally { await rm(out, { recursive: true, force: true }); }
});

const CSV = "Board,Pad,Component,Volume,Height(um),Area\n" + Array.from({ length: 120 }, (_, i) => {
  const b = Math.floor(i / 12) + 1, p = i % 12, c = p < 6 ? "U1" : "U2", v = c === "U1" ? 100 + (i % 5) : 78 + (i % 5);
  return `B${b},P${p},${c},${v},${118 + (i % 4)},${100 + (i % 3)}`;
}).join("\n");

function page(offline) {
  const html = fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");
  const errs = [], creates = [];
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://example.test/", beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
    Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { let e = this; while (e) { if (e.hidden) return null; e = e.parentElement; } return w.document.body; } });
    w.Element.prototype.scrollIntoView = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {} }); w.ResizeObserver = class { observe() {} }; w.scrollTo = () => {}; w.scrollBy = () => {};
    w.Chart = class { constructor() {} destroy() {} static register() {} };
    w.fetch = async () => { throw new Error("離線測試不應連網"); };
    withIdb(w);
    if (offline) w.SPI_OFFLINE = true;
    w.SPI_TEST_HOOK = {};
    w.addEventListener("error", (e) => errs.push(e.message));
  } });
  return { dom, errs, creates };
}

async function importCsv(dom) {
  const w = dom.window, d = w.document, $ = (s) => d.querySelector(s);
  const inp = $("#fileIn");
  Object.defineProperty(inp, "files", { configurable: true, value: [new w.File([Buffer.from(CSV)], "line.csv")] });
  inp.dispatchEvent(new w.Event("change"));
  await until(() => !$("#mapBox").hidden || $("#parseErr").textContent);
  assert.equal($("#parseErr").textContent, "", "CSV 需可解析");
  $("#inPart").value = "P-OFF"; $("#inImpStencil").value = "120";
  if ($("#inSupplierWo")) $("#inSupplierWo").value = "SWO-1";
  if ($("#inOutsourceWo")) $("#inOutsourceWo").value = "OWO-2";
  $("#inPart").dispatchEvent(new w.Event("input", { bubbles: true }));
}

test("離線模式：匯入只在記憶體分析，規格套用到本回合後解鎖，不寫入資料庫", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { dom, errs } = page(true);
  const w = dom.window, d = w.document, $ = (s) => d.querySelector(s), H = w.SPI_TEST_HOOK;
  await tick(50);
  let created = 0;
  const orig = H.RecDB.create; H.RecDB.create = async (...a) => { created++; return orig.apply(H.RecDB, a); };
  assert.equal($("#offlineBanner").hidden, false, "離線版需顯示未存檔提示");
  await importCsv(dom);
  assert.match($("#recNote").textContent, /離線版/);
  $("#btnApply").click();
  assert.ok(await until(() => H.curRun()?.info?.src?.store === "offline"), "需建立離線回合");
  const run = H.curRun();
  assert.equal(run.rows.length, 120);
  assert.equal(run.info.src.part, "P-OFF");
  if ($("#inSupplierWo")) assert.equal(run.info.src.supplierWo, "SWO-1", "選填的廠商工單需保留");
  if ($("#inOutsourceWo")) assert.equal(run.info.src.outsourceWo, "OWO-2", "選填的外包工單需保留");
  assert.equal(H.S.specSrc, "none", "尚未定義規格時分析鎖定");
  assert.equal($("#btnSpecSave").textContent, "套用到本回合");
  $("#btnSpecSave").click();
  assert.ok(await until(() => H.S.specSrc === "part"), "套用規格後解鎖");
  assert.equal(H.S.partSpec.offline, true);
  assert.equal($("#specSaveModal").hidden, true, "離線不開存檔對話框");
  assert.equal(created, 0, "離線不可呼叫 RecDB.create");
  // 離線不得寫入瀏覽器 IndexedDB（回合與偵測快取）
  await tick(800);
  const names = (await w.indexedDB.databases()).map((x) => x.name);
  assert.ok(!names.includes("spi-spc"), "離線不可建立回合資料庫");
  assert.ok(!names.includes("spi-spc-cache"), "離線不可建立偵測快取");
  assert.match($("#runSaveNote")?.textContent || "離線版不保存", /離線版不保存/);
  assert.deepEqual(errs, []);
  w.close();
});

test("網站版（無離線旗標）未登入時仍拒絕正式新匯入", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { dom, errs } = page(false);
  const w = dom.window, d = w.document, $ = (s) => d.querySelector(s);
  await tick(50);
  assert.equal($("#offlineBanner").hidden, true);
  await importCsv(dom);
  $("#inRev").value = "A"; $("#inWorkOrder").value = "WO1"; $("#selSide").value = "TOP";
  const before = w.SPI_TEST_HOOK.S.runs.length;
  $("#btnApply").click();
  assert.ok(await until(() => $("#recNote .err")), "網站版需顯示阻擋原因");
  assert.doesNotMatch($("#recNote").textContent, /離線/);
  assert.equal(w.SPI_TEST_HOOK.S.runs.length, before, "網站版未登入不可建立新回合");
  assert.deepEqual(errs, []);
  w.close();
});
