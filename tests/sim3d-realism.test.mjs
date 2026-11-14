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

test("真實外觀：不良焊墊以判定色標出、不良元件畫位置環、圖例與畫面一致", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  const w = dom.window, H = await waitFor(() => w.SPI_TEST_HOOK?.build3D && w.SPI_TEST_HOOK.S?.A?.defRows?.length && w.SPI_TEST_HOOK);
  const T = H.T, S = H.S, THREE = w.THREE;
  T.ok = true; T.root = new THREE.Group(); T.cam = new THREE.PerspectiveCamera(45, 1, 0.1, 500); T.fitSpan = null;
  const saved = { rows: S.rows, board: S.board, group: S.group, mode: S.sim3dMode, color: S.colorMode, ghost: S.ghost, brg: S.bridgeWarn };
  const ng = w.getComputedStyle(w.document.documentElement).getPropertyValue("--ng").trim();
  try {
    // 圖例：真實外觀下列出規格內灰與判定色，本板有不良時列出「不良元件位置」
    S.sim3dMode = "real"; S.colorMode = "height";
    const defBoard = S.A.defRows[0].board; S.board = defBoard; H.renderBoard2D();
    const leg = w.document.getElementById("leg3d").textContent;
    assert.match(leg, /規格內/); assert.match(leg, /少錫・多錫・連錫風險/); assert.match(leg, /不良元件位置/);
    assert.doesNotMatch(leg, /LSL ➔ USL/, "真實外觀不顯示熱圖色階");
    S.board = "B01"; S.group = "ALL"; S.ghost = false; S.bridgeWarn = false; S.sim3dMode = "real"; S.colorMode = "status";
    S.rows = [
      { board: "B01", pad: "C1.1", comp: "C1", group: "C1", componentX: 10, componentY: 10, w: 0.6, d: 0.6, volume: 100, area: 100, height: 120 },
      { board: "B01", pad: "C1.2", comp: "C1", group: "C1", componentX: 10, componentY: 10, w: 0.6, d: 0.6, volume: 100, area: 100, height: 120 },
      { board: "B01", pad: "U2.1", comp: "U2", group: "U2", componentX: 40, componentY: 30, w: 0.6, d: 0.6, volume: 5, area: 100, height: 120 },
    ];
    const bad = S.rows[2];
    H.build3D();
    const meshes = T.meshes;
    const okMesh = meshes.find((m) => m.userData === S.rows[0]), badMesh = meshes.find((m) => m.userData === bad);
    assert.equal(okMesh.material, H.getRealPasteMat(), "規格內焊墊維持真實外觀金屬灰");
    assert.notEqual(badMesh.material, H.getRealPasteMat(), "不良焊墊不可與規格內同為灰色");
    assert.equal(badMesh.material.color.getHexString(), new THREE.Color(ng).getHexString(), "少錫焊墊以 --ng 標出");
    const rings = T.root.children.filter((c) => c.name === "defectCompRing");
    assert.equal(rings.length, 1, "只有含不良的元件（U2）畫位置環");
    assert.equal(rings[0].material.color.getHexString(), new THREE.Color(ng).getHexString());

    // 高密度（InstancedMesh）路徑：不良焊墊另成一批並帶顏色，pick 可反查
    const big = Array.from({ length: H.HIGH_DENSITY_3D_THRESHOLD + 10 }, (_, i) => ({
      board: "B01", pad: `P${i}`, comp: `R${i}`, group: "G1", x: (i % 60) * 1.2, y: Math.floor(i / 60) * 1.2,
      w: 0.6, d: 0.6, volume: i === 7 ? 5 : 100, area: 100, height: 120,
    }));
    S.rows = big; H.build3D();
    const badInst = T.root.children.find((c) => c.name === "pasteRectInstBad");
    assert.ok(badInst && badInst.count === 1 && badInst.instanceColor, "高密度真實外觀：不良焊墊另一批且帶判定色");
    assert.equal(badInst.userData.rows[0], big[7]);
    assert.equal(T.root.children.find((c) => c.name === "pasteRectInst").count, big.length - 1);
    assert.equal(T.root.children.filter((c) => c.name === "defectCompRing").length, 1);

    // 無不良的板不畫環
    S.rows = big.map((r) => ({ ...r, volume: 100 })); H.build3D();
    assert.ok(!T.root.children.some((c) => c.name === "defectCompRing"), "無不良不畫位置環");
  } finally {
    T.ok = false; T.root = null;
    S.rows = saved.rows; S.board = saved.board; S.group = saved.group; S.sim3dMode = saved.mode; S.colorMode = saved.color; S.ghost = saved.ghost; S.bridgeWarn = saved.brg;
  }
});

