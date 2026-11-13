// 3D 錫膏模擬擬真化單元測試：體積守恆形狀因子、微觀顆粒 PBR 材質、雙模視覺切換與雙向焦點聯動
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { JSDOM } = (() => { try { return require("jsdom"); } catch { return {}; } })();
const { HTML } = require("./_load.js");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 5000) {
  const t0 = Date.now();
  for (;;) { const v = cond(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("waitFor 逾時"); await tick(10); }
}

const html = () => fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");

function createPage() {
  const threeCode = fs.readFileSync(path.join(ROOT, "vendor", "three-r128.min.js"), "utf8");
  const dom = new JSDOM(html(), {
    runScripts: "dangerously",
    url: "https://spi.example/",
    beforeParse(w) {
      w.eval(threeCode);
      w.SPI_TEST_HOOK = { bootSample: true };
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} };
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = () => {};

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
    }
  });
  return dom;
}

test("體積守恆形狀因子計算器：calcShapeFactor 嚴格遵守數值邊界與物理關係", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  const H = await waitFor(() => dom.window.SPI_TEST_HOOK?.calcShapeFactor && dom.window.SPI_TEST_HOOK);
  const hs = { tgt: 120 };
  const st = { stencil: 120, step: { on: false } };

  // 1. 標準理想印刷 (100% Volume, 100% Area, 120um Height)
  const etaNom = H.calcShapeFactor({ volume: 100, area: 100, height: 120 }, hs, st);
  assert.equal(etaNom, 0.98, "理想 1.0 被平滑截斷至 0.98");

  // 2. 局部缺錫 / 挖錫 (70% Volume, 100% Area, 120um Height)
  const etaScoop = H.calcShapeFactor({ volume: 70, area: 100, height: 120 }, hs, st);
  assert.ok(Math.abs(etaScoop - 0.70) < 1e-4, "體積比值嚴格反應為 0.70");

  // 3. 極度少錫下限 (30% Volume)
  const etaStarved = H.calcShapeFactor({ volume: 30, area: 100, height: 120 }, hs, st);
  assert.equal(etaStarved, 0.45, "過低體積平滑保底於 0.45，防止幾何翻轉穿孔");

  // 4. 缺失數據或異常值優雅回退
  const etaMissing = H.calcShapeFactor(null, hs, st);
  assert.equal(etaMissing, 0.82, "無量測值時預設為典型 SMT 焊錫塊形狀因子 0.82");
});

test("微觀顆粒紋理與 PBR 材質：生成 SAC305 霧面微顆粒法線貼圖與金屬度", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  const H = await waitFor(() => dom.window.SPI_TEST_HOOK?.getSolderGrainTexture && dom.window.SPI_TEST_HOOK);
  const tex = H.getSolderGrainTexture();
  assert.ok(tex, "成功生成微觀法線紋理物件");
  assert.equal(tex.image.width, 64);
  assert.equal(tex.image.height, 64);
  assert.equal(tex.image.data.length, 64 * 64 * 4, "具備完整 RGBA 法線資料緩衝區");

  const mat = H.getRealPasteMat();
  assert.ok(mat, "成功取得真實 PBR 材質");
  assert.equal(mat.metalness, 0.72, "金屬度為 SAC305 合金粉末特徵 0.72");
  assert.equal(mat.roughness, 0.48, "粗糙度為微顆粒漫散射 0.48");
  assert.ok(mat.normalMap, "綁定微觀顆粒法線貼圖");
});

test("體積守恆幾何重構：createSolderPasteGeometry 頂點皆為有限值且無 NaN", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  const H = await waitFor(() => dom.window.SPI_TEST_HOOK?.createSolderPasteGeometry && dom.window.SPI_TEST_HOOK);

  // 測試矩形焊墊（含挖錫與拉尖）
  const rRect = { volume: 75, area: 105, height: 110, peaking: 25, coplanarity: 15, bridgemargin: 20 };
  const geoRect = H.createSolderPasteGeometry(1.2, 0.24, 0.8, rRect, 0.02, "rect");
  assert.ok(geoRect, "矩形網格生成成功");
  const posRect = geoRect.attributes.position.array;
  for (let i = 0; i < posRect.length; i++) {
    assert.ok(Number.isFinite(posRect[i]), `矩形頂點第 ${i} 個分量不可為 NaN/Infinite`);
  }

  // 測試圓形焊墊（BGA 球墊）
  const rRound = { volume: 85, area: 95, height: 115, peaking: 18, coplanarity: 0 };
  const geoRound = H.createSolderPasteGeometry(0.5, 0.23, 0.5, rRound, 0.02, "round");
  assert.ok(geoRound, "圓形網格生成成功");
  const posRound = geoRound.attributes.position.array;
  for (let i = 0; i < posRound.length; i++) {
    assert.ok(Number.isFinite(posRound[i]), `圓形頂點第 ${i} 個分量不可為 NaN/Infinite`);
  }
});

