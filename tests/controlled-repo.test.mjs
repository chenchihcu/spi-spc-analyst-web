import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../lib/repo.mjs';
import { handleRequest } from '../cloudflare/worker.mjs';
import { issueToken, COOKIE } from '../lib/auth-handler.mjs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../cloudflare/migrations/0002_free_plan_schema.sql', import.meta.url), 'utf8'));
  db.exec(fs.readFileSync(new URL('../cloudflare/migrations/0007_controlled_coordinate_import.sql', import.meta.url), 'utf8'));
  const wrap = (sql, args = []) => ({
    bind(...values) { return wrap(sql, values); },
    first() { return db.prepare(sql).get(...args) || null; },
    all() { return { results: db.prepare(sql).all(...args) }; },
    run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; },
  });
  return {
    prepare: sql => wrap(sql),
    batch(stmts) { db.exec('BEGIN'); try { const result = stmts.map(s => s.run()); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; } },
    raw: db,
  };
}
function bucket() {
  const objects = new Map();
  return { objects, put: async (key, value) => { objects.set(key, value); },
    get: async key => objects.has(key) ? { arrayBuffer: async () => objects.get(key) } : null,
    delete: async key => { objects.delete(key); } };
}
const id = n => `record_${String(n).padStart(15, '0')}`;
const place = (n, side = 'TOP', sha = String(n)) => ({ id: id(n), kind: 'place', part: 'P', rev: 'V5', side,
  sides: side === 'BOTH' ? ['TOP', 'BOT'] : [side], unit: 'mm', factor: 1, formatVersion: 1,
  validationSource: 'server_verified', lifecycle: 'active', sha256: sha, user: 'admin@example.com', bytes: 10, created: n });
const spi = (n, sha, workOrder, measuredDate = '') => ({ id: id(n), kind: 'spi', part: 'P', rev: 'V5', side: 'TOP',
  placeId: id(1), workOrder, measuredDate, validationSource: 'server_verified', lifecycle: 'active',
  sha256: sha, user: 'user@example.com', bytes: 10, created: n });

test('migration and version occupancy preserve original R2 file on conflict', async () => {
  const db = database(), r2 = bucket(), repo = new Repo(db, r2);
  const first = await repo.createRecord(place(1), new Uint8Array([1]));
  assert.equal(first.record.id, id(1));
  assert.equal((await repo.coordinateScope('P', 'V5', 'TOP')).id, id(1));
  const exact = await repo.createRecord(place(2, 'TOP', '1'), new Uint8Array([2]));
  assert.equal(exact.existing, id(1));
  assert.equal(exact.status, 200);
  const conflict = await repo.createRecord(place(3), new Uint8Array([3]));
  assert.equal(conflict.status, 409);
  assert.equal(r2.objects.has(`records/${id(3)}`), false);
  assert.equal((await repo.getRecord(id(3))), null);
});

test('並行上傳同版座標只建立一份受控內容，衝突檔不留 R2 物件', async () => {
  const db = database(), r2 = bucket(), repo = new Repo(db, r2);
  const results = await Promise.all([
    repo.createRecord(place(41, 'BOTH', 'a'), new Uint8Array([41])),
    repo.createRecord(place(42, 'TOP', 'b'), new Uint8Array([42])),
  ]);
  assert.deepEqual(results.map(x => x.status || 201).sort(), [201, 409]);
  const winners = [id(41), id(42)].filter(x => r2.objects.has(`records/${x}`));
  assert.equal(winners.length, 1);
  assert.equal((await repo.coordinateScope('P', 'V5', 'TOP')).id, winners[0]);
});

test('座標庫超過 100 份仍可用游標讀取，不以首頁判定不存在', async () => {
  const repo = new Repo(database(), bucket());
  for (let n = 1; n <= 102; n++) await repo.createRecord({ ...place(n), rev: `V${n}` }, new Uint8Array([n]));
  const first = await repo.getPlacementsForPart('P', 'TOP', '', null, null, 100);
  assert.equal(first.placements.length, 100);
  assert.ok(first.next);
  const [created, cursorId] = first.next.split(',');
  const second = await repo.getPlacementsForPart('P', 'TOP', '', +created, cursorId, 100);
  assert.equal(second.placements.length, 2);
  assert.equal(second.next, null);
  assert.ok(second.placements.some(row => row.rev === 'V1'));
});

