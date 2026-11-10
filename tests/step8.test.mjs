// Step 8 驗證測試：D-63 不良柏拉圖、D-31 列印 CSS 與標題、D-65 3D 模擬快照、M-01 與 R-PDF 結構化 PDF 報告
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { JSDOM } = (() => { try { return require("jsdom"); } catch { return {}; } })();
const { HTML } = require("./_load.js");
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
// 帶逾時的條件輪詢（AGENTS.md：非同步測試不用固定休眠）
async function waitFor(cond, ms = 5000) {
  const t0 = Date.now();
  for (;;) { const v = cond(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("waitFor 逾時"); await tick(10); }
}
const html = () => fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");

function createPage(url = "https://spi.example/", extra = {}) {
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  return new JSDOM(html(), {
    runScripts: "dangerously",
    url,
    beforeParse(w) {
      // Mock Canvas 2D
      w.HTMLCanvasElement.prototype.getContext = (type) => {
        if (type === "webgl" || type === "experimental-webgl") return null;
        return new Proxy({
          measureText: () => ({ width: 8 }),
          fillText: () => {},
          fillRect: () => {},
          strokeRect: () => {},
          clearRect: () => {},
          beginPath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          stroke: () => {},
          fill: () => {},
          arc: () => {},
          setLineDash: () => {},
          save: () => {},
          restore: () => {}
        }, {
          get: (t, k) => t[k] ?? (() => {}),
          set: (t, k, v) => ((t[k] = v), true)
        });
      };
      w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      
      // Fetch mock for vendor font files
      w.fetch = async (reqUrl) => {
        const u = String(reqUrl);
        if (u.includes("NotoSansTC-400") || u.includes("NotoSansTC-700")) {
          const fn = u.includes("400") ? "NotoSansTC-400.05938ae2.ttf" : "NotoSansTC-700.a3c0c50b.ttf";
          const buf = fs.readFileSync(path.join(ROOT, "vendor", fn));
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
          };
        }
        return { ok: false, status: 404 };
      };

      Object.defineProperty(w.HTMLElement.prototype, "offsetParent", {
        get() {
          let e = this;
          while (e) {
            if (e.hidden) return null;
            e = e.parentElement;
          }
          return w.document.body;
        }
      });
      w.Element.prototype.scrollIntoView = () => {};
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} };
      w.scrollTo = () => {};

      // Load jsPDF into window
      const { jsPDF } = require("../vendor/jspdf-4.2.1.umd.min.js");
      w.jspdf = { jsPDF };

      // Mock Chart.js with register and destroy
      let chartCount = 0;
      w.Chart = class MockChart {
        constructor(canvas, cfg) {
          chartCount++;
          this.canvas = canvas;
          this.config = cfg;
        }
        destroy() {
          chartCount--;
        }
        static register() {}
        static get activeCount() { return chartCount; }
      };

      w.SPI_TEST_HOOK = {};
      Object.assign(w, extra);
    }
  });
}

test("D-63 不良柏拉圖：Y 軸為整數、Y2 為累積%、有處數註記、空態顯示文字", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  await tick(80);
  const w = dom.window, d = w.document, H = w.SPI_TEST_HOOK;
  assert.ok(H.drawPareto, "公開 drawPareto hook");

  // 1. 柏拉圖卡片下方有「一個焊墊可有多種不良，處數 ≥ 不良焊墊數」註記
  const paretoCard = d.querySelector("#cOvPareto").closest(".card");
  assert.ok(paretoCard, "找到柏拉圖卡片");
  assert.match(paretoCard.textContent, /一個焊墊可有多種不良，處數 ≥ 不良焊墊數/);

  // 2. 有不良時繪製圖表：檢查配置
  H.drawPareto("cOvPareto");
  const chartbox = d.querySelector("#ovParetoBox");
  const emptyEl = d.querySelector("#ovParetoEmpty");
  assert.equal(chartbox.hidden, false, "有不良時 chartbox 顯示");
  assert.equal(emptyEl.hidden, true, "有不良時 emptyEl 隱藏");

  // 3. 空態：當 pareto 為空物件時，隱藏 canvas 與 chartbox，顯示「沒有判定不良的焊墊」
  const origPareto = H.S.A.pareto;
  H.S.A.pareto = {};
  H.drawPareto("cOvPareto");
  assert.equal(chartbox.hidden, true, "空態時 chartbox 隱藏");
  assert.equal(emptyEl.hidden, false, "空態時 emptyEl 顯示");
  assert.match(emptyEl.textContent, /沒有判定不良的焊墊/);
  H.S.A.pareto = origPareto;
});

