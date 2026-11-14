// Gerber 焊墊解析（lib/gerber-pads.mjs）與頁面內嵌副本一致性。規格：docs/spec-gerber-layout-rfc.md
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGerber, quickCheckGerber, unionAreaPerim, gerberLayerFromName, GERBER_LIMITS } from "../lib/gerber-pads.mjs";
import { gerberBlock, START, END } from "../tools/sync-gerber-pads.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}（容差 ${tol}）`);
const head = (fs = "%FSLAX46Y46*%", mo = "%MOMM*%") => `G04 synthetic*\n${fs}\n${mo}\n`;
const at = (x, y) => `X${Math.round(x * 1e6)}Y${Math.round(y * 1e6)}`;

test("標準光圈 C／R／O／P：尺寸、面積、周長", () => {
  const g = head() + `%ADD10C,0.6*%\n%ADD11R,1.0X0.5*%\n%ADD12O,1.2X0.6*%\n%ADD13P,1.0X6*%\n` +
    `D10*\n${at(0, 0)}D03*\nD11*\n${at(10, 0)}D03*\nD12*\n${at(0, 10)}D03*\nD13*\n${at(10, 10)}D03*\nM02*\n`;
  const r = parseGerber(g);
  assert.equal(r.ok, true);
  assert.equal(r.unit, "mm");
  assert.equal(r.pads.length, 4);
  const [c, rc, o, p] = r.pads;
  near(c.area, Math.PI * 0.09); near(c.perim, Math.PI * 0.6);
  assert.deepEqual([rc.x, rc.y, rc.w, rc.h, rc.area, rc.perim], [10, 0, 1, 0.5, 0.5, 3]);
  near(o.area, 1.2 * 0.6 - (4 - Math.PI) * 0.09); near(o.perim, 2 * 0.6 + Math.PI * 0.6);
  near(p.area, (3 * Math.sqrt(3) / 2) * 0.25); near(p.perim, 3);
  near(r.bbox[0], -0.6); near(r.bbox[1], -0.3); near(r.bbox[2], 10.5); near(r.bbox[3], 10 + Math.sqrt(3) / 4);
});

test("inch 單位、尾零省略、小數座標與 G70／G71 舊單位", () => {
  const inch = parseGerber(head("%FSLAX24Y24*%", "%MOIN*%") + `%ADD10R,0.04X0.02*%\nD10*\nX10000Y0D03*\nX0Y10000D03*\nM02*`);
  assert.equal(inch.unit, "inch");
  near(inch.pads[0].x, 25.4); near(inch.pads[0].w, 1.016); near(inch.pads[1].y, 25.4);
  const trail = parseGerber(`%FSTAX24Y24*%\n%MOMM*%\n%ADD10C,0.5*%\nD10*\nX1Y1D03*\nX0Y2D03*\nM02*`);
  near(trail.pads[0].x, 10); near(trail.pads[0].y, 10); near(trail.pads[1].y, 20);
  const dec = parseGerber(`%FSLAX33Y33*%\n%MOMM*%\n%ADD10C,0.5*%\nD10*\nX1.5Y2.25D03*\nX12000Y2000D03*\nM02*`);
  near(dec.pads[0].x, 1.5); near(dec.pads[0].y, 2.25);
  const g70 = parseGerber(`%FSLAX24Y24*%\nG70*\n%ADD10C,0.02*%\nD10*\nX0Y0D03*\nX10000Y0D03*\nM02*`);
  assert.equal(g70.unit, "inch"); near(g70.pads[1].x, 25.4);
});

