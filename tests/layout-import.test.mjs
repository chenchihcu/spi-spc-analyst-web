// 受控座標匯入 → buildRows → 套用板面圖檔 → 各讀取端。AGENTS.md「改變列欄位語意時同一 PR 更新所有讀取端」的串接測試。
// 板面圖檔不改量測列：分析結果逐位元不變；對應結果只存在 run.info.layout。規格：docs/spec-gerber-layout-rfc.md
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { loadCore, baseState } = require("./_load.js");

const core = loadCore();
const { GERBER } = core;
const FOOT = { R: [[-0.5, 0], [0.5, 0]], U: [-1.905, -0.635, 0.635, 1.905].flatMap(y => [[-2.7, y], [2.7, y]]) };
const PARTS = [];
for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) PARTS.push({ ref: `${(i + j) % 2 ? "U" : "R"}${PARTS.length + 1}`, x: 8 + i * 9, y: 6 + j * 8 });
const kind = ref => ref[0];
const at = (x, y) => `X${Math.round(x * 1e6)}Y${Math.round(y * 1e6)}`;
/** 錫膏層：每顆零件的開孔，整體套轉換 tf（模擬鋼板檔座標系與座標檔不同） */
function pasteGerber(tf) {
  let g = "%FSLAX46Y46*%\n%MOMM*%\n%TF.FileFunction,Paste,Top*%\n%ADD10R,0.6X0.5*%\n%ADD11R,1.5X0.6*%\n";
  for (const p of PARTS) {
    g += kind(p.ref) === "R" ? "D10*\n" : "D11*\n";
    for (const [dx, dy] of FOOT[kind(p.ref)]) { const [x, y] = GERBER.layoutTransform(tf, p.x + dx, p.y + dy); g += `${at(x, y)}D03*\n`; }
  }
  return g + "M02*\n";
}
const OUTLINE = `%FSLAX46Y46*%\n%MOMM*%\n%TF.FileFunction,Profile,NP*%\n%ADD10C,0.1*%\nD10*\n${at(0, 0)}D02*\nG01*\n${at(62, 0)}D01*\n${at(62, 36)}D01*\n${at(0, 36)}D01*\n${at(0, 0)}D01*\nM02*\n`;
/** 一般格式量測檔：2 片板，每個焊墊一列 */
function spiCsv() {
  const lines = ["Board,RefDes,Pin,Volume,Height,Area"];
  for (const b of ["B1", "B2"]) for (const p of PARTS) FOOT[kind(p.ref)].forEach((_, k) => {
    const v = 100 + ((p.x * 7 + k * 13 + (b === "B2" ? 5 : 0)) % 17) - 8;
    lines.push(`${b},${p.ref},${k + 1},${v},${120 + (k % 3)},${98 + (k % 5)}`);
  });
  return lines.join("\n");
}
function importRows() {
  const tab = core.csvTable(spiCsv());
  const map = core.autoMap(tab.head);
  const place = { items: PARTS.map(p => ({ ref: p.ref, x: p.x, y: p.y, side: "TOP" })), controlled: true };
  return core.buildRows(tab, map, { side: "TOP", place }).rows;
}

test("受控座標匯入 → 套用錫膏層（平移＋鏡像）→ 每顆零件對上自己的焊墊", () => {
  const rows = importRows();
  assert.ok(rows.every(r => Number.isFinite(r.componentX)), "座標檔應寫入元件中心");
  const tf = { o: 4, tx: 140, ty: 12.5 };
  const paste = GERBER.parseGerber(pasteGerber(tf));
  const outline = GERBER.parseGerber(OUTLINE, { keepDraws: true });
  const info = core.buildLayoutInfo(rows, { paste, outline }, [{ id: "p", layer: "paste" }], "proof");
  assert.equal(info.level, "near");
  assert.deepEqual([info.tf.o, info.tf.tx, info.tf.ty], [4, 140, 12.5]);
  assert.equal(info.rate, 1);
  assert.equal(Object.keys(info.matched).length, PARTS.length);
  for (const p of PARTS) {
    const idx = info.matched[JSON.stringify(["", "comp", p.ref])], [ex, ey] = GERBER.layoutTransform(tf, p.x, p.y);
    const cx = idx.reduce((s, k) => s + info.geom.pads[k].x, 0) / idx.length, cy = idx.reduce((s, k) => s + info.geom.pads[k].y, 0) / idx.length;
    assert.ok(Math.hypot(cx - ex, cy - ey) < 1e-6, `${p.ref} 焊墊群中心`);
  }
  assert.equal(info.geom.outline.length, 4);
  assert.ok(info.geom.box.every(Number.isFinite));
  assert.match(core.layoutStatusText(info), /錫膏層 · 依零件標示；無法對應到單一焊墊 · 24 顆零件對上；已鏡像、平移 140, 12.5 mm/);
});