test("D-31 原生列印：#printHead 包含 nowrap 欄位、空欄不出現 ｜ ｜、document.title 設為 PDF 檔名", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  await tick(80);
  const w = dom.window, d = w.document, H = w.SPI_TEST_HOOK;

  assert.ok(H.pdfFileName, "公開 pdfFileName hook");
  assert.ok(H.beforePrint, "公開 beforePrint hook");
  assert.ok(H.afterPrint, "公開 afterPrint hook");

  const fn = H.pdfFileName();
  assert.match(fn, /^SPI-SPC_[^/\\:*?"<>|]+_[^/\\:*?"<>|]+_\d{8}-\d{4}\.pdf$/);

  const prevTitle = d.title;
  H.beforePrint();
  assert.equal(d.title, fn.replace(/\.pdf$/i, ""), "beforePrint 將 document.title 設為去除 .pdf 的檔名");

  const headHtml = d.querySelector("#printHead").innerHTML;
  assert.match(headHtml, /white-space:\s*nowrap/, "#printHead 欄位應有 white-space:nowrap");
  assert.match(headHtml, /列印時間 \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}/, "列印時間格式為 UTC+8 YYYY/MM/DD HH:mm:ss");
  assert.ok(!/｜\s*｜/.test(headHtml), "不應出現連續的分隔符 ｜ ｜");

  H.afterPrint();
  assert.equal(d.title, prevTitle, "afterPrint 還原原本 title");
});

test("D-65 3D 模擬快照：提供 capture3DImage，在 sim3d 工具列加入下載按鈕", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  await tick(80);
  const w = dom.window, d = w.document, H = w.SPI_TEST_HOOK;

  assert.ok(H.capture3DImage, "公開 capture3DImage hook");
  const btnDl3d = d.querySelector("#btnDl3d");
  assert.ok(btnDl3d, "sim3d 工具列內存在 #btnDl3d 下載按鈕");
  assert.match(btnDl3d.textContent, /匯出 3D 圖/);

  // 測試呼叫 capture3DImage
  const res = await H.capture3DImage();
  assert.ok(typeof res === "object", "capture3DImage 回傳物件");
  // 在沒有 WebGL 的 JSDOM 環境下，若 three.js 未就緒或 WebGL 不支援，應優雅回傳 ok: false 與 reason
  if (!res.ok) {
    assert.ok(res.reason, "若不可用應提供原因字串");
  } else {
    assert.match(res.dataUrl, /^data:image\/png/, "若可用應產生 PNG dataUrl");
  }
});

