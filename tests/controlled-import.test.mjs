import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCsv, validatePlacement, validateWideMeasurement, validateMeasurement, placementSizeError } from '../lib/controlled-import.mjs';

const fixtureRoot = 'C:/Users/user/Documents/x3000 spidata';
const samplePlace = `${fixtureRoot}/X3000 V5座標檔.csv`;
const sampleSpi = `${fixtureRoot}/301-000100124 TOP 量測紀錄.csv`;

test('座標單位明確為 mm，不依座標數值大小猜 mil', () => {
  const result = validatePlacement(parseCsv('RefDes,X,Y,Layer\nU1,6921.22,2524.37,L1-TOP\n'), { side: 'TOP', unit: 'mm' });
  assert.equal(result.items[0].x, 6921.22);
  assert.equal(result.factor, 1);
});

test('CSV 解析與前端一致地接受逗號、分號與 tab 分隔', () => {
  for (const sep of [',', ';', '\t']) {
    const table = parseCsv(`RefDes${sep}X${sep}Y${sep}Layer\nU1${sep}1${sep}2${sep}L1-TOP\n`);
    assert.equal(validatePlacement(table, { side: 'TOP', unit: 'mm' }).items.length, 1);
  }
});

test('同面重複才顯示重複位號；壞列與面別不一致各有自己的錯誤', () => {
  const head = 'RefDes,X,Y,Layer\n';
  const dup = validatePlacement(parseCsv(head + 'U1,1,2,L1-TOP\nU1,3,4,L1-TOP\n'), { side: 'TOP', unit: 'mm' });
  assert.equal(dup.code, 'duplicate_ref');
  assert.equal(dup.error, '上傳失敗：重複位號');
  assert.deepEqual(dup.detail.lines, [2, 3]);
  const both = validatePlacement(parseCsv(head + 'U1,1,2,L1-TOP\nU1,3,4,L2-BOT\n'), { side: 'BOTH', unit: 'mm' });
  assert.equal(both.items.length, 2);
  const incomplete = validatePlacement(parseCsv(head + 'U1,1,2,L1-TOP\nU2,,4,L1-TOP\n'), { side: 'TOP', unit: 'mm' });
  assert.equal(incomplete.code, 'incomplete');
  assert.doesNotMatch(incomplete.error, /重複位號/);
  const wrongSide = validatePlacement(parseCsv(head + 'U1,1,2,L2-BOT\n'), { side: 'TOP', unit: 'mm' });
  assert.equal(wrongSide.code, 'side');
});

test('通用格式精確比對完整位號，橫排 mm 格式辨識板序', () => {
  const place = validatePlacement(parseCsv('RefDes,X,Y,Layer\nU1,1,2,L1-TOP\n'), { side: 'TOP', unit: 'mm' });
  const generic = validateMeasurement(parseCsv('Board,Component ID,PAD ID,Side,Height\nB01,U1,1,TOP,90\n'), 'TOP', place);
  assert.equal(generic.boards, 1);
  assert.deepEqual(generic.missing, []);
  const mmWide = validateMeasurement(parseCsv('Component ID,PAD ID,Height(mm)1,Result1,Height(mm)2,Result2\nU1_1,1,0.09,PASS,0.1,PASS\n'), 'TOP', place);
  assert.equal(mmWide.boards, 2);
});

test('通用格式沿用既有 PanelId、FigureId 與 PinNo 欄名並以子板辨識量測點', () => {
  const place = validatePlacement(parseCsv('RefDes,X,Y,Layer\nU1,1,2,L1-TOP\n'), { side: 'TOP', unit: 'mm' });
  const rows = parseCsv('PanelId,FigureId,RefDes,PinNo,Volume\nP1,F1,U1,1,90\nP1,F2,U1,1,91\n');
  const result = validateMeasurement(rows, 'TOP', place);
  assert.equal(result.boards, 2);
  assert.equal(result.points, 2);
  assert.equal(result.pads, 1, '同一焊墊跨板量測只計一次');
  assert.deepEqual(result.missing, []);
});

test('量測值全空白的列與前端 buildRows 一樣不計入板數、焊墊數與量測點', () => {
  const place = validatePlacement(parseCsv('RefDes,X,Y,Layer\nU1,1,2,L1-TOP\n'), { side: 'TOP', unit: 'mm' });
  const generic = validateMeasurement(parseCsv('Board,RefDes,Pad,Volume\nB1,U1,1,100\nB2,U1,2,\nB3,R9,1,\n'), 'TOP', place);
  assert.deepEqual([generic.boards, generic.pads, generic.points], [1, 1, 1]);
  assert.deepEqual(generic.missing, [], '只有空白量測的位號不列為無座標');
  assert.equal(generic.measuredRefs, 1, '只有空白量測的位號不計入量測位號');
  const units = validateMeasurement(parseCsv('Board,RefDes,Pad,Height(µm),Offset X\nB1,U1,1,,\nB2,U1,1,,0.1\n'), 'TOP', place);
  assert.deepEqual([units.boards, units.points], [1, 1], '含單位與偏移欄名的量測欄也要辨識');
  const head = 'Component ID,PAD ID,Height(%)1,Volume(%)1,Area(%)1,Result1,Height(%)2,Volume(%)2,Area(%)2,Result2\n';
  const wide = validateWideMeasurement(parseCsv(head + 'U1_1,1,101,99,98,PASS,,,,\nU1_2,2,,,,,,,,\n'), 'TOP', place);
  assert.deepEqual([wide.boards, wide.pads, wide.points, wide.measuredRefs], [1, 1, 1, 1]);
  const allEmpty = validateMeasurement(parseCsv('Board,RefDes,Pad,Volume\nB1,U1,1,\n'), 'TOP', place);
  assert.equal(allEmpty.code, 'empty');
});