test("套用板面圖檔不改量測列：列內容與分析結果逐位元不變", () => {
  const rows = importRows();
  const a0 = JSON.stringify(core.analyze(baseState(core, { rows })));
  const before = JSON.stringify(rows); // analyze 會在列上補 hpct；於分析後取快照
  core.buildLayoutInfo(rows, { paste: GERBER.parseGerber(pasteGerber(null)) }, [], "lookup");
  assert.equal(JSON.stringify(rows), before);
  assert.ok(rows.every(r => !("fp" in r) && r.x == null && r.y == null), "依零件對應不寫入 x／y");
  assert.equal(JSON.stringify(core.analyze(baseState(core, { rows }))), a0);
  // 3D 讀取端：沒有真實焊墊座標時仍走元件中心，不因板面圖檔改變
  assert.ok(rows.every(r => !core.realXY(r)));
});

test("無關的圖檔不套用；只有板框不能標示焊墊", () => {
  const rows = importRows();
  let g = "%FSLAX46Y46*%\n%MOMM*%\n%ADD10C,0.4*%\nD10*\n";
  for (let i = 0; i < 200; i++) g += `${at((i * 37.3) % 90, (i * 61.7) % 70)}D03*\n`;
  const info = core.buildLayoutInfo(rows, { paste: GERBER.parseGerber(g + "M02*") }, [], "lookup");
  assert.equal(info.level, "none");
  assert.equal(Object.keys(info.matched).length, 0);
  assert.match(core.layoutStatusText(info), /對不上.*未套用/);
  const onlyOutline = core.buildLayoutInfo(rows, { outline: GERBER.parseGerber(OUTLINE, { keepDraws: true }) }, [], "lookup");
  assert.match(onlyOutline.error, /錫膏層或銅箔層/);
});

test("子板：座標檔不分子板時各子板共用同一份焊墊並在狀態列說明；鍵含子板", () => {
  const tab = core.csvTable(spiCsv().split("\n").map((l, i) => i ? l.replace(/^B(\d)/, (_, b) => `P1,${b}`) : "Panel,Figure,RefDes,Pin,Volume,Height,Area").join("\n"));
  const map = core.autoMap(tab.head);
  const place = { items: PARTS.map(p => ({ ref: p.ref, x: p.x, y: p.y, side: "TOP" })), controlled: true };
  const rows = core.buildRows(tab, map, { side: "TOP", place }).rows;
  assert.deepEqual([...new Set(rows.map(r => String(r.figure)))].sort(), ["1", "2"]);
  const info = core.buildLayoutInfo(rows, { paste: GERBER.parseGerber(pasteGerber(null)) }, [], "lookup");
  assert.equal(info.level, "near");
  assert.equal(info.rate, 1, "同位號同中心不得被判為焊墊重疊");
  const k1 = JSON.stringify([rows.find(r => String(r.figure) === "1").figure, "comp", "R1"]), k2 = JSON.stringify([rows.find(r => String(r.figure) === "2").figure, "comp", "R1"]);
  assert.ok(info.matched[k1] && info.matched[k2]);
  assert.equal(Object.keys(info.matched).length, PARTS.length * 2);
  assert.match(core.layoutStatusText(info), /座標檔不分子板，各子板標在同一份焊墊/);
});

test("銅箔層排除導通孔；錫膏層優先，銅箔層成為背景", () => {
  const rows = importRows();
  let cu = "%FSLAX46Y46*%\n%MOMM*%\n%TF.FileFunction,Copper,L1,Top*%\n%TA.AperFunction,SMDPad,CuDef*%\n%ADD10R,0.7X0.6*%\n%TA.AperFunction,ViaPad*%\n%ADD11C,0.45*%\n%TD*%\nD10*\n";
  for (const p of PARTS) for (const [dx, dy] of FOOT[kind(p.ref)]) cu += `${at(p.x + dx, p.y + dy)}D03*\n`;
  cu += "D11*\n";
  for (const p of PARTS) cu += `${at(p.x + 0.05, p.y + 0.9)}D03*\n`;
  const copper = GERBER.parseGerber(cu + "M02*\n");
  const onlyCu = core.buildLayoutInfo(rows, { copper }, [], "lookup");
  assert.equal(onlyCu.src, "copper");
  assert.equal(onlyCu.rate, 1, "導通孔不得被當成焊墊");
  const both = core.buildLayoutInfo(rows, { paste: GERBER.parseGerber(pasteGerber(null)), copper }, [], "lookup");
  assert.equal(both.src, "paste");
  assert.equal(both.geom.bg.length, copper.pads.length);
});