test('measurement fingerprint ignores work-order changes; related different file can be reviewed and corrected once', async () => {
  const db = database(), r2 = bucket(), repo = new Repo(db, r2);
  await repo.bootstrapAdmin('admin@example.com', true, 1);
  await repo.createRecord(place(1), new Uint8Array([1]));
  const a = await repo.createRecord(spi(10, 'sha-a', 'WO-1'), new Uint8Array([10]));
  assert.equal(a.record.lifecycle, 'active');
  assert.equal((await repo.measurementFingerprint('P', 'V5', 'TOP', 'sha-a')).id, id(10));
  const related = await repo.relatedMeasurements('P', 'V5', 'TOP', 'WO-1', '');
  assert.deepEqual(related.map(r => r.id), [id(10)]);
  const concurrentDecision = await repo.createRecord(spi(13, 'sha-d', 'WO-1'), new Uint8Array([13]));
  assert.equal(concurrentDecision.record.lifecycle, 'pending_review', '寫入時重新判斷相關紀錄');
  const replacement = { ...spi(11, 'sha-b', 'WO-1'), lifecycle: 'pending_review' };
  await repo.createRecord(replacement, new Uint8Array([11]));
  assert.equal((await repo.judgeMeasurement(id(11), 'correct', id(10), 'admin@example.com')).ok, true);
  assert.equal((await repo.getRecord(id(10))).lifecycle, 'superseded');
  assert.equal((await repo.getRecord(id(11))).lifecycle, 'active');
  assert.equal((await repo.deleteRecord(id(10), 'admin@example.com')).ok, true);
  assert.equal(r2.objects.has(`records/${id(10)}`), false);
  assert.equal(await repo.getRecord(id(10)), null);
  const another = { ...spi(12, 'sha-c', 'WO-1'), lifecycle: 'pending_review' };
  await repo.createRecord(another, new Uint8Array([12]));
  assert.equal((await repo.judgeMeasurement(id(12), 'correct', id(10), 'admin@example.com')).status, 409);
  assert.equal((await repo.getRecord(id(12))).lifecycle, 'pending_review');
});

test('admin delete place removes scope row, raw file, and audit entry; non-admin forbidden', async () => {
  const db = database(), r2 = bucket(), repo = new Repo(db, r2);
  await repo.bootstrapAdmin('admin@example.com', true, 1);
  await repo.createRecord(place(1), new Uint8Array([1]));
  await repo.createRecord(spi(10, 'sha-a', 'WO-1'), new Uint8Array([10]));
  assert.equal((await repo.deleteRecord(id(1), 'user@example.com')).status, 403);
  assert.equal((await repo.deleteRecord(id(1), 'admin@example.com')).ok, true);
  assert.equal((await repo.getRecord(id(1))), null);
  assert.equal((await repo.coordinateScope('P', 'V5', 'TOP')), null);
  assert.equal(r2.objects.has(`records/${id(1)}`), false);
  const spiRec = await repo.getRecord(id(10));
  assert.equal(spiRec.place_id, id(1), '引用 place_id 保留');
});

test('archive retains coordinate scope and raw file for history while excluding new selection', async () => {
  const db = database(), r2 = bucket(), repo = new Repo(db, r2);
  await repo.createRecord(place(1, 'BOTH'), new Uint8Array([1]));
  assert.equal((await repo.coordinateScope('P', 'V5', 'BOT')).id, id(1));
  assert.equal((await repo.archivePlacement(id(1), 'admin@example.com')).ok, true);
  assert.equal((await repo.getPlacementsForPart('P', 'TOP', 'V5')).placements.length, 0);
  assert.equal((await repo.coordinateScope('P', 'V5', 'TOP')).id, id(1));
  assert.equal(r2.objects.has(`records/${id(1)}`), true);
});

