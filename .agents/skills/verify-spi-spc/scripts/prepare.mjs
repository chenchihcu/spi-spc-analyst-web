// Invoked by verify.py in a fresh, run-owned directory.
import { build } from '../../../../tools/build-cloudflare.mjs';
import { deriveClientD, hashPasswordRecord } from '../../../../tools/hash-password.mjs';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (process.stdout.isTTY) throw new Error('Invoke verify.py to create a private run.');
const config = JSON.parse(await readFile('wrangler.json', 'utf8'));
if (config.name !== 'spi-spc-verify') throw new Error('Expected an isolated verification project.');
const iterations = Number(config.vars.AUTH_KDF_ITER);
const user = 'verify@example.invalid';
const password = randomBytes(32).toString('hex');
const pepper = randomBytes(32).toString('hex');
const secret = randomBytes(32).toString('hex');
const digest = await deriveClientD(user, password, iterations);
const authUsers = { [user]: await hashPasswordRecord(digest, pepper, iterations) };
const bindings = {
  AUTH_USERS: "'" + JSON.stringify(authUsers) + "'",
  AUTH_PEPPER: pepper,
  AUTH_SECRET: secret
};
const vars = Object.entries(bindings).map(([name, value]) => name + '=' + value);
await writeFile('.dev.vars', vars.join('\n'), { flag: 'wx', mode: 0o600 });
const { built } = await build({ out: resolve('dist'), info: resolve('.build/build-info.mjs') });
// Private pipe to the parent; never print this on a terminal.
process.stdout.write(JSON.stringify({ user, password, built }));