function loadCompModules() {
  const code = fs.readFileSync(path.join(ROOT, "spi-spc.html"), "utf8");
  const fnMatch = code.match(/function resolveComponentSpec[\s\S]*?function pos3D\(rows\)\{[\s\S]*?\n\}/);
  const threeCode = fs.readFileSync(path.join(ROOT, "vendor", "three-r128.min.js"), "utf8");
  const vm = require("vm");
  const ctx = { console, Math, Set, Map, Number, String, Array };
  vm.createContext(ctx);
  vm.runInContext(threeCode, ctx);
  vm.runInContext(`
    let T = {};
    let S = { comp3dMode: "semi" };
    function realXY(r){ return false; }
    ${fnMatch[0]}
  `, ctx);
  return {
    resolveComponentSpec: ctx.resolveComponentSpec,
    calcPadOffsetAndGeom: ctx.calcPadOffsetAndGeom,
    buildComponent3DObject: ctx.buildComponent3DObject,
    buildComponentMeshes3D: ctx.buildComponentMeshes3D,
    pos3D: ctx.pos3D,
    THREE: ctx.THREE,
    ctx
  };
}

test("IPC / EIA 封裝幾何推算：0402 與 0603 零件外觀與焊墊尺寸對應", () => {
  const { resolveComponentSpec } = loadCompModules();

  // 1. 0402 vs 0603 尺寸比對
  const spec0402 = resolveComponentSpec("R0402", "R1", 2);
  const spec0603 = resolveComponentSpec("R0603", "R2", 2);

  assert.equal(spec0402.family, "chip_r");
  assert.equal(spec0402.bodyL, 1.00);
  assert.equal(spec0402.bodyW, 0.50);
  assert.equal(spec0402.padL, 0.55);
  assert.equal(spec0402.padW, 0.60);
  assert.equal(spec0402.pitchX, 1.00);

  assert.equal(spec0603.family, "chip_r");
  assert.equal(spec0603.bodyL, 1.60);
  assert.equal(spec0603.bodyW, 0.80);
  assert.equal(spec0603.padL, 0.85);
  assert.equal(spec0603.padW, 0.90);
  assert.equal(spec0603.pitchX, 1.60);

  // 斷言：0603 零件與焊墊皆顯著大於 0402
  assert.ok(spec0603.bodyL > spec0402.bodyL, "0603 零件長度大於 0402");
  assert.ok(spec0603.bodyW > spec0402.bodyW, "0603 零件寬度大於 0402");
  assert.ok(spec0603.padL > spec0402.padL, "0603 焊墊長度大於 0402");
  assert.ok(spec0603.padW > spec0402.padW, "0603 焊墊寬度大於 0402");
  assert.ok(spec0603.pitchX > spec0402.pitchX, "0603 焊墊間距大於 0402");

  // 2. 電容與二極體解析
  const specCap = resolveComponentSpec("C0402", "C10", 2);
  assert.equal(specCap.family, "chip_c");

  const specDiode = resolveComponentSpec("SOD-323", "D1", 2);
  assert.equal(specDiode.family, "diode");
  assert.equal(specDiode.bodyL, 1.7);

  // 3. SOT-23 與 BGA 解析
  const specSot = resolveComponentSpec("SOT-23", "Q1", 3);
  assert.equal(specSot.family, "sot");
  assert.equal(specSot.nPins, 3);

  const specBga = resolveComponentSpec("BGA64-06-06", "U1", 64);
  assert.equal(specBga.family, "bga");
  assert.equal(specBga.padShape, "round");
});