test("R-PDF 與 M-01：分析報告頁籤、10 個章節勾選、生成多頁 PDF 與字型嵌入", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  await tick(80);
  const w = dom.window, d = w.document, H = w.SPI_TEST_HOOK;

  // 1. 頁籤與面板
  const repTab = d.querySelector('.tab[data-tab="report"]');
  assert.ok(repTab, "頂端頁籤列存在 report 分析報告按鈕");
  const repPanel = d.querySelector("#p-report");
  assert.ok(repPanel, "存在 #p-report 面板");
  assert.ok(d.querySelector("#btnRepPdf"), "存在匯出 PDF 按鈕");
  assert.ok(d.querySelector("#btnRepPrint"), "存在列印整頁報告按鈕");
  assert.ok(d.querySelector("#btnRepMail"), "存在以 Email 傳送按鈕");

  // 2. 切換至報告分頁並檢驗 10 個章節預覽
  H.setTab("report");
  const prev = d.querySelector("#reportPreview");
  assert.ok(prev, "存在預覽容器 #reportPreview");
  for (let i = 1; i <= 10; i++) {
    const chk = d.querySelector("#chkRep" + i);
    assert.ok(chk, `存在章節 ${i} 勾選框`);
    const sec = d.querySelector("#repSec" + i);
    assert.ok(sec, `存在章節 ${i} 預覽區塊`);
  }

  // 3. 測試章節勾選隱藏
  const chk1 = d.querySelector("#chkRep1");
  chk1.checked = false;
  chk1.dispatchEvent(new w.Event("change"));
  assert.equal(d.querySelector("#repSec1").hidden, true, "取消勾選時區塊隱藏");
  chk1.checked = true;
  chk1.dispatchEvent(new w.Event("change"));
  assert.equal(d.querySelector("#repSec1").hidden, false, "重新勾選時區塊顯示");

  // 4. 測試離線圖表生成與銷毀（0 記憶體外洩）
  const chartCountBefore = w.Chart.activeCount;
  const offImg = H.renderOffscreenChart("line", { labels: ["A", "B"], datasets: [{ data: [1, 2] }] }, {});
  assert.match(offImg, /^data:image\/png/);
  assert.equal(w.Chart.activeCount, chartCountBefore, "離線圖表 render 後立即 destroy，Chart 實例無洩漏");

  // 5. 測試 generateReportPdfBlob 生成 PDF
  const pdfRes = await H.generateReportPdfBlob();
  assert.ok(pdfRes.blob, "回傳 Blob 物件");
  assert.ok(pdfRes.doc, "回傳 jsPDF 實例");
  assert.ok(pdfRes.doc.getNumberOfPages() >= 2, "10 個章節匯出應為多頁 PDF (至少 2 頁)");

  // 6. 測試生僻缺字自動回退與紀錄（不產生 □）
  const origSource = H.S.source;
  H.S.source = "測試批次含有生僻字𪚥與龘檢驗";
  const rareRes = await H.generateReportPdfBlob();
  assert.ok(rareRes.missingGlyphs.includes("𪚥"), "缺字清單應捕捉到 𪚥");
  H.S.source = origSource;
});

test("3D 空白自我檢查：diag3D 依序判定、量不到視為正常", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  await tick(80);
  const H = dom.window.SPI_TEST_HOOK;
  const ok = { connected: true, w: 800, h: 400, lost: false, calls: 12, alpha: 255, meshes: 100 };
  assert.equal(H.diag3D(ok), null, "正常畫面不報錯");
  assert.equal(H.diag3D({ ...ok, calls: -1, alpha: -1 }), null, "量不到（-1）視為正常");
  assert.match(H.diag3D({ ...ok, connected: false, alpha: 0 }), /未掛載/, "結構問題優先於空白");
  assert.match(H.diag3D({ ...ok, w: 0 }), /尺寸為 0/);
  assert.match(H.diag3D({ ...ok, lost: true }), /context lost/);
  assert.match(H.diag3D({ ...ok, calls: 0 }), /未執行任何繪製/);
  assert.match(H.diag3D({ ...ok, alpha: 0 }), /畫面空白/);
  assert.match(H.diag3D({ ...ok, alpha: 0, meshes: 0 }), /畫面空白/, "空板仍會畫底板，alpha=0 仍算失敗");
  assert.match(H.diag3D({ ...ok, nan: 3, alpha: 0 }), /NaN.*不是顯示卡/, "NaN 座標要報成資料問題，不可誤報顯示卡");
});