test('立榮錯位列只在第一板高度為焊墊號且量測欄空白時回收 PAD ID', () => {
  const place = validatePlacement(parseCsv('RefDes,X,Y,Layer\nG9,1,2,TOP\n'), { side: 'TOP', unit: 'mm' });
  const head = 'Component ID,Height(%)1,Volume(%)1,Area(%)1,PAD ID,Result1,Height(%)2,Volume(%)2,Area(%)2,Result2\n';
  const shifted = validateWideMeasurement(parseCsv(head + 'G9_1,1,,,,,104,106,99,PASS\n'), 'TOP', place);
  assert.equal(shifted.points, 1, '第一板空白，不建立假量測點');
  assert.equal(shifted.pads, 1);
  assert.deepEqual(shifted.missing, []);
  const damaged = validateWideMeasurement(parseCsv(head + 'G9_1,1,90,90,,,104,106,99,PASS\n'), 'TOP', place);
  assert.equal(damaged.code, 'incomplete_measurement', '第一板已有量測值時不可猜測 PAD ID');
});

test('樣本座標與 TOP 量測：20 板、7 個無座標位號、座標多出 79 個位號', { skip: !fs.existsSync(samplePlace) || !fs.existsSync(sampleSpi) }, () => {
  const place = validatePlacement(parseCsv(fs.readFileSync(samplePlace)), { side: 'BOTH', unit: 'mm' });
  assert.equal(place.items.length, 1000);
  assert.equal(place.items.filter(x => x.side === 'TOP').length, 728);
  const measured = validateWideMeasurement(parseCsv(fs.readFileSync(sampleSpi)), 'TOP', place);
  assert.equal(measured.boards, 20);
  assert.deepEqual(measured.missing, ['L87', 'R737', 'R738', 'R740', 'R741', 'R742', 'R743']);
  const measuredRefs = new Set(parseCsv(fs.readFileSync(sampleSpi)).data.map(row => row[0].replace(/_\d+$/, '')));
  assert.equal(place.items.filter(x => x.side === 'TOP' && !measuredRefs.has(x.ref)).length, 79);
  assert.equal(measured.measuredRefs, measuredRefs.size, '對應證明的量測位號數');
  assert.equal(measured.coordRefsOnSide, 728);
  assert.equal(measured.measuredRefs - measured.missing.length, 728 - 79, '有座標的量測位號＝座標此面位號扣掉未量測的');
});

test('新登錄座標檔：換算後板面超過 1000 mm 或小於 5 mm 時拒絕，單一元件不檢查', () => {
  const place = (rows, unit) => validatePlacement(parseCsv('RefDes,X,Y,Layer\n' + rows), { side: 'TOP', unit });
  // mil 檔誤選 mm：X 7431 → 7431 mm
  const milAsMm = place('U1,0,0,L1-TOP\nU2,7431,4761,L1-TOP\n', 'mm');
  assert.equal(placementSizeError(milAsMm.items, 'mm').code, 'unit_size');
  assert.match(placementSizeError(milAsMm.items, 'mm').error, /超過 1000 mm/);
  // 同一份數值選 mil：188.7 × 120.9 mm，通過
  assert.equal(placementSizeError(place('U1,0,0,L1-TOP\nU2,7431,4761,L1-TOP\n', 'mil').items, 'mil'), null);
  // inch 檔誤選 mm：3 × 2 inch 的板只剩 3 × 2 mm，小於 5 mm 拒絕；選 inch 則為 76 × 51 mm，通過
  assert.match(placementSizeError(place('U1,0,0,L1-TOP\nU2,3,2,L1-TOP\n', 'mm').items, 'mm').error, /小於 5 mm/);
  assert.equal(placementSizeError(place('U1,0,0,L1-TOP\nU2,3,2,L1-TOP\n', 'inch').items, 'inch'), null);
  // 單一元件無法判斷板面，不阻擋
  assert.equal(placementSizeError(place('U1,7431,4761,L1-TOP\n', 'mm').items, 'mm'), null);
});

test('樣本座標檔（X3000 V5）實際單位為 mil：mm 與 inch 被擋，mil 通過', { skip: !fs.existsSync(samplePlace) }, () => {
  const table = parseCsv(fs.readFileSync(samplePlace));
  const check = unit => placementSizeError(validatePlacement(table, { side: 'BOTH', unit }).items, unit);
  assert.equal(check('mm').code, 'unit_size');
  assert.equal(check('inch').code, 'unit_size');
  assert.equal(check('mil'), null);
});
