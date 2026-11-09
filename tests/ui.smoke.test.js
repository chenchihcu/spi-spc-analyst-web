// 介面冒煙測試：在 jsdom 中開啟頁面，走過所有頁籤與主要流程，確認沒有執行錯誤
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { HTML, withIdb } = require("./_load");

let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); } catch { /* 未安裝 jsdom 時略過 */ }

test("所有頁籤與主要流程無執行錯誤", { skip: !JSDOM && "未安裝 jsdom（npm install）" }, async () => {
  const html = fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");
  const errs = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errs.push(e.message));
  const dom = new JSDOM(html, {
    runScripts: "dangerously", virtualConsole: vc, url: "https://example.test/",
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
      Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { let e = this; while (e) { if (e.hidden) return null; e = e.parentElement; } return w.document.body; } });
      w.Element.prototype.scrollIntoView = () => {};
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} };
      w.scrollTo = () => {};
      w.Chart = class { constructor(_c, cfg) { if (!cfg || !cfg.data) throw new Error("圖表設定錯誤"); } destroy() {} static register() {} };
      w.claude = { use: async (n) => (n === "downloads" ? { save: async () => {} } : null) };
      withIdb(w);
      w.SPI_TEST_HOOK = {};
    },
  });
  const w = dom.window, d = w.document, $ = (s) => d.querySelector(s);
  const tab = (t) => $(`[data-tab=${t}]`).click();
  const change = (el, v) => { el.value = v; el.dispatchEvent(new w.Event("change")); };
  await new Promise((r) => setTimeout(r, 50));

  assert.match($("#appVer").textContent, /^v\d+\.\d+\.\d+$/, "主頁需顯示語意化版本");
  assert.match($("#appBuilt").textContent, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, "主頁需顯示到秒的更新時間");
  assert.equal(d.compatMode, "CSS1Compat", "頁面需處於標準模式而非 Quirks 模式 (D-01)");
  assert.equal(d.doctype?.name, "html", "需有 <!DOCTYPE html> (D-01)");
  assert.equal(d.documentElement.lang, "zh-Hant-TW", "html 需指定 lang=zh-Hant-TW (D-01)");
  assert.equal(d.characterSet, "UTF-8", "文件字元編碼需為 UTF-8 (D-01)");
  const vp = d.querySelector('meta[name="viewport"]');
  assert.ok(vp && vp.content.includes("width=device-width") && vp.content.includes("viewport-fit=cover"), "需含正確的 viewport meta (D-01)");
  assert.ok(d.querySelectorAll(".iss-card").length > 0, "首頁應列出問題");

  // 以「抓出問題」為目的的介面要素：問題地圖、證據迷你圖、嚴重度分段、來源提示
  assert.ok(d.querySelectorAll("#pmap [data-ent]").length >= 25, "問題地圖應有每片板的格子");
  assert.ok(d.querySelectorAll(".iss-card svg.ev").length === d.querySelectorAll(".iss-card").length, "每個問題卡片都應有證據迷你圖");
  assert.ok(d.querySelectorAll("#issList .sevhead").length >= 2, "問題應依嚴重度分段");
  // 問題卡片預設收合成一行，可全部展開／收合
  assert.equal(d.querySelectorAll("#issList details.iss-card[open]").length, 0, "問題卡片預設收合");
  assert.ok(d.querySelectorAll("#issList details.iss-card > summary .iss-sum-t b").length === d.querySelectorAll(".iss-card").length, "每張卡片的摘要列有標題");
  $("#issExpand").click();
  assert.equal(d.querySelectorAll("#issList details.iss-card:not([open])").length, 0, "全部展開");
  $("#issCollapse").click();
  assert.equal(d.querySelectorAll("#issList details.iss-card[open]").length, 0, "全部收合");
  // 頂端不再重複規格輸入；資料與規格頁分為 6 個子分頁（匯入資料、規格設定、回合管理、鋼板與開孔、資料庫、AI 設定）
  assert.equal(d.querySelector("#inLsl"), null, "規格輸入只保留在資料與規格頁");
  assert.equal(d.querySelectorAll("#p-data .subtab").length, 6);
  // 子分頁鍵盤：只有選取中的在 Tab 順序，左右鍵切換
  assert.deepEqual([...d.querySelectorAll("#p-data .subtab")].map((b) => b.tabIndex), [0, -1, -1, -1, -1, -1]);
  d.querySelector("#p-data .subtabs").dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(d.querySelector('#p-data .subtab[data-sub="specs"]').getAttribute("aria-selected"), "true", "右鍵切到規格設定");
  d.querySelector("#p-data .subtabs").dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(d.querySelector('#p-data .subtab[data-sub="runs"]').getAttribute("aria-selected"), "true", "再按右鍵切到回合管理");
  d.querySelector("#p-data .subtabs").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  // 驗證新整合的 UI/UX 入口與轉跳（記錄庫膠囊群組、全域時段篩選、子視圖切換器、AI 精簡狀態列、分析報告匯出整合）
  assert.ok(d.querySelector("header.top .db-capsule-group #btnOpenRecModal"), "頂欄應有整合的記錄庫膠囊群組");
  assert.ok(d.querySelector(".rail #railTimeWrap #inTimeStart"), "時段篩選應整合於全域分析設定列 .rail");
  assert.ok(d.querySelector('#p-report #btnExpMd') && d.querySelector('#p-report #btnExpBoard') && d.querySelector('#p-report #btnExpDef'), "匯出按鈕應整合於分析報告頁");
  assert.ok(d.querySelector('#p-ai #aiCompactBar #btnGoAiCfg'), "AI 分析頁頂部應有單行精簡狀態列與設定轉跳鈕");
  assert.ok(d.querySelector('#p-data [data-sub="ai-cfg"] #aiSettingsCard'), "AI 詳細設定卡應收折於資料與規格頁的 AI 設定子分頁");
  // 換回合後，先前展開的問題不會自動展開
  d.querySelector("#iss-1 > summary").click();
  assert.equal(d.querySelector("#iss-1").open, true);
  change($("#selRun"), "2"); tab("issues");
  assert.equal(d.querySelectorAll("#issList details.iss-card[open]").length, 0, "換回合後全部收合");
  change($("#selRun"), "1"); tab("issues");
  d.querySelector('#pmap [data-ent="b:B13"]').click();
  const hook = w.SPI_TEST_HOOK;
  const relatedIssues = hook.issueList();
  const boardOrder = [...new Set(hook.S.rows.map(r => r.board))];
  const concernsBoard = issue => issue.ents.some(ent => ent === "b:B13"
    || (ent.startsWith("drift:") && boardOrder.indexOf("B13") >= boardOrder.indexOf(ent.slice(6))));
  assert.ok(relatedIssues.length >= 1, "選板後仍應有與 B13 相關的問題");
  assert.ok(relatedIssues.every(concernsBoard), "選板後問題清單的每張卡都應涵蓋 B13");
  const filteredIds = new Set(relatedIssues.map(issue => `iss-${issue.id}`));
  assert.ok([...d.querySelectorAll("#issList .iss-card")].every(card => filteredIds.has(card.id)), "畫面不得顯示未通過 B13 關聯篩選的問題卡");
  d.querySelector("#pmapClear").click();
  d.querySelector("#issList [data-go]").click();
  assert.equal($("#ctxBar").hidden, false, "前往證據頁時應顯示來源提示");
  $("#ctxBack").click();
  assert.equal($("[data-tab=issues]").getAttribute("aria-selected"), "true", "返回鍵應回到問題清單");
  assert.equal($("#selMetric").closest(".field").hidden, true, "問題偵測頁不顯示不相干的量測項目選單");

  for (const t of ["issues", "overview", "compare", "dfm", "control", "capability", "sim3d", "cross", "adv", "lab", "ai", "data"]) tab(t);
  for (const v of ["xbars", "imr", "p", "ewma", "cusum"]) { change($("#selChart"), v); tab("control"); }
  tab("lab"); $("#btnAoiSample").click(); $("#btnGrrSample").click(); $("#btnDoeSample").click();
  tab("data"); $("#btnPhme").click(); $("#btnApply").click();
  tab("compare"); tab("dfm");
  $("#btnSample").click();

  assert.deepEqual(errs, []);
});