test('管理角色只初始化一次，撤權後立即失效，最後一位可登入管理者不可撤銷', async () => {
  const db = database(), repo = new Repo(db, bucket());
  await repo.bootstrapAdmin('admin@example.com', true, 100);
  assert.equal(await repo.isAdmin('admin@example.com'), true);
  assert.equal((await repo.setAdminRole('admin@example.com', false, 'admin@example.com', ['admin@example.com', 'other@example.com'])).status, 409);
  assert.equal((await repo.setAdminRole('other@example.com', true, 'admin@example.com', ['admin@example.com', 'other@example.com'])).ok, true);
  assert.equal((await repo.setAdminRole('admin@example.com', false, 'other@example.com', ['admin@example.com', 'other@example.com'])).ok, true);
  assert.equal(await repo.isAdmin('admin@example.com'), false);
  await repo.bootstrapAdmin('admin@example.com', true, 200);
  assert.equal(await repo.isAdmin('admin@example.com'), false);
  assert.equal(await repo.isAdmin('other@example.com'), true);
});

function apiHarness() {
  const db = database(), r2 = bucket();
  const env = { DB: db, BLOBS: r2, ASSETS: { fetch: async () => new Response('ok') },
    AUTH_USERS: JSON.stringify({ 'admin@example.com': `pepper-hmac-sha256$600000$${'a'.repeat(64)}`,
      'user@example.com': `pepper-hmac-sha256$600000$${'b'.repeat(64)}` }),
    AUTH_PEPPER: 'p'.repeat(40), AUTH_SECRET: 's'.repeat(40), AUTH_KDF_ITER: '600000',
    INITIAL_ADMIN_USER: 'admin@example.com' };
  const cookie = async user => `${COOKIE}=${await issueToken(env, user)}`;
  const upload = async (user, meta, source) => {
    const raw = Buffer.from(source), sha = createHash('sha256').update(raw).digest('hex');
    return handleRequest(new Request('https://spi.test/api/records', { method: 'POST', headers: {
      cookie: await cookie(user), origin: 'https://spi.test', 'content-type': 'application/gzip',
      'x-rec-meta': encodeURIComponent(JSON.stringify(meta)), 'x-raw-bytes': String(raw.length), 'x-raw-sha256': sha,
    }, body: gzipSync(raw) }), env);
  };
  const linkCheck = async (recordId, user = 'user@example.com') => handleRequest(new Request(
    `https://spi.test/api/records?link_check=${recordId}`, { headers: { cookie: await cookie(user) } }), env);
  return { db, r2, env, cookie, upload, linkCheck };
}

