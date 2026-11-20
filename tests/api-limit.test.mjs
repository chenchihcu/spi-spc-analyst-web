// 出處：2026-11-19 debug-loop 巡檢。GET /api/records?limit=2.5 回 503：
// D1／SQLite 的 LIMIT 不接受非整數（datatype mismatch）。repo 端把 limit 夾成 1–100 的整數。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHarness } from './_cloud-harness.mjs';

test('列表與座標檔清單的 limit 為非整數、負數、非數字時不回 5xx', async () => {
  const h = await createCloudHarness();
  try {
    for (const q of ['limit=2.5', 'limit=-3', 'limit=abc', 'limit=1e9', 'limit=0.4', 'places_for=P1&limit=2.5', 'places_for=P1&limit=0.5']) {
      const res = await h.fetch(`/api/records?${q}`);
      assert.equal(res.status, 200, `${q} 應回 200，實際 ${res.status}：${await res.clone().text()}`);
    }
    const list = await (await h.fetch('/api/records?limit=2.5')).json();
    assert.ok(Array.isArray(list.records), '回應應含 records 陣列');
  } finally { h.close(); }
});

test('repo 各清單查詢的 limit 夾成 1–100 的整數（搜尋、分享清單）', async () => {
  const h = await createCloudHarness();
  try {
    for (const lim of [2.5, NaN, -1, 1e9, '7', undefined]) {
      await h.repo.searchRecords('ab', lim);
      await h.repo.listShares({ all: true, limit: lim });
      await h.repo.listShares({ user: 'u', limit: lim });
      await h.repo.listRecords({ kind: 'meas', limit: lim });
      await h.repo.getPlacementsForPart('P1', null, '', null, null, lim);
    }
  } finally { h.close(); }
});

test('cursor 含空白／空字串／Infinity 時忽略並從第一頁查詢，不當成 created=0', async () => {
  const h = await createCloudHarness();
  try {
    await h.repo.createRecord({
      id: 'rec_test_1', user: 'u',
      kind: 'spi', lot: 'L1', part: 'P1', rev: 'A', side: 'TOP', name: 'a.csv',
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', bytes: 10,
    }, new Uint8Array([1, 2, 3]));
    for (const url of [
      '/api/records?cursor=,abc',
      '/api/records?cursor=%20%20,abc',
      '/api/records?cursor=Infinity,abc',
      '/api/records?q=P1&cursor=,abc',
    ]) {
      const res = await h.fetch(url);
      assert.equal(res.status, 200, `${url} 應回 200`);
      const body = await res.json();
      assert.equal(body.records.length, 1, `${url} 應回傳既有紀錄（不應把空時間戳當成 0）`);
      assert.equal(body.records[0].id, 'rec_test_1');
    }
  } finally { h.close(); }
});

test('audit beforeSeq 為空白、負數或小數時忽略游標（不寫入 WHERE a.seq < ?）', async () => {
  const h = await createCloudHarness();
  try {
    await h.repo.createRecord({
      id: 'rec_test_2', user: 'u',
      kind: 'spi', lot: 'L1', part: 'P1', rev: 'A', side: 'TOP', name: 'a.csv',
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', bytes: 10,
    }, new Uint8Array([1, 2, 3]));
    for (const before of ['   ', '-5', '1.5', '0', 'Infinity']) {
      const entries = await h.repo.listAuditLog(50, before);
      assert.equal(entries.length, 1, `before=${JSON.stringify(before)} 應忽略無效游標並回傳最新紀錄`);
    }
  } finally { h.close(); }
});

