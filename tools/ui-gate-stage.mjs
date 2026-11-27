#!/usr/bin/env node
/**
 * UI gate prepare: isolated Worker stage (mirrors verify-spi-spc scratch layout).
 * Env: STATE_DIR (D1 persist), optional UI_GATE_RUN_DIR (default .ui-gate/run/stage).
 */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveClientD, hashPasswordRecord } from './hash-password.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = process.env.STATE_DIR;
if (!stateDir) {
  console.error('ui-gate-stage: STATE_DIR is required');
  process.exit(1);
}
const runRoot = resolve(process.env.UI_GATE_RUN_DIR || join(root, '.ui-gate/run'));
const stage = join(runRoot, 'stage');
const distSrc = join(root, process.env.UI_GATE_DIST || 'dist');
const wranglerBin = join(root, 'node_modules/wrangler/bin/wrangler.js');

async function main() {
  await mkdir(stage, { recursive: true });
  for (const folder of ['cloudflare', 'lib']) {
    await cp(join(root, folder), join(stage, folder), { force: true, recursive: true });
  }
  await cp(join(root, 'package.json'), join(stage, 'package.json'));
  if (!existsSync(distSrc)) {
    console.error(`ui-gate-stage: missing build output at ${distSrc}; run build first`);
    process.exit(1);
  }
  await cp(distSrc, join(stage, 'dist'), { force: true, recursive: true });
  const buildInfo = join(root, '.build');
  if (existsSync(buildInfo)) {
    await cp(buildInfo, join(stage, '.build'), { force: true, recursive: true });
  }

  const source = JSON.parse(readFileSync(join(root, 'wrangler.jsonc'), 'utf8'));
  const iter = Number(source.vars?.AUTH_KDF_ITER || 600000);
  const config = {
    main: source.main,
    compatibility_date: source.compatibility_date,
    assets: {
      directory: './dist',
      binding: 'ASSETS',
      run_worker_first: ['/*', '!/vendor/*'],
    },
    ratelimits: source.ratelimits,
    name: 'spi-spc-ui-gate',
    vars: { AUTH_KDF_ITER: String(iter), AI_ENABLED: 'false' },
    d1_databases: [{ binding: 'DB', database_name: 'spi-spc', database_id: randomUUID(), migrations_dir: 'cloudflare/migrations' }],
    r2_buckets: [{ binding: 'BLOBS', bucket_name: 'spi-spc-ui-gate' }],
  };
  if (source.compatibility_flags) config.compatibility_flags = source.compatibility_flags;
  await writeFile(join(stage, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n');

  const user = 'ui-gate@example.invalid';
  const password = randomBytes(24).toString('hex');
  const pepper = randomBytes(32).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const digest = await deriveClientD(user, password, iter);
  const authUsers = { [user]: await hashPasswordRecord(digest, pepper, iter) };
  const devVars = [
    `AUTH_USERS='${JSON.stringify(authUsers)}'`,
    `AUTH_PEPPER=${pepper}`,
    `AUTH_SECRET=${secret}`,
    `INITIAL_ADMIN_USER=${user}`,
  ].join('\n');
  await writeFile(join(stage, '.dev.vars'), devVars, { mode: 0o600 });

  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  let built = '';
  const builtInfo = join(root, '.build/build-info.mjs');
  if (existsSync(builtInfo)) {
    const mod = await import(builtInfo);
    built = mod.APP_BUILT || '';
  }
  await writeFile(
    join(runRoot, 'credentials.json'),
    JSON.stringify({ user, password, built, version: pkg.version }, null, 2) + '\n',
    { mode: 0o600 },
  );

  const mig = spawnSync(
    process.execPath,
    [wranglerBin, 'd1', 'migrations', 'apply', 'spi-spc', '--config', 'wrangler.json', '--local', '--persist-to', stateDir],
    {
      cwd: stage,
      env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
      stdio: 'inherit',
    },
  );
  if (mig.status !== 0) {
    process.exit(mig.status || 1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});