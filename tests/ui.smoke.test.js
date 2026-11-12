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
      w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
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
  assert.equal($("#pmapDetails").open, false, "首頁問題地圖預設收合");
  assert.ok(d.querySelectorAll("#issList .iss-case").length >= 1, "首頁直接顯示問題定義分組");
  assert.ok(d.querySelectorAll("#issList .iss-card").length > 0, "首頁預設應列出統計問題卡");
  assert.equal(d.querySelectorAll("#issList details.iss-card[open]").length, 0, "問題卡片預設收合");
  assert.ok($("#railSheet .rail-states #stateSpi"), "量測狀態應在分析設定列右側／行動設定面板內");
  assert.ok($("#railSheet .rail-states #statePlace"), "座標狀態應在分析設定列右側／行動設定面板內");
  assert.equal(d.querySelector("header.top #stateSpi"), null, "頂欄不再重複擺放量測狀態膠囊");
  const catSel = $("#selIssCat");
  assert.ok(catSel, "面向篩選應為單一精簡下拉選單");
  const firstCat = [...catSel.options].find((o) => o.value !== "all");
  if (firstCat) {
    change(catSel, firstCat.value);
    assert.equal(w.SPI_TEST_HOOK.S.issCat, firstCat.value);
    change($("#selIssCat"), "all");
  }
  $("#pmapDetails").open = true;
  assert.match($("#pmap").textContent, /這批沒有座標/);
  assert.equal($("#pmap svg"), null);
  assert.ok($("#pmap [data-part]"));
  $("#pmap [data-part]").click();
  assert.ok($(".part-map-detail"));
  assert.equal(d.querySelectorAll(".iss-card").length, 0, "點零件只開短卡");
  $("#pmapClear").click();
  $("#pmapDetails").open = false;

  // 以「抓出問題」為目的的介面要素：問題地圖、證據迷你圖、嚴重度分段、來源提示
  assert.ok(d.querySelectorAll(".iss-card svg.ev").length === d.querySelectorAll(".iss-card").length, "每個問題卡片都應有證據迷你圖");
  assert.ok(d.querySelectorAll("#issList .iss-case").length >= 1, "預設應依問題定義分組");
  const rulesBtn = d.querySelector('#issFilter [data-group="rules"]');
  assert.ok(rulesBtn, "應有依統計規則切換");
  rulesBtn.click();
  assert.ok(d.querySelectorAll("#issList .sevhead").length >= 2, "統計規則檢視應依嚴重度分段");
  // 問題卡片預設收合成一行，可全部展開／收合
  assert.equal(d.querySelectorAll("#issList details.iss-card[open]").length, 0, "問題卡片預設收合");
  assert.ok(d.querySelectorAll("#issList details.iss-card > summary .iss-sum-t b").length === d.querySelectorAll(".iss-card").length, "每張卡片的摘要列有標題");
  $("#issExpand").click();
  assert.equal(d.querySelectorAll("#issList details.iss-card:not([open])").length, 0, "全部展開");
  $("#issCollapse").click();
  assert.equal(d.querySelectorAll("#issList details.iss-card[open]").length, 0, "全部收合");
  // 頂端不再重複規格輸入；資料與規格頁分為 3 個子分頁（匯入、規格、回合管理）
  assert.equal(d.querySelector("#inLsl"), null, "規格輸入只保留在資料與規格頁");
  assert.equal(d.querySelectorAll("#p-data .subtab").length, 3);
  // 子分頁鍵盤：只有選取中的在 Tab 順序，左右鍵切換
  assert.deepEqual([...d.querySelectorAll("#p-data .subtab")].map((b) => b.tabIndex), [0, -1, -1]);
  d.querySelector("#p-data .subtabs").dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(d.querySelector('#p-data .subtab[data-sub="settings"]').textContent.trim(), "規格");
  assert.equal(d.querySelector('#p-data .subtab[data-sub="settings"]').getAttribute("aria-selected"), "true", "右鍵切到規格");
  d.querySelector("#p-data .subtabs").dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(d.querySelector('#p-data .subtab[data-sub="runs"]').getAttribute("aria-selected"), "true", "再按右鍵切到回合管理");
  const wrap = d.querySelector(".wrap");
  for (const id of ["p-overview", "p-control", "p-capability", "p-sim3d", "p-deep", "p-improve", "p-ai", "p-report", "p-gate", "p-data", "p-share", "p-shares", "p-mail"]) {
    assert.equal(d.getElementById(id).parentElement, wrap, `#${id} 應在 .wrap 內`);
  }
  assert.equal(d.querySelector("nav.mtab").parentElement, d.body, "底部導覽留在 .wrap 外");
  assert.equal(d.querySelector("#exportCenterModal").parentElement, d.body, "匯出對話框留在 .wrap 外");
  const runsPane = d.querySelector('#p-data div[data-sub="runs"]');
  assert.equal(runsPane.parentElement, d.getElementById("p-data"), "回合管理與規格並列");
  assert.equal(runsPane.parentElement, d.querySelector('#p-data div[data-sub="settings"]').parentElement);
  assert.equal(d.querySelector("#pmap").parentElement.id, "pmapDetails", "問題地圖不再套一層卡");
  assert.equal(d.querySelector('#p-control [data-control-sub="multi"] .grid2'), null, "多變量區不留空 grid");
  tab("data");
  assert.ok(d.querySelector("#runTbl").offsetParent, "資料頁的回合表應可見");
  d.querySelector("#p-data .subtabs").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  // 驗證新整合的 UI/UX 入口與轉跳（記錄庫膠囊群組、子視圖切換器、AI 精簡狀態列、分析報告匯出整合）
  assert.ok(d.querySelector("header.top .db-capsule-group #btnOpenRecModal"), "頂欄應有整合的記錄庫膠囊群組");
  assert.equal(d.querySelector(".rail #railTimeWrap"), null, "分析設定列不應含時段篩選");
  assert.equal(d.querySelector(".rail #inTimeStart"), null, "分析設定列不應含時段輸入");
  assert.ok(d.querySelector("#btnOpenExportModal"), "匯出應以匯出中心為單一入口");
  assert.ok(d.querySelector("#btnRepPdf"), "分析報告頁保留 PDF 匯出");
  assert.ok(d.querySelector('#p-ai #aiCompactBar #btnGoAiCfg'), "AI 診斷頁頂部應有精簡狀態列與設定轉跳鈕");
  tab("ai");
  d.querySelector("#btnGoAiCfg").click();
  assert.equal(d.querySelector("#appSettingsModal").hidden, false, "AI 設定轉跳應開啟介面與 AI 設定對話框");
  // .db-modal 預設 display:none，只有 .open 才顯示；只清 hidden 時按鈕看似無反應
  assert.ok(d.querySelector("#appSettingsModal").classList.contains("open"), "AI 設定對話框應加上 .open 才會實際顯示");
  assert.ok(d.querySelector("#appSettingsModal #aiSettingsCard"), "AI 詳細設定卡應在設定對話框");
  assert.ok(d.querySelector("#appSettingsModal #btnThemeSettings"), "主題切換應在設定對話框");
  d.querySelector("#appSettingsClose").click();
  assert.equal(d.querySelector("#appSettingsModal").hidden, true, "關閉後設定對話框應隱藏");
  assert.ok(!d.querySelector("#appSettingsModal").classList.contains("open"), "關閉後應移除 .open");
  w.SPI_TEST_HOOK.setSub("specs", "spec");
  assert.equal(w.SPI_TEST_HOOK.S.sub, "settings", "舊別名 specs 應對應規格子分頁");
  w.SPI_TEST_HOOK.setTab("deep/cross");
  assert.equal($("[data-tab=issues]").getAttribute("aria-selected"), "true", "#deep/cross 應開問題偵測");
  assert.equal(w.SPI_TEST_HOOK.S.issuesSub, "cross", "#deep/cross 應開交叉驗證");
  w.SPI_TEST_HOOK.setTab("deep/adv");
  assert.equal($("[data-tab=deep]").getAttribute("aria-selected"), "true", "#deep/adv 應開製程跡象");
  assert.equal(d.querySelector(".rail #selChart"), null, "分析設定列不應含管制圖種類");
  // 換回合後，先前展開的問題不會自動展開
  d.querySelector("#iss-1 > summary").click();
  assert.equal(d.querySelector("#iss-1").open, true);
  change($("#selRun"), "2"); tab("issues");
  assert.equal(d.querySelectorAll("#issList details.iss-card[open]").length, 0, "換回合後全部收合");
  change($("#selRun"), "1"); tab("issues");
  const hook = w.SPI_TEST_HOOK;
  assert.equal(hook.S.pmapSelection.mode, "all");
  const before = hook.issuesCsv(hook.S.F);
  const batch = $("#pmap [data-mode=batch]");
  assert.ok(!batch.disabled);
  batch.click();
  const related = hook.issueList();
  assert.ok(related.length > 0);
  const filteredIds = new Set(related.map(card => "iss-" + card.id));
  assert.ok([...d.querySelectorAll("#issList .iss-card")].every(card => filteredIds.has(card.id)));
  assert.equal(hook.issuesCsv(hook.S.F), before);
  $("#pmapClear").click();
  assert.equal(hook.issueList().length, hook.S.F.length);
  const crossGo = [...d.querySelectorAll("#issList [data-go]")].find((b) => hook.S.F.some((x) => x.id === +b.dataset.go && x.go && x.go.tab === "cross"));
  assert.ok(crossGo, "範例資料應有導向交叉驗證的問題卡");
  crossGo.click();
  assert.equal(hook.S.issuesSub, "cross", "交叉驗證證據應在交叉驗證子頁");
  assert.equal($("#ctxBar").hidden, false, "前往交叉驗證證據時應顯示來源提示");
  $("#ctxBack").click();
  assert.equal($("[data-tab=issues]").getAttribute("aria-selected"), "true", "返回鍵應回到問題清單");
  assert.equal(hook.S.issuesSub, "list", "返回鍵應回到問題清單子頁");
  assert.equal($("#selMetric").closest(".field").hidden, true, "問題偵測頁不顯示不相干的量測項目選單");

  for (const t of ["issues", "overview", "control", "capability", "sim3d", "deep", "improve", "ai", "data", "report"]) tab(t);
  for (const v of ["xbars", "imr", "p", "ewma", "cusum"]) { change($("#selChart"), v); tab("control"); }
  tab("improve"); d.querySelector('[data-subnav-improve="lab"]').click();
  $("#btnAoiSample").click(); $("#btnGrrSample").click(); $("#btnDoeSample").click();
  tab("data"); $("#btnPhme").click(); $("#btnApply").click();
  tab("improve"); d.querySelector('[data-subnav-improve="compare"]').click();
  d.querySelector('[data-subnav-improve="dfm"]').click();
  $("#btnSample").click();
  hook.S.relChart = "quad";
  change($("#selMetric"), $("#selMetric").value);
  assert.equal(hook.S.relChart, "specScatter", "已移除的關係圖種應回到規格散點");
  assert.equal($("#selRelChart").value, "specScatter");
  tab("deep");
  for (const rk of ["parallel", "radar", "specScatter"]) {
    change($("#selRelChart"), rk);
    assert.equal(hook.S.relChart, rk);
  }

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
  $("#btnPickPlace").click();
  for (let i = 0; i < 150 && !$("#tblPickPlace [data-pact='use-place']"); i++) await new Promise(r => setTimeout(r, 20));
  assert.ok($("#tblPickPlace [data-pact='use-place']"), "有效受控座標應可選取");
  await w.SPI_TEST_HOOK.RecDB.get(w.SPI_TEST_HOOK.RecDB.cache.find(r => r.kind === 'place'));
  $("#tblPickPlace [data-pact='use-place']").click();
  for (let i = 0; i < 100 && w.SPI_TEST_HOOK.getPlace()?.part !== "Psvg onload=1"; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(w.SPI_TEST_HOOK.getPlace()?.part, "Psvg onload=1", `座標選取失敗：${JSON.stringify({toast:$("#toast")?.textContent,notice:$("#recPickerNotice").textContent,place:$("#placeState")?.textContent})}`);
  $("[data-tab=data]").click(); $("#selSide").value = "TOP"; $("#pasteIn").value = csv; $("#btnRead").click(); $("#inRunName").value = "<img src=z onerror=1>";
  $("#inLot").value = "L1<img src=q onerror=1>"; $("#inPart").value = "P<svg onload=1>";
  $("#inRev").value = "V1"; $("#inWorkOrder").value = "WO-XSS"; $("#inImpStencil").value = "120";
  $("#btnApply").click();
  for (let i = 0; i < 100 && w.eval("S.runs.length") < 3; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.eval("S.runs.length"), 3, `存入資料庫後建立回合：${JSON.stringify({mode:w.SPI_TEST_HOOK.RecDB.mode,place:$("#placeState").textContent,note:$("#recNote").textContent,parse:$("#parseErr").textContent,map:$("#mapPrev").textContent.slice(0,200)})}`);
  $("#btnOpenRecModal").click();
  for (let i = 0; i < 100 && !/L1/.test($("#tblPickSpi").textContent); i++) await new Promise((r) => setTimeout(r, 50));
  assert.match($("#tblPickSpi").textContent, /L1/);
  for (const t of ["issues", "overview", "control", "capability", "sim3d", "deep", "improve", "data"]) $(`[data-tab=${t}]`).click();
  assert.equal(d.querySelectorAll("img[onerror],svg[onload]").length, 0, "不應出現注入的 img／svg");
  assert.equal([...d.querySelectorAll("b")].filter((b) => b.textContent === "x").length, 0, "不應出現注入的 <b>");
});
