// 板面圖檔（kind=layout）雲端 API：登錄、唯一占用、權限、查詢、量測引用證明。規格：docs/spec-gerber-layout-rfc.md
import test from "node:test";
import assert from "node:assert/strict";
import { createCloudHarness } from "./_cloud-harness.mjs";
import { checkMeta } from "../lib/records-core.mjs";
import { Repo } from "../lib/repo.mjs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const at = (x, y) => `X${Math.round(x * 1e6)}Y${Math.round(y * 1e6)}`;
const gerber = (ff, pads) => `%FSLAX46Y46*%\n%MOMM*%\n%TF.FileFunction,${ff}*%\n%ADD10R,1.0X0.5*%\nD10*\n${pads.map(([x, y]) => `${at(x, y)}D03*`).join("\n")}\nM02*\n`;
const PASTE = gerber("Paste,Top", [[9.5, 20], [10.5, 20], [30, 40]]);
const PLACE_CSV = "RefDes,X,Y,Layer\nC1,10,20,TOP\n";
const WIDE = "Component ID,Height(%)1,Volume(%)1,Area(%)1,PAD ID,Result1,Height(%)2,Volume(%)2,Area(%)2,Result2\nC1_1,100,101,99,1,PASS,102,103,98,PASS\nC1_1,100,101,99,2,PASS,102,103,98,PASS\n";
const meta = (o = {}) => ({ kind: "layout", part: "LY-1", rev: "V1", side: "TOP", layer: "paste", name: "top.gtp", ...o });

test("checkMeta：板面圖檔必填版次、單一面別與圖層", () => {
  assert.match(checkMeta(meta({ rev: "" })).error, /版次/);
  assert.match(checkMeta(meta({ side: "BOTH" })).error, /面別/);
  assert.match(checkMeta(meta({ layer: "silk" })).error, /圖層/);
  assert.deepEqual(checkMeta(meta()).meta, { kind: "layout", part: "LY-1", name: "top.gtp", rev: "V1", side: "TOP", layer: "paste" });
});

test("登錄：伺服器輕量檢查、相同內容沿用、不同內容 409、非 Gerber 422", async () => {
  const cloud = await createCloudHarness();
  try {
    const res = await cloud.post(meta(), PASTE);
    assert.equal(res.status, 201);
    const rec = (await res.json()).record;
    const m = typeof rec.meta === "string" ? JSON.parse(rec.meta) : rec.meta;
    assert.deepEqual([rec.kind, rec.side, rec.lifecycle, rec.validationSource, m.layer, m.flashes, m.fileFunction], ["layout", "TOP", "active", "server_verified", "paste", 3, "Paste,Top"]);
    const row = cloud.db.prepare("SELECT kind, side, lifecycle, validation_source, meta FROM records WHERE id = ?").get(rec.id);
    assert.deepEqual([row.kind, row.side, row.lifecycle, row.validation_source, JSON.parse(row.meta).layer], ["layout", "TOP", "active", "server_verified", "paste"]);
    const again = await cloud.post(meta(), PASTE);
    assert.equal(again.status, 200);
    assert.equal((await again.json()).existing, rec.id);
    const other = await cloud.post(meta(), gerber("Paste,Top", [[1, 1], [20, 20]]));
    assert.equal(other.status, 409);
    assert.equal((await other.json()).code, "version_conflict");
    // 不同圖層、不同面別各自占用
    assert.equal((await cloud.post(meta({ layer: "copper" }), gerber("Copper,L1,Top", [[1, 1], [20, 20]]))).status, 201);
    assert.equal((await cloud.post(meta({ side: "BOT" }), gerber("Paste,Bot", [[1, 1], [20, 20]]))).status, 201);
    const bad = await cloud.post(meta({ rev: "V2" }), "RefDes,X,Y\nC1,1,2\n");
    assert.equal(bad.status, 422);
    assert.equal((await bad.json()).code, "not_gerber");
    const noUnit = await cloud.post(meta({ rev: "V2" }), "%FSLAX46Y46*%\nD10*\nX0Y0D03*\n");
    assert.equal((await noUnit.json()).code, "no_unit");
  } finally { cloud.close(); }
});