test("焊墊幾何旋轉與位移：calcPadOffsetAndGeom 隨角度正確旋轉", () => {
  const { resolveComponentSpec, calcPadOffsetAndGeom } = loadCompModules();
  const spec = resolveComponentSpec("R0402", "R1", 2);

  // 0 度旋轉
  const p0_1 = calcPadOffsetAndGeom(spec, 0, 2, 0);
  const p0_2 = calcPadOffsetAndGeom(spec, 1, 2, 0);
  assert.equal(p0_1.x, -0.5);
  assert.equal(p0_1.y, 0);
  assert.equal(p0_1.w, 0.55);
  assert.equal(p0_1.d, 0.60);
  assert.equal(p0_2.x, 0.5);
  assert.equal(p0_2.y, 0);

  // 90 度旋轉：焊墊長寬互換，間距轉至 Y 軸
  const p90_1 = calcPadOffsetAndGeom(spec, 0, 2, 90);
  const p90_2 = calcPadOffsetAndGeom(spec, 1, 2, 90);
  assert.ok(Math.abs(p90_1.x) < 1e-6, "90 度旋轉後 X 偏移接近 0");
  assert.ok(Math.abs(p90_1.y - (-0.5)) < 1e-6, "90 度旋轉後 Y 偏移為 -0.5");
  assert.equal(p90_1.w, 0.60, "90 度旋轉後長度變為原寬度");
  assert.equal(p90_1.d, 0.55, "90 度旋轉後寬度變為原長度");
  assert.ok(Math.abs(p90_2.x) < 1e-6);
  assert.ok(Math.abs(p90_2.y - 0.5) < 1e-6);

  // SOT-23 3 腳非對稱展開
  const specSot = resolveComponentSpec("SOT-23", "Q1", 3);
  const s1 = calcPadOffsetAndGeom(specSot, 0, 3, 0);
  const s2 = calcPadOffsetAndGeom(specSot, 1, 3, 0);
  const s3 = calcPadOffsetAndGeom(specSot, 2, 3, 0);
  assert.equal(s1.x, -0.95);
  assert.equal(s1.y, -1.2);
  assert.equal(s2.x, 0.95);
  assert.equal(s2.y, -1.2);
  assert.equal(s3.x, 0);
  assert.equal(s3.y, 1.2);
});

test("pos3D 焊墊展開與 DFM 統計隔離邊界：dimAssumed 嚴格維持 true", () => {
  const { pos3D } = loadCompModules();

  const rows = [
    { board: "B01", pad: "R1.1", comp: "R1", pkg: "R0402", componentX: 10, componentY: 20, componentRot: 0, dimAssumed: true },
    { board: "B01", pad: "R1.2", comp: "R1", pkg: "R0402", componentX: 10, componentY: 20, componentRot: 0, dimAssumed: true },
    { board: "B01", pad: "R2.1", comp: "R2", pkg: "R0603", componentX: 30, componentY: 40, componentRot: 0, dimAssumed: true },
    { board: "B01", pad: "R2.2", comp: "R2", pkg: "R0603", componentX: 30, componentY: 40, componentRot: 0, dimAssumed: true },
  ];

  const P = pos3D(rows);
  assert.equal(P.size, 4);

  // 0402 焊墊長寬比對（存於 3D 位置 Map，嚴禁原地改寫原始量測列 rows）
  assert.equal(P.get(rows[0]).w, 0.55);
  assert.equal(P.get(rows[0]).d, 0.60);
  assert.equal(rows[0].w, undefined, "pos3D 不可原地改寫 rows[0].w 污染統計或 DFM");
  assert.equal(rows[0].d, undefined, "pos3D 不可原地改寫 rows[0].d 污染統計或 DFM");
  assert.equal(rows[0].dimAssumed, true, "0402 焊墊需維持 dimAssumed=true 隔離 DFM 統計");

  // 0603 焊墊長寬比對
  assert.equal(P.get(rows[2]).w, 0.85);
  assert.equal(P.get(rows[2]).d, 0.90);
  assert.equal(rows[2].w, undefined, "pos3D 不可原地改寫 rows[2].w 污染統計或 DFM");
  assert.equal(rows[2].dimAssumed, true, "0603 焊墊需維持 dimAssumed=true 隔離 DFM 統計");

  // 兩者焊墊尺寸確實不同
  assert.ok(P.get(rows[2]).w > P.get(rows[0]).w, "0603 焊墊長度應大於 0402");
  assert.ok(P.get(rows[2]).d > P.get(rows[0]).d, "0603 焊墊寬度應大於 0402");
});