test("雙模視覺切換：外觀模式支援真實外觀與品質熱圖", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  const H = await waitFor(() => dom.window.SPI_TEST_HOOK?.S && dom.window.SPI_TEST_HOOK);
  const w = dom.window, S = H.S;

  assert.equal(S.sim3dMode, "real", "預設為真實外觀模式");
  const seg = w.document.getElementById("seg3dRenderMode");
  assert.ok(seg, "頁面工具列需存在外觀模式切換按鈕組");

  const btns = seg.querySelectorAll("button");
  assert.equal(btns.length, 2);
  assert.equal(btns[0].textContent.trim(), "真實外觀");
  assert.equal(btns[1].textContent.trim(), "品質熱圖");

  // 切換至品質熱圖
  btns[1].click();
  assert.equal(S.sim3dMode, "heatmap", "點擊後切換至品質熱圖");

  // 切換回真實外觀
  btns[0].click();
  assert.equal(S.sim3dMode, "real", "點擊後切換回真實外觀");
});

test("雙向焦點聯動：點選焊墊同步更新 2D 截面剖面、HUD 形狀因子與 3D 高亮環", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  const H = await waitFor(() => dom.window.SPI_TEST_HOOK?.selectPadForProfile && dom.window.SPI_TEST_HOOK);
  const w = dom.window;

  const mockPad = {
    board: "B01",
    pad: "U1.A1",
    group: "U1 BGA",
    volume: 88.5,
    area: 96.2,
    height: 118,
    offx: 8,
    offy: -5,
    w: 0.5,
    d: 0.5,
    x: 10,
    y: 15
  };

  H.selectPadForProfile(mockPad);
  const hud = w.document.getElementById("hud");
  assert.ok(hud.innerHTML.includes("U1.A1"), "HUD 需包含選取焊墊位號");
  assert.ok(hud.innerHTML.includes("形狀因子 η"), "HUD 需展示形狀因子數值");

  // 測試 focusPad3D
  H.S.rows = [mockPad];
  H.S.board = "B01";
  H.focusPad3D("U1.A1");
  assert.equal(H.S.selectedPad, mockPad, "focusPad3D 正確設定 selectedPad");
});

test("局部不良密度（OOS Density）空間雜湊：計算鄰近區域不良密度並與色階映射一致", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  const H = await waitFor(() => dom.window.SPI_TEST_HOOK?.computeLocalOosDensity && dom.window.SPI_TEST_HOOK);
  const S = H.S;
  const saved = [S.specs, S.htol, S.step, S.specsG, S.heightUnit];
  try {
    S.specs = {
      volume: { lsl: 70, tgt: 100, usl: 130 },
      height: { lsl: 90, tgt: 120, usl: 150 },
      hpct: { lsl: 75, tgt: 100, usl: 125 },
      area: { lsl: 70, tgt: 100, usl: 130 },
      offx: { lsl: -75, tgt: 0, usl: 75 },
      offy: { lsl: -75, tgt: 0, usl: 75 },
    };
    S.htol = { lo: 75, hi: 125 }; S.step = { on: false, zones: [] }; S.specsG = {}; S.heightUnit = "um";
    assert.equal(H.computeLocalOosDensity([], (r) => ({ x: r.x, y: r.y }), (r) => (r.volume < 70 ? ["INS"] : [])).size, 0, "無有效座標回傳空 Map");

    // 4 個相鄰焊墊：只有 1 個 OOS
    const rows = [
      { pad: "P1", x: 10, y: 10, volume: 50 },
      { pad: "P2", x: 11, y: 10, volume: 100 },
      { pad: "P3", x: 10, y: 11, volume: 100 },
      { pad: "P4", x: 11, y: 11, volume: 100 },
      { pad: "Q1", x: 50, y: 50, volume: 50 }, // 遠端孤立不良點
    ];
    const dm = H.computeLocalOosDensity(rows, (r) => ({ x: r.x, y: r.y }), (r) => (r.volume < 70 ? ["INS"] : []));
    assert.ok(Math.abs(dm.get(rows[0]) - 0.25) < 1e-6, "4 鄰點中有 1 個不良，局部密度為 0.25");
    assert.equal(dm.get(rows[4]), 1, "遠端孤立不良點群聚密度為 1.0");
    assert.equal(H.densityColor(0), "#10b981", "密度 0 對應低密度綠");
    assert.equal(H.densityColor(0.25), "#f59e0b", "密度 0.25 對應中密度琥珀");
    assert.equal(H.densityColor(1), "#ef4444", "密度 1 對應極高密度紅");
  } finally {
    [S.specs, S.htol, S.step, S.specsG, S.heightUnit] = saved;
  }
});