test("權限：非管理者不能登錄或刪除板面圖檔，可以查詢", async () => {
  const cloud = await createCloudHarness();
  try {
    assert.equal((await cloud.post(meta(), PASTE, true)).status, 403);
    const rec = await cloud.upload(meta(), PASTE);
    const list = await (await cloud.fetch("/api/records?layouts_for=LY-1&rev=V1&side=TOP", {}, true)).json();
    assert.deepEqual(list.layouts.map(l => l.id), [rec.id]);
    assert.equal(list.isAdmin, false);
    const del = await cloud.fetch(`/api/records?id=${rec.id}`, { method: "DELETE" }, true);
    assert.equal(del.status, 403);
    assert.equal((await cloud.fetch(`/api/records?id=${rec.id}`, { method: "DELETE" })).status, 200);
    const after = await (await cloud.fetch("/api/records?layouts_for=LY-1&rev=V1&side=TOP")).json();
    assert.deepEqual(after.layouts, []);
  } finally { cloud.close(); }
});

test("查詢：依料號、版次、面別篩選", async () => {
  const cloud = await createCloudHarness();
  try {
    const a = await cloud.upload(meta(), PASTE);
    const b = await cloud.upload(meta({ side: "BOT" }), gerber("Paste,Bot", [[1, 1], [20, 20]]));
    await cloud.upload(meta({ rev: "V2" }), gerber("Paste,Top", [[2, 2], [20, 20]]));
    const q = async s => (await (await cloud.fetch("/api/records?layouts_for=LY-1" + s)).json()).layouts.map(l => l.id).sort();
    assert.deepEqual(await q("&rev=V1&side=TOP"), [a.id]);
    assert.deepEqual(await q("&rev=V1"), [a.id, b.id].sort());
    assert.equal((await q("")).length, 3);
  } finally { cloud.close(); }
});

test("同時上傳同一範圍：寫入前檢查都放行時，較晚寫入者退出並回 409，只留一份", async () => {
  const cloud = await createCloudHarness();
  const orig = Repo.prototype.layoutScope;
  try {
    // 模擬另一個請求已通過檢查並先寫入：讓本次的寫入前檢查看不到它
    Repo.prototype.layoutScope = async () => null;
    const other = gerber("Paste,Top", [[1, 1], [20, 20]]), raw = Buffer.from(other);
    const first = await cloud.repo.createRecord({ id: "concurrentlayout000001", kind: "layout", part: "LY-1", rev: "V1", side: "TOP", name: "a.gtp",
      bytes: raw.length, gz_bytes: 0, sha256: createHash("sha256").update(raw).digest("hex"), user: "admin@example.test", created: Date.now(),
      validationSource: "server_verified", lifecycle: "active", meta: { layer: "paste" } }, gzipSync(raw));
    assert.ok(first.record);
    const res = await cloud.post(meta(), PASTE);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).existing, "concurrentlayout000001");
    const left = cloud.db.prepare("SELECT id FROM records WHERE kind = 'layout'").all().map(r => r.id);
    assert.deepEqual(left, ["concurrentlayout000001"]);
  } finally { Repo.prototype.layoutScope = orig; cloud.close(); }
});

test("量測上傳引用板面圖檔：寫入 layoutProof；料號版次面別不符拒絕", async () => {
  const cloud = await createCloudHarness();
  try {
    const place = await cloud.upload({ kind: "place", part: "LY-1", rev: "V1", side: "TOP", unit: "mm", name: "p.csv" }, PLACE_CSV);
    const paste = await cloud.upload(meta(), PASTE);
    const otherRev = await cloud.upload(meta({ rev: "V9" }), PASTE);
    const spiMeta = { kind: "spi", part: "LY-1", rev: "V1", side: "TOP", placeId: place.id, workOrder: "WO-1", lot: "L", name: "m.csv", vendor: "lirong" };
    const bad = await cloud.post({ ...spiMeta, layoutIds: [otherRev.id] }, WIDE);
    assert.equal(bad.status, 409);
    assert.equal((await bad.json()).code, "layout_mismatch");
    const spi = await cloud.upload({ ...spiMeta, layoutIds: [paste.id] }, WIDE);
    const m = typeof spi.meta === "string" ? JSON.parse(spi.meta) : spi.meta;
    assert.deepEqual(m.layoutProof, [{ id: paste.id, sha256: paste.sha256, layer: "paste" }]);
    assert.equal(m.placeProof.placeId, place.id);
    assert.equal(m.layoutIds, undefined);
  } finally { cloud.close(); }
});