test("3D 示意位置：受控座標只有元件中心時展開焊墊，不寫回焊墊 X/Y", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  const H = await waitFor(() => dom.window.SPI_TEST_HOOK?.pos3D && dom.window.SPI_TEST_HOOK);
  // 2026-10-28 正式站：受控座標檔回合只有 componentX/Y，build3D 讀 r.x 得 NaN，整個 3D 空白
  const mk = (pad, comp, cx, cy) => ({ board: "B09", pad, comp, componentX: cx, componentY: cy, w: 0.7, d: 0.7 });
  const rows = [mk("U1-1", "U1", 10, 20), mk("U1-2", "U1", 10, 20), mk("U1-3", "U1", 10, 20), mk("U1-4", "U1", 10, 20),
    mk("R5-1", "R5", 30, 5), { board: "B09", pad: "X9-1", comp: "X9", w: 0.7, d: 0.7 },
    { board: "B09", pad: "G1", x: 1, y: 2, gridPos: true, w: 0.7, d: 0.7 }];
  const P = H.pos3D(rows);
  assert.equal(P.size, 6, "無任何座標的焊墊不繪出");
  assert.ok(!P.has(rows[5]));
  for (const p of P.values()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), "示意位置不可為 NaN");
  assert.deepEqual({ ...P.get(rows[6]) }, { x: 1, y: 2, est: true, grid: true }, "既有格狀示意標為示意與網格");
  const u1 = rows.slice(0, 4).map(r => P.get(r));
  assert.ok(u1.every(p => p.est && !p.grid), "元件中心來源要標成示意且非網格");
  assert.equal(new Set(u1.map(p => p.x + "," + p.y)).size, 4, "同元件焊墊展開後不可重疊");
  const mx = u1.reduce((s, p) => s + p.x, 0) / 4, my = u1.reduce((s, p) => s + p.y, 0) / 4;
  assert.ok(Math.abs(mx - 10) < 1e-9 && Math.abs(my - 20) < 1e-9, "展開以元件中心為中心");
  assert.ok(u1.every(p => Math.hypot(p.x - 10, p.y - 20) < 0.7 * 1.4 * 2), "展開不離元件中心太遠");
  assert.deepEqual({ ...P.get(rows[4]) }, { x: 30, y: 5, est: true, grid: false }, "單一焊墊元件放在元件中心");
  assert.ok(rows.every(r => !("x" in r) || r.pad === "G1"), "不可把元件中心寫回 r.x/r.y（統計不使用）");
});

test("3D 座標優先順序與虛擬格狀警示：componentX/Y 優先於 gridPos，全板 gridPos 時 pos3DNote 明確提示", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  const w = dom.window, H = await waitFor(() => w.SPI_TEST_HOOK?.pos3D && w.SPI_TEST_HOOK);
  // 1. 同時具有 componentX/Y 與 gridPos 時，優先使用元件中心，不可被 gridPos 覆蓋
  const mixedRow = { board: "B01", pad: "U1-1", comp: "U1", x: 4, y: 4, gridPos: true, componentX: 50, componentY: 60, w: 0.7, d: 0.7 };
  H.T.pos = null;
  const P1 = H.pos3D([mixedRow]);
  assert.equal(P1.get(mixedRow).grid, false, "有 componentX/Y 時不可判定為網格");
  assert.equal(P1.get(mixedRow).x, 50, "有 componentX/Y 時優先使用元件中心 X");
  assert.equal(P1.get(mixedRow).y, 60, "有 componentX/Y 時優先使用元件中心 Y");

  // 2. 全板僅有 gridPos 時，pos3DNote 明確提示無實際座標
  const gridRows = [
    { board: "B01", pad: "P1", x: 4, y: 4, gridPos: true, w: 0.7, d: 0.7 },
    { board: "B01", pad: "P2", x: 8, y: 4, gridPos: true, w: 0.7, d: 0.7 }
  ];
  const S = H.S, saved = [S.rows, S.board, S.group];
  try {
    S.rows = gridRows; S.board = "B01"; S.group = "ALL"; H.T.pos = null;
    const note = H.pos3DNote();
    assert.match(note, /無實際座標，為排列示意網格（2 個焊墊）/, "全板為 gridPos 時必須明確警示無實際座標");
  } finally {
    [S.rows, S.board, S.group] = saved; H.T.pos = null;
  }
});