test('authenticated API enforces admin upload, server validation, unmatched confirmation and pending review', async () => {
  const { db, r2, env, cookie, upload } = apiHarness();
  const placeMeta = { kind: 'place', part: 'P', rev: 'V5', side: 'TOP', unit: 'mm', name: 'p.csv' };
  const placeCsv = 'RefDes,X,Y,Layer\nU1,1,2,L1-TOP\n';
  const nonAdminRoles = await handleRequest(new Request('https://spi.test/api/admin/users', {
    headers: { cookie: await cookie('user@example.com') },
  }), env);
  assert.equal(nonAdminRoles.status, 403);
  assert.equal((await upload('user@example.com', placeMeta, placeCsv)).status, 403);
  const created = await upload('admin@example.com', { ...placeMeta, comps: 999 }, placeCsv);
  assert.equal(created.status, 201);
  const placeRecord = (await created.json()).record;
  assert.equal(placeRecord.comps, 1, '伺服器解析值覆蓋不可信的上傳計數');
  const placeId = placeRecord.id;
  assert.equal((await upload('admin@example.com', placeMeta, placeCsv)).status, 200);
  const spiMeta = { kind: 'spi', part: 'P', rev: 'V5', side: 'TOP', placeId, workOrder: 'WO-1', name: 'm.csv' };
  assert.equal((await upload('user@example.com', { ...spiMeta, measuredDate: '2026-02-30' },
    'Component ID,PAD ID,Height(%)1\nU1_1,1,90\n')).status, 422);
  const spiCsv = 'Component ID,PAD ID,Height(%)1,Result1\nU1_1,1,88,PASS\nR1_1,1,90,PASS\n';
  const needsConfirm = await upload('user@example.com', spiMeta, spiCsv);
  assert.equal(needsConfirm.status, 422);
  assert.deepEqual((await needsConfirm.json()).missing, ['R1']);
  const accepted = await upload('user@example.com', { ...spiMeta, boards: 999, pads: 999, rows: 999,
    unmatchedConfirmed: true, unmatchedRefs: ['R1'] }, spiCsv);
  assert.equal(accepted.status, 201);
  const acceptedRecord = (await accepted.json()).record;
  assert.deepEqual([acceptedRecord.boards, acceptedRecord.pads, acceptedRecord.rows], [1, 2, 2]);
  const acceptedId = acceptedRecord.id;
  const same = await upload('user@example.com', { ...spiMeta, workOrder: 'WO-2', unmatchedConfirmed: true, unmatchedRefs: ['R1'] }, spiCsv);
  assert.equal(same.status, 409);
  assert.equal((await same.json()).existing, acceptedId);
  const related = await upload('user@example.com', { ...spiMeta, unmatchedConfirmed: true, unmatchedRefs: ['R1'] }, spiCsv.replace('90', '91'));
  assert.equal(related.status, 202);
  assert.equal((await related.json()).record.lifecycle, 'pending_review');
  const oldRaw = Buffer.from('RefDes,X,Y,Layer\nC1,1,2,L1-TOP\n');
  const old = { id: id(90), kind: 'place', part: 'unverified', rev: 'old', side: 'TOP', name: 'old.csv',
    sha256: createHash('sha256').update(oldRaw).digest('hex'), bytes: oldRaw.length, user: 'user@example.com' };
  await new Repo(db, r2).createRecord(old, gzipSync(oldRaw));
  const promote = await handleRequest(new Request('https://spi.test/api/records', { method: 'PATCH', headers: {
    cookie: await cookie('admin@example.com'), origin: 'https://spi.test', 'content-type': 'application/json',
  }, body: JSON.stringify({ action: 'register_legacy_place', id: old.id, part: 'P-OLD', rev: 'V1', side: 'TOP', unit: 'mm' }) }), env);
  assert.equal(promote.status, 201);
  assert.equal((await new Repo(db, r2).getRecord(old.id)).validation_source, 'legacy');
  assert.equal((await new Repo(db, r2).coordinateScope('P-OLD', 'V1', 'TOP')).validation_source, 'server_verified');
});