test("匯入資料中的 HTML 不會被執行（XSS）", { skip: !JSDOM && "未安裝 jsdom（npm install）" }, async () => {
  const { createCloudHarness, installBrowserCloud } = await import('./_cloud-harness.mjs');
  const cloud = await createCloudHarness();
  await cloud.upload({ kind: 'place', part: 'Psvg onload=1', rev: 'V1', side: 'TOP', unit: 'mm', name: 'controlled.csv' }, 'RefDes,X,Y,Layer\nU1,1,2,TOP\n');
  const html = fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://example.test/", beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
    Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { let e = this; while (e) { if (e.hidden) return null; e = e.parentElement; } return w.document.body; } });
    w.Element.prototype.scrollIntoView = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {} }); w.ResizeObserver = class { observe() {} }; w.scrollTo = () => {}; w.scrollBy = () => {};
    w.Chart = class { constructor() {} destroy() {} static register() {} }; withIdb(w); installBrowserCloud(w, cloud); w.SPI_TEST_HOOK = {}; } });
  const w = dom.window, d = w.document, $ = (s) => d.querySelector(s);
  await new Promise((r) => setTimeout(r, 50));
  const csv = "Board,Pad,Component,Result,Volume,Height(um),Area\n" + Array.from({ length: 60 }, (_, i) => `"B${Math.floor(i / 6) + 1}<img src=x onerror=1>",P${i % 6}<b>x</b>,U1,"NG<img src=y>",${i === 13 ? 40 : 100 + (i % 5)},120,${i === 13 ? 40 : 100}`).join("\n");
  $("#btnSelectPlace").click();
  for (let i = 0; i < 100 && !$("#tblPickPlace [data-pact='use-place']"); i++) await new Promise(r => setTimeout(r, 20));
  assert.ok($("#tblPickPlace [data-pact='use-place']"), "有效受控座標應可選取");
  await w.SPI_TEST_HOOK.RecDB.get(w.SPI_TEST_HOOK.RecDB.cache.find(r => r.kind === 'place'));
  $("#tblPickPlace [data-pact='use-place']").click();
  for (let i = 0; i < 100 && $("#placePart").value !== 'Psvg onload=1'; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal($("#placePart").value, 'Psvg onload=1', `座標選取失敗：${JSON.stringify({toast:$("#toast")?.textContent,notice:$("#recPickerNotice").textContent})}`);
  $("[data-tab=data]").click(); $("#selSide").value = "TOP"; $("#pasteIn").value = csv; $("#btnRead").click(); $("#inRunName").value = "<img src=z onerror=1>";
  $("#inLot").value = "L1<img src=q onerror=1>"; $("#inPart").value = "P<svg onload=1>";
  $("#inRev").value = "V1"; $("#inWorkOrder").value = "WO-XSS"; $("#inImpStencil").value = "120";
  $("#btnApply").click();
  for (let i = 0; i < 100 && w.eval("S.runs.length") < 3; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.eval("S.runs.length"), 3, `存入資料庫後建立回合：${JSON.stringify({mode:w.SPI_TEST_HOOK.RecDB.mode,place:$("#placeState").textContent,note:$("#recNote").textContent,parse:$("#parseErr").textContent,map:$("#mapPrev").textContent.slice(0,200)})}`);
  $("[data-tab=data]").click(); $('.subtab[data-sub="records"]').click(); $('.subtab[data-sub="runs"]').click(); $('.subtab[data-sub="records"]').click();
  for (let i = 0; i < 100 && !/L1/.test($("#recSpi").textContent); i++) await new Promise((r) => setTimeout(r, 50));
  assert.match($("#recSpi").textContent, /L1/);
  for (const t of ["issues", "overview", "compare", "dfm", "control", "capability", "sim3d", "cross", "adv", "lab", "data"]) $(`[data-tab=${t}]`).click();
  assert.equal(d.querySelectorAll("img[onerror],svg[onload]").length, 0, "不應出現注入的 img／svg");
  assert.equal([...d.querySelectorAll("b")].filter((b) => b.textContent === "x").length, 0, "不應出現注入的 <b>");
});