test("巨集圓角矩形：面積與周長接近解析值", () => {
  const g = head() + `%AMRoundRect*\n0 rounded*\n21,1,$2-$1-$1,$3,0,0,0*\n21,1,$2,$3-$1-$1,0,0,0*\n` +
    `1,1,$1+$1,$2/2-$1,$3/2-$1*\n1,1,$1+$1,-$2/2+$1,$3/2-$1*\n1,1,$1+$1,-$2/2+$1,-$3/2+$1*\n1,1,$1+$1,$2/2-$1,-$3/2+$1*%\n` +
    `%ADD20RoundRect,0.1X1.0X0.5*%\nD20*\n${at(0, 0)}D03*\n${at(20, 0)}D03*\nM02*`;
  const r = parseGerber(g);
  const p = r.pads[0], rr = 0.1;
  near(p.area, 1 * 0.5 - (4 - Math.PI) * rr * rr, 2e-4);
  near(p.perim, 2 * 1.5 - 8 * rr + 2 * Math.PI * rr, 2e-3);
  near(p.w, 1, 1e-9); near(p.h, 0.5, 1e-9);
  assert.equal(p.shape, "p");
});

test("聯集：重疊、共邊、完全重複只計一次", () => {
  const sq = (x, y, s = 1) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
  assert.deepEqual(unionAreaPerim([sq(0, 0), sq(0, 0)]), { area: 1, perim: 4 });
  assert.deepEqual(unionAreaPerim([sq(0, 0), sq(1, 0)]), { area: 2, perim: 6 });
  assert.deepEqual(unionAreaPerim([sq(0, 0, 2), sq(1, 1, 2)]), { area: 7, perim: 12 });
  const cw = unionAreaPerim([sq(0, 0).reverse(), sq(5, 5)]);
  assert.deepEqual(cw, { area: 2, perim: 8 });
});

test("區域 G36／G37：直線與圓弧輪廓、極性清除不計", () => {
  const g = head() + `%ADD10C,0.1*%\nD10*\nG36*\n${at(0, 0)}D02*\nG01*\n${at(2, 0)}D01*\n${at(2, 1)}D01*\n${at(0, 1)}D01*\n${at(0, 0)}D01*\nG37*\n` +
    `G75*\nG36*\n${at(10, 0)}D02*\nG03*\n${at(10, 0)}I1000000J0D01*\nG37*\n` +
    `%LPC*%\nG36*\n${at(20, 0)}D02*\nG01*\n${at(21, 0)}D01*\n${at(21, 1)}D01*\n${at(20, 0)}D01*\nG37*\n%LPD*%\nM02*`;
  const r = parseGerber(g);
  assert.equal(r.pads.length, 2);
  assert.equal(r.stats.clear, 1);
  const [rect, circ] = r.pads;
  assert.deepEqual([rect.x, rect.y, rect.area, rect.perim], [1, 0.5, 2, 6]);
  near(circ.x, 11, 1e-6); near(circ.area, Math.PI, 0.01); near(circ.perim, 2 * Math.PI, 0.01);
});

test("步進重複 SR、旋轉 LR、鏡像 LM", () => {
  const g = head() + `%ADD10R,1.0X0.5*%\n%SRX3Y2I10.0J20.0*%\nD10*\n${at(0, 0)}D03*\n%SR*%\n` +
    `%LR90*%\n${at(100, 0)}D03*\n%LR45*%\n${at(100, 10)}D03*\n%LR0*%\nM02*`;
  const r = parseGerber(g);
  assert.equal(r.pads.length, 8);
  const xs = r.pads.slice(0, 6).map(p => `${p.x},${p.y}`).sort();
  assert.deepEqual(xs, ["0,0", "0,20", "10,0", "10,20", "20,0", "20,20"]);
  const r90 = r.pads[6]; near(r90.w, 0.5); near(r90.h, 1); near(r90.area, 0.5);
  const r45 = r.pads[7]; near(r45.w, 1.5 / Math.SQRT2, 1e-9); near(r45.area, 0.5, 1e-9); near(r45.L, 1); near(r45.W, 0.5);
});