test('對應證明：上傳寫入伺服器快照，link_check 重算指紋、身分與位號', async () => {
  const { db, r2, upload, linkCheck } = apiHarness();
  const placeCsv = 'RefDes,X,Y,Layer\nU1,10,20,L1-TOP\nC9,30,40,L1-TOP\nR1,50,60,L1-BOT\n';
  const placeRecord = (await (await upload('admin@example.com', { kind: 'place', part: 'P', rev: 'V5', side: 'BOTH', unit: 'mm', name: 'p.csv' }, placeCsv)).json()).record;
  const spiCsv = 'Component ID,PAD ID,Height(%)1,Result1\nU1_1,1,88,PASS\nU1_1,2,89,PASS\nR1_1,1,90,PASS\nQ7_1,1,91,PASS\n';
  const meta = { kind: 'spi', part: 'P', rev: 'V5', side: 'TOP', placeId: placeRecord.id, workOrder: 'WO-1', name: 'm.csv',
    unmatchedConfirmed: true, unmatchedRefs: ['Q7', 'R1'],
    placeProof: { placeId: 'forged_forged_forged00', sha256: 'f'.repeat(64), matchedRefs: 999 } };
  const created = await upload('user@example.com', meta, spiCsv);
  assert.equal(created.status, 201);
  const rec = (await created.json()).record;
  const proof = JSON.parse((await new Repo(db, r2).getRecord(rec.id)).meta).placeProof;
  assert.deepEqual({ ...proof, at: undefined }, { placeId: placeRecord.id, sha256: placeRecord.sha256, part: 'P', rev: 'V5', side: 'BOTH',
    unit: 'mm', measuredSide: 'TOP', measuredRefs: 3, matchedRefs: 1, coordRefsOnSide: 2, at: undefined }, '偽造的快照被伺服器值覆蓋');
  assert.equal(proof.at, rec.created);

  const ok = await (await linkCheck(rec.id)).json();
  assert.equal(ok.linked, true);
  assert.equal(ok.measurement.shaOk, true);
  assert.equal(ok.place.shaOk, true);
  assert.deepEqual(ok.identity, { partOk: true, revOk: true, sideOk: true, proofPlaceIdOk: true });
  assert.deepEqual(ok.snapshot, { present: true, shaOk: true });
  assert.deepEqual([ok.refs.measured, ok.refs.matched, ok.refs.coordOnSide], [3, 1, 2]);
  assert.deepEqual(ok.refs.missing, ['Q7', 'R1']);
  assert.deepEqual(ok.refs.wrongSide, ['R1']);
  assert.equal(ok.refs.unmatchedConsistent, true);

  // 已確認的無座標位號和重算結果不同：只影響一致性，不影響指紋
  db.raw.prepare(`UPDATE records SET unmatched_refs = '["Q7"]' WHERE id = ?`).run(rec.id);
  assert.equal((await (await linkCheck(rec.id)).json()).refs.unmatchedConsistent, false);

  // 竄改 R2 座標原檔
  r2.objects.set(`records/${placeRecord.id}`, gzipSync(Buffer.from(placeCsv.replace('U1,10,20', 'U1,90,90'))));
  const tampered = await (await linkCheck(rec.id)).json();
  assert.equal(tampered.place.shaOk, false);
  assert.equal(tampered.place.error, '受控座標原始檔指紋不符');
  assert.equal(tampered.snapshot.shaOk, false);
  assert.ok(tampered.refs.error);

  // 座標原檔遺失
  r2.objects.delete(`records/${placeRecord.id}`);
  const gone = await (await linkCheck(rec.id)).json();
  assert.deepEqual([gone.place, gone.placeMissing], [null, 'file']);

  assert.equal((await linkCheck(placeRecord.id)).status, 404, '座標檔不是量測紀錄');
  assert.equal((await linkCheck('record_000000000000404')).status, 404);
});

test('對應證明：未登入不可呼叫 link_check', async () => {
  const { env } = apiHarness();
  const res = await handleRequest(new Request(`https://spi.test/api/records?link_check=${id(1)}`), env);
  assert.equal(res.status, 401);
});

test('對應證明：沒有快照的受控紀錄照常重算，指向不存在座標的紀錄回報 place:null', async () => {
  const { db, r2, linkCheck } = apiHarness();
  const repo = new Repo(db, r2);
  const placeRaw = Buffer.from('RefDes,X,Y,Layer\nU1,1,2,L1-TOP\n'), spiRaw = Buffer.from('Component ID,PAD ID,Height(%)1\nU1_1,1,88\n');
  const sha = b => createHash('sha256').update(b).digest('hex');
  await repo.createRecord({ ...place(1), sha256: sha(placeRaw), name: 'p.csv' }, gzipSync(placeRaw));
  await repo.createRecord({ ...spi(2, sha(spiRaw), 'WO-1'), name: 'm.csv' }, gzipSync(spiRaw));
  const old = await (await linkCheck(id(2))).json();
  assert.deepEqual(old.snapshot, { present: false, shaOk: null });
  assert.equal(old.identity.proofPlaceIdOk, null);
  assert.equal(old.place.shaOk, true);
  assert.equal(old.refs.matched, 1);
  assert.equal(old.refs.unmatchedConsistent, true);
  await repo.createRecord({ ...spi(3, 'x'.repeat(64), 'WO-2'), placeId: 'missingplace0000000000', name: 'm.csv' }, gzipSync(spiRaw));
  const missing = await (await linkCheck(id(3))).json();
  assert.deepEqual([missing.place, missing.placeMissing, missing.measurement.shaOk], [null, 'record', false]);
});