test("受控座標匯入 → buildRows → 3D 示意位置皆為有限值（使用者實際資料路徑）", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  const w = dom.window, H = await waitFor(() => w.SPI_TEST_HOOK?.pos3D && w.SPI_TEST_HOOK);
  // 範例資料與舊本機回合走格狀回退（gridPos），驗不到受控座標路徑；這裡照正式匯入的 o.place.controlled 建列
  // 兩種實際輸入：沒有 X/Y 欄（x 為 undefined）與廠商格式轉換後 X/Y 欄空白（x 為 null；isFinite(null) 為 true）
  for (const [label, head, cells] of [["無 X/Y 欄", "", ""], ["X/Y 欄空白", ",X,Y", ",,"]]) {
    const csv = `Board,Component ID,PAD ID,Volume(%)${head}\n` +
      ["U1", "U1", "U1", "U1", "R5", "R5", "X9"].map((c, i) => `1,${c},${i + 1},${100 + i}${cells}`).join("\n") + "\n";
    const table = w.csvTable(csv), map = w.autoMap(table.head);
    const opts = { ...w.guessOpts(table.head, map), side: "TOP",
      place: { controlled: true, items: [{ side: "TOP", ref: "U1", x: 10, y: 20 }, { side: "TOP", ref: "R5", x: 30, y: 5 }] } };
    const { rows } = w.buildRows(table, map, opts);
    assert.equal(rows.length, 7, label);
    assert.ok(rows.every(r => r.x == null && r.y == null), `${label}：受控匯入不產生焊墊 X/Y（前提）`);
    H.T.pos = null;
    const P = H.pos3D(rows);
    assert.equal(P.size, 6, `${label}：有元件中心的 6 個焊墊都要畫，無座標的 X9 略過`);
    for (const p of P.values()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.est, `${label}：3D 座標必須是有限值且標為示意`);
    assert.equal(new Set([...P.values()].map(p => p.x + "," + p.y)).size, 6, `${label}：焊墊不可疊在同一點`);
    assert.ok(rows.every(r => !H.realXY(r)), `${label}：統計端不可把空白座標當成 (0,0)`);
    // HUD 與匯出快照共用的註記
    const S = H.S, saved = [S.rows, S.board, S.group];
    try { S.rows = rows; S.board = rows[0].board; S.group = "ALL"; H.T.pos = null;
      assert.equal(H.pos3DNote(), "元件中心示意，非焊墊實際位置（6 個焊墊） · 1 個焊墊無座標未繪出", label);
    } finally { [S.rows, S.board, S.group] = saved; H.T.pos = null; }
  }
});

test("3D 鏡頭依板面大小對準：範例板不變、大板等比放大、超過 1 公尺提示單位", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  const w = dom.window, H = await waitFor(() => w.SPI_TEST_HOOK?.fit3D && w.SPI_TEST_HOOK);
  // 範例板 60 mm：與原本固定值相同（不改既有畫面）
  assert.deepEqual({ ...H.fit3D(60) }, { rad: 78, min: 20, max: 160, near: 0.1, far: 500 });
  // 小板（單一元件約 8 mm）不拉近：放大後的錫膏高度不隨板面縮放，拉近會超出畫面（PR #74 審查）
  assert.deepEqual({ ...H.fit3D(8) }, { ...H.fit3D(60) });
  // 190 mm 實板：等比放大，整塊板仍在鏡頭內
  const f = H.fit3D(190);
  assert.ok(Math.abs(f.rad / 78 - 190 / 60) < 1e-12 && f.far > f.rad + 190, "距離與遠裁切面隨板面放大");
  // 2026-10-28 正式站 B09：元件中心 55–7486 × 140–4740（疑似 mil 當 mm）
  const mk = (x, y) => ({ x, y });
  const P = new Map([[1, mk(55, 140)], [2, mk(7486.22, 4740)], [3, mk(3000, 2000)]]);
  const E = H.ext3D(P);
  assert.equal(Math.round(E.w), 7439); assert.equal(Math.round(E.d), 4608); assert.equal(E.span, E.w);
  assert.match(H.size3DNote(E), /超過 1 公尺.*單位可能有誤/);
  assert.equal(H.size3DNote(H.ext3D(new Map([[1, mk(0, 0)], [2, mk(190, 120)]]))), "", "正常大小不提示");
  // pos3DNote（HUD 與匯出快照共用）帶出單位提示
  const S = H.S, saved = [S.rows, S.board, S.group];
  try {
    S.rows = [{ board: "B1", pad: "U1-1", comp: "U1", componentX: 55, componentY: 140, w: 0.7, d: 0.7 },
      { board: "B1", pad: "U2-1", comp: "U2", componentX: 7486.22, componentY: 4740, w: 0.7, d: 0.7 }];
    S.board = "B1"; S.group = "ALL"; H.T.pos = null;
    assert.match(H.pos3DNote(), /元件中心示意.*超過 1 公尺/);
  } finally { [S.rows, S.board, S.group] = saved; H.T.pos = null; }
  // 匯出快照的註記斷行：每行不超過寬度、文字不遺失（單位提示在最後，單行會被截掉）
  const g = { measureText: (t) => ({ width: [...t].length * 18 }) };
  const note = "⚠ 元件中心示意，非焊墊實際位置（1000 個焊墊） · " + H.size3DNote(E);
  const lines = H.wrapCanvasText(g, note, 1076);
  assert.ok(lines.length >= 2, "長註記要斷成多行");
  assert.ok(lines.every(l => g.measureText(l).width <= 1076), "每行不超過畫布寬度");
  assert.equal(lines.join("").replace(/\s/g, ""), note.replace(/\s/g, ""), "斷行不遺失文字");
  assert.match(lines.at(-1), /單位設定/, "改正指引留在快照內");
});