test("極度擬真 3D 零件模型生成：buildComponent3DObject 結構與半透明/實心材質切換", () => {
  const { resolveComponentSpec, buildComponent3DObject, THREE } = loadCompModules();

  const spec0402 = resolveComponentSpec("R0402", "R1", 2);

  // 半透明模式 (semi)
  const gSemi = buildComponent3DObject(THREE, spec0402, "semi");
  assert.ok(gSemi.children.length >= 3, "電阻模型應包含本體與兩端電極");
  const bodyMeshSemi = gSemi.children[0];
  assert.equal(bodyMeshSemi.material.transparent, true, "半透明模式需啟用 transparent");
  assert.equal(bodyMeshSemi.material.opacity, 0.58, "本體透明度為 0.58");

  // 實心模式 (solid)
  const gSolid = buildComponent3DObject(THREE, spec0402, "solid");
  const bodyMeshSolid = gSolid.children[0];
  assert.equal(bodyMeshSolid.material.transparent, false, "實心模式為不透明");
  assert.equal(bodyMeshSolid.material.opacity, 1.0, "實心模式透明度為 1.0");

  // 二極體模型驗證（含陰極標記白線）
  const specDiode = resolveComponentSpec("SOD-323", "D1", 2);
  const gDiode = buildComponent3DObject(THREE, specDiode, "semi");
  assert.ok(gDiode.children.length >= 4, "二極體應包含本體、陰極帶與引腳");

  // BGA 模型驗證（含 BT 載板與金屬蓋）
  const specBga = resolveComponentSpec("BGA64-06-06", "U1", 64);
  const gBga = buildComponent3DObject(THREE, specBga, "solid");
  assert.ok(gBga.children.length >= 2, "BGA 應包含載板與上蓋");
});

test("3D 零件模擬三態切換：#seg3dCompMode 按鈕切換半透明/實心/隱藏", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = createPage();
  const w = dom.window, H = await waitFor(() => w.SPI_TEST_HOOK?.S && w.SPI_TEST_HOOK);
  const S = H.S;

  assert.equal(S.comp3dMode, "semi", "預設零件模擬模式為半透明 semi");
  const seg = w.document.getElementById("seg3dCompMode");
  assert.ok(seg, "頁面需存在 #seg3dCompMode 控制項");

  const btns = seg.querySelectorAll("button");
  assert.equal(btns.length, 3);
  assert.equal(btns[0].textContent.trim(), "半透明");
  assert.equal(btns[1].textContent.trim(), "實心");
  assert.equal(btns[2].textContent.trim(), "隱藏");
  assert.equal(btns[0].getAttribute("aria-pressed"), "true");

  // 切換至「實心」
  btns[1].click();
  assert.equal(S.comp3dMode, "solid");
  assert.equal(btns[1].getAttribute("aria-pressed"), "true");
  assert.equal(btns[0].getAttribute("aria-pressed"), "false");

  // 切換至「隱藏」
  btns[2].click();
  assert.equal(S.comp3dMode, "off");
  assert.equal(btns[2].getAttribute("aria-pressed"), "true");
  assert.equal(btns[1].getAttribute("aria-pressed"), "false");

  // 切換回「半透明」
  btns[0].click();
  assert.equal(S.comp3dMode, "semi");
  assert.equal(btns[0].getAttribute("aria-pressed"), "true");
});