test('重新受控匯入：原檔指紋必須等於舊紀錄，舊紀錄保留並可查到新紀錄', async () => {
  const { db, r2, upload, linkCheck } = apiHarness();
  const repo = new Repo(db, r2);
  const placeRecord = (await (await upload('admin@example.com', { kind: 'place', part: 'P', rev: 'V5', side: 'TOP', unit: 'mm', name: 'p.csv' },
    'RefDes,X,Y,Layer\nU1,1,2,L1-TOP\n')).json()).record;
  const spiCsv = 'Component ID,PAD ID,Height(%)1\nU1_1,1,88\n', raw = Buffer.from(spiCsv);
  const legacy = { id: id(70), kind: 'spi', part: 'P', lot: 'L1', side: 'TOP', name: 'old.csv', user: 'user@example.com', created: 70,
    sha256: createHash('sha256').update(raw).digest('hex'), bytes: raw.length };
  await repo.createRecord(legacy, gzipSync(raw));
  const legacyCheck = await (await linkCheck(legacy.id)).json();
  assert.deepEqual([legacyCheck.linked, legacyCheck.reimportedAs, legacyCheck.measurement.shaOk], [false, [], true]);
  const meta = { kind: 'spi', part: 'P', rev: 'V5', side: 'TOP', placeId: placeRecord.id, workOrder: 'WO-9', name: 'old.csv' };
  const codeOf = async res => [res.status, (await res.json()).code];
  assert.deepEqual(await codeOf(await upload('user@example.com', { ...meta, sourceLegacyId: id(71) }, spiCsv)), [422, 'legacy_source_missing']);
  assert.deepEqual(await codeOf(await upload('user@example.com', { ...meta, sourceLegacyId: placeRecord.id }, spiCsv)), [422, 'legacy_source_invalid']);
  assert.deepEqual(await codeOf(await upload('user@example.com', { ...meta, sourceLegacyId: legacy.id }, spiCsv.replace('88', '87'))), [422, 'legacy_source_mismatch']);
  const created = await upload('user@example.com', { ...meta, sourceLegacyId: legacy.id }, spiCsv);
  assert.equal(created.status, 201);
  const rec = (await created.json()).record;
  assert.equal(JSON.parse((await repo.getRecord(rec.id)).meta).sourceLegacyId, legacy.id);
  const after = await repo.getRecord(legacy.id);
  assert.deepEqual([after.validation_source, after.lifecycle, after.place_id || ''], ['legacy', 'legacy', '']);
  assert.deepEqual((await (await linkCheck(legacy.id)).json()).reimportedAs.map(r => r.id), [rec.id]);
  assert.equal((await (await linkCheck(rec.id)).json()).refs.matched, 1);
});

test('管理者硬刪 place 釋放占用、spi 的 place_id 不變', async () => {
  const db = database(), r2 = bucket(), repo = new Repo(db, r2);
  await repo.bootstrapAdmin('admin@example.com', true, 1);
  await repo.createRecord(place(1), new Uint8Array([1]));
  await repo.createRecord(spi(10, 'sha-a', 'WO-1'), new Uint8Array([10]));
  assert.equal((await repo.coordinateScope('P', 'V5', 'TOP')).id, id(1));
  assert.equal((await repo.deleteRecord(id(1), 'admin@example.com')).ok, true);
  assert.equal(await repo.coordinateScope('P', 'V5', 'TOP'), null);
  const spiRow = await repo.getRecord(id(10));
  assert.equal(spiRow.place_id || spiRow.placeId, id(1));
  assert.equal((await repo.deleteRecord(id(10), 'admin@example.com')).ok, true);
  assert.equal(await repo.getRecord(id(10)), null);
  assert.equal(r2.objects.has(`records/${id(10)}`), false);
});