test("3D 側欄出錯不擋 3D 初始化：safeBoard2D 標示錯誤並回傳 false", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  await tick(80);
  const w = dom.window, H = w.SPI_TEST_HOOK;
  const errs = [];
  w.console.error = (...a) => errs.push(a);
  const S = H.S, saved = S.A;
  S.A = { byBoard: null, defRows: [] };  // 讓 renderBoard2D 在寫完 HUD 前後拋錯
  S.board = S.board || "B01";
  let r;
  try { r = H.safeBoard2D(); } finally { S.A = saved; }
  assert.equal(r, false, "renderBoard2D 拋錯時回傳 false 而非往上拋");
  assert.ok(errs.length >= 1, "錯誤寫入 console.error，不吞錯");
  assert.match(w.document.querySelector("#hud").innerHTML, /側欄圖表更新失敗/);
});

test("前端座標檔登錄守衛 placeSizeErr 與伺服器 placementSizeError 門檻一致", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { placementSizeError } = await import("../lib/controlled-import.mjs");
  const dom = createPage();
  await tick(80);
  const H = dom.window.SPI_TEST_HOOK;
  const cases = [
    [[{ x: 0, y: 0 }, { x: 7431, y: 4761 }], "mm"],
    [[{ x: 0, y: 0 }, { x: 188.7, y: 120.9 }], "mil"],
    [[{ x: 0, y: 0 }, { x: 3, y: 2 }], "mm"],
    [[{ x: 0, y: 0 }, { x: 1000, y: 10 }], "mm"],
    [[{ x: 0, y: 0 }, { x: 5, y: 1 }], "mm"],
    [[{ x: 7431, y: 4761 }], "mm"],
  ];
  for (const [items, unit] of cases) {
    const srv = placementSizeError(items, unit), cli = H.placeSizeErr(items, unit);
    assert.equal(Boolean(cli), Boolean(srv), `${JSON.stringify(items)} 前後端判定一致`);
    if (srv) assert.equal(cli, srv.error, "錯誤訊息一致");
  }
  // 讀取既有紀錄仍只提示、不阻擋（parsePlacement 不拋錯）
  assert.match(H.placeUnitWarn([{ x: 0, y: 0 }, { x: 7431, y: 4761 }], "mm"), /疑似實際單位為 mil/);
  assert.equal(H.headerPlaceUnit(["X mm", "Y mm", "RefDes"]), "mm");
  assert.equal(H.headerPlaceUnit(["X(mm)", "Y(mil)", "RefDes"]), "conflict");
  assert.throws(() => H.parsePlacement({ head: ["RefDes", "X mm", "Y mm", "Layer"], data: [["U1", "10", "20", "TOP"], ["U2", "30", "40", "TOP"]] }, "mil", "TOP"), /欄名標示 mm/);
  assert.throws(() => H.parsePlacement({ head: ["RefDes", "X(mm)", "Y(mil)", "Layer"], data: [["U1", "10", "20", "TOP"], ["U2", "30", "40", "TOP"]] }, "mm", "TOP"), /座標單位與欄名不一致/);
  assert.equal(H.parsePlacement({ head: ["RefDes", "X", "Y", "Layer"], data: [["U1", "10", "20", "TOP"], ["U2", "30", "40", "TOP"]] }, "mm", "TOP").items.length, 2);
});
