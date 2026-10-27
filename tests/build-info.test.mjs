import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, formatBuilt } from '../tools/build-cloudflare.mjs';
import { APP_VERSION, APP_BUILT } from '../lib/version.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const builtOf = (html) => (html.match(/id="appBuilt">([^<]+)</) || [])[1];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'spi-build-'));

test('更新時間以台北時間（UTC+8）格式化，跨日與 0 時正確', () => {
  assert.equal(formatBuilt(new Date('2026-10-27T06:55:52Z')), '2026-10-27 14:55:52');
  assert.equal(formatBuilt(new Date('2026-12-31T16:00:00Z')), '2027-01-01 00:00:00');
});

test('原始碼只保留預設時間，不在提交時寫入實際時間', () => {
  const html = fs.readFileSync(path.join(ROOT, 'spi-spc.html'), 'utf8');
  assert.equal(builtOf(html), APP_BUILT, '主頁與 lib/version.mjs 的預設值一致');
  assert.equal(APP_BUILT, '0000-00-00 00:00:00', '實際時間由 build 注入');
});

test('build 產物的主頁與 build-info 都寫入本次 build 時間', async () => {
  const dir = tmp();
  const before = formatBuilt(new Date());
  const { built } = await build({ out: path.join(dir, 'dist'), info: path.join(dir, 'build-info.mjs') });
  const after = formatBuilt(new Date());
  assert.ok(before <= built && built <= after, `build 時間 ${built} 應落在 ${before}～${after}`);
  assert.equal(builtOf(fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8')), built);
  const info = await import(pathToFileURL(path.join(dir, 'build-info.mjs')).href);
  assert.deepEqual({ ...info }, { APP_VERSION, APP_BUILT: built });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Worker 的登入頁（workerd 條件）與 build 產物主頁顯示同一個時間', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.imports['#build-info'], { workerd: './.build/build-info.mjs', default: './lib/version.mjs' });
  // 條件匯入固定指向 .build/build-info.mjs；測試後還原，避免蓋掉先前 build 準備部署的時間
  const infoPath = path.join(ROOT, '.build', 'build-info.mjs');
  const previous = fs.existsSync(infoPath) ? fs.readFileSync(infoPath) : null;
  const dir = tmp();
  try {
    const { built } = await build({ out: path.join(dir, 'dist'), now: new Date('2026-01-02T03:04:05Z') });
    assert.equal(built, '2026-01-02 11:04:05');
    const script = `const { loginPage } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'lib', 'auth-handler.mjs')).href)});
process.stdout.write(await loginPage('/').text());`;
    const r = spawnSync(process.execPath, ['--conditions=workerd', '--input-type=module', '-e', script], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(`${APP_VERSION} · 更新 ${built}`), '登入頁應顯示 build 時間');
    assert.equal(builtOf(fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8')), built);
  } finally {
    if (previous) fs.writeFileSync(infoPath, previous); else fs.rmSync(infoPath, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