test("X2 屬性：檔案功能、物件位號與腳位、光圈功能", () => {
  const g = head() + `%TF.FileFunction,Copper,L1,Top*%\n%TA.AperFunction,SMDPad,CuDef*%\n%ADD10R,1.0X0.5*%\n%TA.AperFunction,ViaPad*%\n%ADD11C,0.4*%\n%TD*%\n` +
    `%TO.C,R1*%\n%TO.P,R1,1*%\nD10*\n${at(0, 0)}D03*\n%TO.P,R1,2*%\n${at(10, 0)}D03*\n%TD*%\nD11*\n${at(5, 5)}D03*\nM02*`;
  const r = parseGerber(g);
  assert.equal(r.layerGuess, "copper");
  assert.equal(r.sideGuess, "TOP");
  assert.deepEqual(r.pads.map(p => [p.ref, p.pin, p.fn]), [["R1", "1", "SMDPad"], ["R1", "2", "SMDPad"], [undefined, undefined, "ViaPad"]]);
  const bot = parseGerber(head() + `%TF.FileFunction,Paste,Bot*%\n%ADD10C,0.5*%\nD10*\n${at(0, 0)}D03*\n${at(10, 0)}D03*\nM02*`);
  assert.deepEqual([bot.layerGuess, bot.sideGuess], ["paste", "BOT"]);
});

test("板框：保留畫線線段；舊式模態座標延用上一個 D 碼", () => {
  const g = head() + `%TF.FileFunction,Profile,NP*%\n%ADD10C,0.1*%\nD10*\n${at(0, 0)}D02*\nG01*\n${at(50, 0)}D01*\n${at(50, 30)}*\n${at(0, 30)}*\n${at(0, 0)}*\nM02*`;
  const r = parseGerber(g, { keepDraws: true });
  assert.equal(r.ok, true);
  assert.equal(r.layerGuess, "outline");
  assert.equal(r.draws.length, 4);
  assert.deepEqual(r.bbox, [0, 0, 50, 30]);
  assert.equal(parseGerber(g).code, "no_pads");
});

test("CRLF 與一行多個指令", () => {
  const g = `%FSLAX46Y46*%%MOMM*%%ADD10C,0.5*%D10*${at(0, 0)}D03*${at(10, 0)}D03*M02*`.replace(/\*/g, "*\r\n");
  const r = parseGerber(g);
  assert.equal(r.pads.length, 2);
  assert.equal(parseGerber(new TextEncoder().encode(g)).pads.length, 2);
});

test("Worker 輕量檢查：格式、單位、計數；不合格說明修正方式", () => {
  const g = head() + `%TF.FileFunction,Paste,Top*%\n%ADD10R,1.0X0.5*%\nD10*\n${at(0, 0)}D03*\n${at(30, 20)}D03*\nG36*\n${at(0, 0)}D02*\nG01*\n${at(1, 0)}D01*\n${at(1, 1)}D01*\n${at(0, 0)}D01*\nG37*\nM02*`;
  const q = quickCheckGerber(new TextEncoder().encode(g));
  assert.deepEqual([q.ok, q.flashes, q.regions, q.fileFunction, q.unit], [true, 2, 1, "Paste,Top", "mm"]);
  assert.equal(quickCheckGerber("Ref,X,Y\nR1,1,2\n").code, "not_gerber");
  assert.equal(quickCheckGerber(`%MOMM*%\nD10*\nX0Y0D03*\n`).code, "no_format");
  assert.equal(quickCheckGerber(`%FSLAX46Y46*%\nD10*\nX0Y0D03*\n`).code, "no_unit");
  assert.equal(quickCheckGerber(`%FSLAX24Y24*%\nG70*\nD10*\nX0Y0D03*\n`).unit, "inch");
  assert.equal(quickCheckGerber(head() + "M02*").code, "no_pads");
  assert.equal(quickCheckGerber(head() + "X0Y0D03*\n".repeat(GERBER_LIMITS.maxPads + 1)).code, "too_many_pads");
  // 免費方案 CPU 預算：2 萬個焊墊的檔案遠低於 10 ms（取多次中最快一次，避開首次編譯）
  let big = head() + `%ADD10C,0.3*%\nD10*\n`;
  for (let i = 0; i < 20000; i++) big += `${at((i % 200) * 1.5, Math.floor(i / 200) * 1.5)}D03*\n`;
  const bytes = new TextEncoder().encode(big + "M02*");
  let best = Infinity;
  for (let k = 0; k < 5; k++) { const t = performance.now(); quickCheckGerber(bytes); best = Math.min(best, performance.now() - t); }
  assert.ok(best < 8, `輕量檢查 ${best.toFixed(1)} ms`);
});