test("3D InstancedMesh 批次渲染、高密度降階、pick 反查與不良密度著色自動切換", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  const w = dom.window, H = await waitFor(() => w.SPI_TEST_HOOK?.build3D && w.SPI_TEST_HOOK);
  const T = H.T, S = H.S;

  // 點選「不良密度」著色時，若在「真實外觀」應自動切換至「品質熱圖」
  S.sim3dMode = "real";
  const btnDensity = w.document.querySelector('#segColor button[data-v="density"]');
  assert.ok(btnDensity && btnDensity.textContent.trim() === "不良密度");
  btnDensity.click();
  assert.equal(S.colorMode, "density");
  assert.equal(S.sim3dMode, "heatmap", "點選不良密度應自動切換外觀為品質熱圖");
  assert.equal(w.document.querySelector('#seg3dRenderMode button[data-m="heatmap"]').getAttribute("aria-pressed"), "true");

  // 模擬已初始化的 3D 場景測試 build3D 產物
  const THREE = w.THREE;
  T.ok = true;
  T.root = new THREE.Group();
  T.cam = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  T.fitSpan = null;
  const savedRows = S.rows, savedBoard = S.board, savedGroup = S.group;
  try {
    S.board = "B01"; S.group = "ALL"; S.ghost = true; S.bridgeWarn = true;
    S.rows = [
      { board: "B01", pad: "U1.1", group: "U1", x: 10, y: 10, w: 0.6, d: 0.6, volume: 100, area: 100, height: 120, bridgemargin: 10 },
      { board: "B01", pad: "U1.2", group: "U1", x: 12, y: 10, w: 0.6, d: 0.6, volume: 100, area: 100, height: 120, shape: "round" },
    ];
    H.pos3D(S.rows);
    H.build3D();
    const names = T.root.children.map((c) => c.name).filter(Boolean);
    assert.ok(names.includes("cuRect") && names.includes("cuRound"), "銅墊應使用 InstancedMesh 批次建立");
    assert.ok(names.includes("pasteRectInst") && names.includes("pasteRoundInst"), "品質熱圖錫膏應使用 InstancedMesh 批次建立");
    assert.ok(names.includes("ghostMerged"), "鋼板虛線應合併為單一 LineSegments");
    assert.ok(names.includes("bridgeWarnInst"), "橋接預警環應使用 InstancedMesh 批次建立");
    const rectInst = T.root.children.find((c) => c.name === "pasteRectInst");
    assert.equal(rectInst.userData.rows[0], S.rows[0], "InstancedMesh userData.rows[0] 應對應原焊墊列，供 Raycaster instanceId 反查");

    // 超過 2500 顆焊墊時，即使在真實外觀模式也應啟用高密度降階渲染
    S.sim3dMode = "real";
    const bigRows = Array.from({ length: H.HIGH_DENSITY_3D_THRESHOLD + 50 }, (_, i) => ({
      board: "B01", pad: `P${i}`, group: "G1", x: (i % 60) * 1.2, y: Math.floor(i / 60) * 1.2,
      w: 0.6, d: 0.6, volume: 100, area: 100, height: 120,
    }));
    S.rows = bigRows;
    H.pos3D(S.rows);
    H.build3D();
    const bigPasteInst = T.root.children.find((c) => c.name === "pasteRectInst");
    assert.ok(bigPasteInst && bigPasteInst.count === bigRows.length, "超過門檻應以單一 InstancedMesh 繪製錫膏");
    assert.match(w.document.getElementById("hud").textContent, /高密度降階渲染/, "HUD 應揭露高密度降階渲染模式");
  } finally {
    T.ok = false; T.root = null;
    S.rows = savedRows; S.board = savedBoard; S.group = savedGroup;
    S.sim3dMode = "real"; S.colorMode = "volume";
  }
});
