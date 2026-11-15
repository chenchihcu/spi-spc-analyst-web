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
      w.SPI_TEST_HOOK = { bootSample: true };
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
  // 嚴重度篩選鈕上的數字＝點下去顯示的數量：依問題定義數案、依統計規則數卡
  const chipCheck = (sel) => {
    for (const lv of ["ng", "warn", "info", "all"]) {
      const chip = d.querySelector(`#issFilter [data-lv="${lv}"]`);
      const n = Number(chip.textContent.match(/\d+/)[0]);
      chip.click();
      assert.equal(d.querySelectorAll(sel).length, n, `${chip.textContent} 點下去應顯示 ${n} 項（${sel}）`);
    }
  };
  assert.match($("#issHead").textContent, /^\d+ 個問題定義：嚴重 \d+、警示 \d+、資訊 \d+（\d+ 項統計發現）$/);
  const headN = $("#issHead").textContent.match(/\d+/g).map(Number);
  assert.equal(headN[1] + headN[2] + headN[3], headN[0], "案檢視嚴重度加總等於問題定義數");
  chipCheck("#issList .iss-case");
  const rulesBtn = d.querySelector('#issFilter [data-group="rules"]');
  assert.ok(rulesBtn, "應有依統計規則切換");
  rulesBtn.click();
  assert.ok(d.querySelectorAll("#issList .sevhead").length >= 2, "統計規則檢視應依嚴重度分段");
  assert.match($("#issHead").textContent, /^\d+ 項統計發現：嚴重 \d+、警示 \d+、資訊 \d+（\d+ 個問題定義）$/);
  chipCheck("#issList .iss-card");
  // 問題卡片預設收合成一行，可全部展開／收合
  assert.equal(d.querySelectorAll("#issList details.iss-card[open]").length, 0, "問題卡片預設收合");
  assert.ok(d.querySelectorAll("#issList details.iss-card > summary .iss-sum-t b").length === d.querySelectorAll(".iss-card").length, "每張卡片的摘要列有標題");
  $("#issExpand").click();
  assert.equal(d.querySelectorAll("#issList details.iss-card:not([open])").length, 0, "全部展開");
  $("#issCollapse").click();
  assert.equal(d.querySelectorAll("#issList details.iss-card[open]").length, 0, "全部收合");
  // 頂端不再重複規格輸入；資料與規格頁分為 3 個子分頁（鋼板規格、錫膏印刷規格、回合管理），匯入資料收斂至記錄庫對話框 (#boxPickImport)
  assert.equal(d.querySelector("#inLsl"), null, "規格輸入只保留在資料與規格頁");
  assert.deepEqual([...d.querySelectorAll("#p-data .subtab")].map((b) => b.textContent.trim()), ["鋼板規格設定", "錫膏印刷規格設定", "回合管理"]);
  // 子分頁鍵盤：只有選取中的在 Tab 順序，左右鍵切換
  assert.deepEqual([...d.querySelectorAll("#p-data .subtab")].map((b) => b.tabIndex), [0, -1, -1]);
  const subKey = (key) => d.querySelector("#p-data .subtabs").dispatchEvent(new w.KeyboardEvent("keydown", { key, bubbles: true }));
  subKey("ArrowRight");
  assert.equal(d.querySelector('#p-data .subtab[data-sub="paste-spec"]').getAttribute("aria-selected"), "true", "右鍵切到錫膏印刷規格設定");
  subKey("ArrowRight");
  assert.equal(d.querySelector('#p-data .subtab[data-sub="runs"]').getAttribute("aria-selected"), "true", "再按右鍵切到回合管理");
  subKey("ArrowRight");
  assert.equal(d.querySelector('#p-data .subtab[data-sub="stencil-spec"]').getAttribute("aria-selected"), "true", "最後一項按右鍵回到鋼板規格設定");
  subKey("End");
  assert.equal(d.querySelector('#p-data .subtab[data-sub="runs"]').getAttribute("aria-selected"), "true", "End 切到最後一項");
  assert.equal(d.querySelector('#p-data div[data-sub="import"]'), null, "匯入資料已整併進記錄庫對話框");
  assert.ok(d.querySelector("#recPickerModal #boxPickImport"), "記錄庫應包含 #boxPickImport");
  // 欄位歸屬：鋼板頁只含鋼板欄位，錫膏印刷頁只含印刷參數與規格
  const stencilPane = d.querySelector('#p-data div[data-sub="stencil-spec"]'), pastePane = d.querySelector('#p-data div[data-sub="paste-spec"]');
  for (const id of ["inStencil2", "stencilNote", "chkStep", "zoneTbl", "zoneMap", "apTbl", "geomPadFile"]) {
    assert.ok(stencilPane.querySelector("#" + id), `#${id} 應在鋼板規格設定`);
    assert.equal(pastePane.querySelector("#" + id), null, `#${id} 不應在錫膏印刷規格設定`);
  }
  for (const id of ["selSqDir", "inWipe2", "partSpecBar", "btnSpecSave", "btnSpecDiscard", "btnSpecVers", "specTbl", "specGrpBox"]) {
    assert.ok(pastePane.querySelector("#" + id), `#${id} 應在錫膏印刷規格設定`);
    assert.equal(stencilPane.querySelector("#" + id), null, `#${id} 不應在鋼板規格設定`);
  }
  assert.equal(d.querySelector('#p-data div[data-sub="settings"]'), null, "不再留合併的規格面板");
  const wrap = d.querySelector(".wrap");
  for (const id of ["p-overview", "p-control", "p-capability", "p-sim3d", "p-deep", "p-improve", "p-ai", "p-report", "p-gate", "p-data", "p-share", "p-shares", "p-mail"]) {
    assert.equal(d.getElementById(id).parentElement, wrap, `#${id} 應在 .wrap 內`);
  }
  assert.equal(d.querySelector("nav.mtab").parentElement, d.body, "底部導覽留在 .wrap 外");
  assert.equal(d.querySelector("#exportCenterModal").parentElement, d.body, "匯出對話框留在 .wrap 外");
  const runsPane = d.querySelector('#p-data div[data-sub="runs"]');
  assert.equal(runsPane.parentElement, d.getElementById("p-data"), "回合管理與規格並列");
  assert.equal(runsPane.parentElement, d.querySelector('#p-data div[data-sub="paste-spec"]').parentElement);
  assert.equal(runsPane.parentElement, d.querySelector('#p-data div[data-sub="stencil-spec"]').parentElement);
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
  assert.equal(w.SPI_TEST_HOOK.S.sub, "paste-spec", "舊別名 specs 應對應錫膏印刷規格設定");
  w.SPI_TEST_HOOK.setSub("settings");
  assert.equal(w.SPI_TEST_HOOK.S.sub, "paste-spec", "舊別名 settings 應對應錫膏印刷規格設定");
  w.SPI_TEST_HOOK.setSub("stencil");
  assert.equal(w.SPI_TEST_HOOK.S.sub, "stencil-spec", "舊別名 stencil 應對應鋼板規格設定");
  assert.equal(d.querySelector('#p-data div[data-sub="stencil-spec"]').hidden, false, "鋼板頁應顯示");
  // 捷徑落點：鋼板／規格 → 鋼板頁聚焦厚度；擦拭連結 → 錫膏印刷頁聚焦擦拭；錫膏頁「修改鋼板厚度」→ 鋼板頁
  tab("issues"); $("#railSpecBtn").click();
  assert.equal(w.SPI_TEST_HOOK.S.sub, "stencil-spec", "鋼板／規格捷徑應開鋼板規格設定");
  assert.equal(d.activeElement, $("#inStencil2"), "鋼板／規格捷徑應聚焦厚度");
  w.SPI_TEST_HOOK.setSub("paste-spec");
  assert.match($("#pasteStencilRef").textContent, new RegExp(`鋼板厚度 ${w.SPI_TEST_HOOK.S.stencil} µm`), "錫膏印刷頁應顯示目前鋼板厚度");
  assert.equal(d.querySelector('#p-data div[data-sub="paste-spec"] input#inStencil2'), null, "錫膏印刷頁不可直接改厚度");
  $("#btnGoStencilThk").click();
  assert.equal(w.SPI_TEST_HOOK.S.sub, "stencil-spec", "修改鋼板厚度連結應開鋼板規格設定");
  assert.equal(d.activeElement, $("#inStencil2"));
  if ($("#btnGoWipeSpec")) { $("#btnGoWipeSpec").click(); assert.equal(w.SPI_TEST_HOOK.S.sub, "paste-spec", "擦拭連結應開錫膏印刷規格設定"); assert.equal(d.activeElement, $("#inWipe2")); }
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

  // 記錄庫匯入資料分頁：匯入步驟拆為流程卡＋5張獨立卡片（無巢狀卡）、跨卡事件委派及空狀態呈現
  w.SPI_TEST_HOOK.setSub("import");
  const impSub = d.getElementById("boxPickImport");
  assert.ok(impSub && !impSub.hidden, "setSub('import') 應開啟記錄庫「匯入資料」分頁 #boxPickImport");
  assert.ok(impSub.querySelector(".imp-flow-card"), "應有頂部匯入流程總覽卡");
  for (const cid of ["impStep1Card", "impStep2Card", "impStep3Card", "impStep4Card", "impStep5Card"]) {
    const card = d.getElementById(cid);
    assert.ok(card && card.classList.contains("card") && impSub.contains(card), `#${cid} 應為獨立步驟卡片`);
    assert.equal(card.parentElement.closest(".card"), null, `#${cid} 不可巢狀包在另一張 .card 內`);
  }
  $("#btnPhme").click();
  assert.equal($("#mapBox").hidden, false, "讀取資料後應展開步驟 ③～⑤ 的 #mapBox");
  $("#inPart").value = "PART-X-01";
  $("#inPart").dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.match($("#impSourceSummary").textContent, /PART-X-01/, "跨卡片修改 #inPart 應透過 #boxPickImport 委派更新來源摘要");
  d.getElementById("recPickerClose").click();
  tab("data");
  w.SPI_TEST_HOOK.setSub("runs");
  while (hook.S.runs.length) d.querySelector("#runTbl [data-delrun]").click();
  assert.ok(d.querySelector("#runTbl tbody .empty-row .empty-cell"), "無回合時 #runTbl 應呈現空狀態列");
  w.SPI_TEST_HOOK.setSub("stencil-spec");
  assert.ok(d.querySelector("#apTbl tbody .empty-row .empty-cell"), "無量測資料時 #apTbl 應呈現空狀態列");
  $("#btnSample").click();
  assert.equal(d.querySelector("#runTbl tbody .empty-row"), null, "載入範例後應顯示正常回合列");

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
    w.Chart = class { constructor() {} destroy() {} static register() {} }; withIdb(w); installBrowserCloud(w, cloud); w.SPI_TEST_HOOK = { bootSample: true }; } });
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