test("錯誤：非 Gerber、缺格式、缺單位、無焊墊、太大、太小、超量", () => {
  assert.equal(parseGerber("Ref,X,Y\nR1,1,2\n").code, "not_gerber");
  assert.equal(parseGerber(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0])).code, "not_gerber");
  assert.equal(parseGerber(`%MOMM*%\n%ADD10C,0.5*%\nD10*\nX0Y0D03*\nM02*`).code, "no_format");
  assert.equal(parseGerber(`%FSLAX46Y46*%\n%ADD10C,0.5*%\nD10*\nX0Y0D03*\nM02*`).code, "no_unit");
  assert.equal(parseGerber(head() + `M02*`).code, "no_pads");
  const big = parseGerber(head() + `%ADD10C,0.5*%\nD10*\n${at(0, 0)}D03*\n${at(1200, 0)}D03*\nM02*`);
  assert.equal(big.code, "too_large");
  assert.match(big.error, /單位/);
  assert.equal(parseGerber(head() + `%ADD10C,0.5*%\nD10*\n${at(0, 0)}D03*\n${at(1, 0)}D03*\nM02*`).code, "too_small");
  let many = head() + `%ADD10C,0.1*%\nD10*\n`;
  for (let i = 0; i <= GERBER_LIMITS.maxPads; i++) many += `${at((i % 300) * 0.3, Math.floor(i / 300) * 0.3)}D03*\n`;
  assert.equal(parseGerber(many + "M02*").code, "too_many_pads");
});

test("惡意或錯誤檔案的上限：步進重複次數、多邊形頂點、檔案大小", () => {
  const sr = parseGerber(head() + `%ADD10C,0.3*%\n%SRX100Y100I1.0J1.0*%\nD10*\n${at(0, 0)}D03*\n%SR*%\nM02*`);
  assert.equal(sr.code, "too_many_pads");
  assert.match(sr.error, /步進重複/);
  const poly = parseGerber(head() + `%ADD10P,1.0X1000000*%\nD10*\n${at(0, 0)}D03*\n${at(10, 0)}D03*\nM02*`);
  assert.equal(poly.ok, true);
  assert.ok(poly.pads[0].area < Math.PI * 0.25 && poly.pads[0].area > 0.77);
  const big = { length: GERBER_LIMITS.maxRawBytes + 1 };
  assert.equal(quickCheckGerber(big).code, "too_large_file");
  const ff = quickCheckGerber(head() + `%TF.FileFunction,Paste<script>,Top*%\nX0Y0D03*\n`);
  assert.equal(ff.fileFunction, "Pastescript,Top");
});

test("清除極性：整個蓋住的焊墊移除、部分切除的標為面積不採用；之後畫的焊墊不受影響", () => {
  const g = head() + `%ADD10R,1.0X0.5*%\n%ADD11R,0.3X0.3*%\nD10*\n${at(0, 0)}D03*\n${at(10, 0)}D03*\n${at(20, 0)}D03*\n` +
    `%LPC*%\n${at(0, 0)}D03*\nD11*\n${at(10.4, 0)}D03*\n%LPD*%\nD10*\n${at(0, 0)}D03*\nM02*`;
  const r = parseGerber(g);
  assert.equal(r.pads.length, 3, "0 mm 的焊墊被清除後又重畫一次");
  assert.deepEqual(r.pads.map(p => p.x), [10, 20, 0]);
  assert.equal(r.pads[0].cut, true);
  assert.equal(r.pads[0].complex, true);
  assert.equal(r.pads[1].cut, undefined);
  assert.ok(r.warnings.some(w => /1 個焊墊被清除圖形覆蓋，已移除/.test(w)));
  assert.ok(r.warnings.some(w => /1 個焊墊被清除圖形部分切除/.test(w)));
});

test("板框整圓（G75 全圓）以弧線點計算範圍", () => {
  const g = head() + `%TF.FileFunction,Profile,NP*%\n%ADD10C,0.1*%\nD10*\nG75*\n${at(20, 10)}D02*\nG03*\n${at(20, 10)}I-10000000J0D01*\nM02*`;
  const r = parseGerber(g, { keepDraws: true });
  assert.equal(r.ok, true, r.error);
  assert.ok(Math.abs(r.bbox[2] - r.bbox[0] - 20) < 1e-6 && Math.abs(r.bbox[3] - r.bbox[1] - 20) < 1e-6, JSON.stringify(r.bbox));
});

test("Worker 輕量檢查接受 D3*／D1* 寫法，與完整解析一致", () => {
  const g = head() + `%ADD10C,0.5*%\nD10*\n${at(0, 0)}D3*\n${at(10, 0)}D3*\nM02*`;
  assert.equal(parseGerber(g).pads.length, 2);
  const q = quickCheckGerber(g);
  assert.equal(q.ok, true);
  assert.equal(q.flashes, 2);
  const outline = head() + `%ADD10C,0.1*%\nD10*\n${at(0, 0)}D2*\nG01*\n${at(20, 0)}D1*\n${at(20, 20)}D1*\nM02*`;
  assert.equal(quickCheckGerber(outline).draws, 2);
  assert.equal(quickCheckGerber(head() + `%ADD13C,0.5*%\nD13*\nM02*`).code, "no_pads", "D13* 是選光圈，不是閃光");
});

test("鋪銅等大區域不當焊墊；未定義光圈計數", () => {
  const g = head() + `%ADD10C,0.5*%\nG36*\n${at(0, 0)}D02*\nG01*\n${at(40, 0)}D01*\n${at(40, 40)}D01*\n${at(0, 40)}D01*\n${at(0, 0)}D01*\nG37*\n` +
    `D10*\n${at(1, 1)}D03*\n${at(9, 1)}D03*\nD99*\n${at(5, 5)}D03*\nM02*`;
  const r = parseGerber(g);
  assert.equal(r.pads.length, 2);
  assert.equal(r.stats.skippedLarge, 1);
  assert.equal(r.stats.unknownAperture, 1);
});

test("副檔名推定圖層", () => {
  assert.equal(gerberLayerFromName("board.GTP"), "paste");
  assert.equal(gerberLayerFromName("board.gbl"), "copper");
  assert.equal(gerberLayerFromName("board.gko"), "outline");
  assert.equal(gerberLayerFromName("F_Paste.gbr"), "paste");
  assert.equal(gerberLayerFromName("board.gbr"), "");
});

test("頁面內嵌副本與 lib 一致（改 lib 後執行 node tools/sync-gerber-pads.mjs）", () => {
  const lib = readFileSync(join(root, "lib", "gerber-pads.mjs"), "utf8");
  const html = readFileSync(join(root, "spi-spc.html"), "utf8").replace(/\r\n/g, "\n");
  const s = html.indexOf(START), e = html.indexOf(END);
  assert.ok(s > 0 && e > s, "spi-spc.html 缺少 @gerber-pads 標記");
  assert.equal(html.slice(s, e + END.length), gerberBlock(lib));
  const core = html.slice(html.indexOf('<script id="core">'), html.indexOf("</script>", html.indexOf('<script id="core">')));
  assert.ok(core.includes(START), "GERBER 必須在 core 腳本內");
});
