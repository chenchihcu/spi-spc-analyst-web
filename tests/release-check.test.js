const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'tools/release-check.js'), 'utf8');

// Exercise the real orchestration without recursively launching this test suite.
function run(args, { testFailure = false, secret = false, htmlOverride = null } = {}) {
  let tests = 0, scans = 0, result, exit;
  const fakeFs = Object.create(fs);
  fakeFs.readFileSync = (file, ...rest) => String(file).endsWith('release-sentinel.txt')
    ? 'sk-' + 'A'.repeat(24)
    : htmlOverride !== null && String(file).endsWith('spi-spc.html') ? htmlOverride : fs.readFileSync(file, ...rest);
  vm.runInNewContext(source, {
    __dirname: path.join(root, 'tools'),
    require(name) {
      if (name === 'fs') return fakeFs;
      if (name === 'path') return path;
      if (name === 'child_process') return { execSync(command) {
        if (command === 'node tools/ui-gate-run.mjs --check --json') {
          return JSON.stringify({ gated: true, triggered: false, valid: true, reason: 'no watched change vs base' });
        }
        if (command.startsWith('node --test ')) {
          tests++;
          if (testFailure) throw Object.assign(new Error('test failure'), { status: 1, stdout: '# fail 1\nnot ok 1 - sentinel' });
          return '# pass 3\n# skipped 0\n';
        }
        assert.equal(command, 'git ls-files --cached --others --exclude-standard');
        scans++;
        return secret ? 'release-sentinel.txt\n' : '';
      } };
      throw new Error(`Unexpected module ${name}`);
    },
    console: { log: s => { result = JSON.parse(s); }, error() {} },
    process: { argv: ['node', 'release-check.js', '--json', ...args], exit: n => { exit = n; } }
  });
  return { tests, scans, result, exit };
}

test('release scans do not launch tests or claim release readiness', () => {
  const r = run(['--scans-only']);
  assert.equal(r.tests, 0);
  assert.equal(r.scans, 1);
  assert.equal(r.result.checks.tests.status, 'not-run');
  assert.equal(r.result.overall, 'SCAN ONLY');
  assert.equal(r.exit, 0);
  assert.deepEqual(Object.keys(r.result.checks).sort(), ['a11y', 'changelog', 'debug', 'deps', 'docs', 'secrets', 'tests', 'ui-gate', 'version']);
});

test('release scan allows only the four reviewed runtime diagnostics', () => {
  const html = fs.readFileSync(path.join(root, 'spi-spc.html'), 'utf8');
  const clean = run(['--scans-only'], { htmlOverride: html });
  assert.equal(clean.result.checks.debug.status, 'pass');
  assert.deepEqual(clean.result.checks.debug.messages, ['FACT: 無 console 輸出、debugger、alert、TODO、本機位址']);

  const unexpected = run(['--scans-only'], { htmlOverride: html + '\nconsole.log(\"unexpected diagnostic\");' });
  assert.equal(unexpected.result.checks.debug.status, 'warn');
  assert.deepEqual(unexpected.result.checks.debug.messages, ['FACT: console 輸出 1 處']);
});

test('scan-only mode still blocks detected secrets', () => {
  const r = run(['--scans-only'], { secret: true });
  assert.equal(r.tests, 0);
  assert.equal(r.result.checks.secrets.status, 'fail');
  assert.equal(r.result.overall, 'BLOCKED');
  assert.equal(r.exit, 1);
});

test('release check warns when ui-gate is triggered but invalid', () => {
  const origExec = fs.readFileSync;
  const fakeFs = Object.create(fs);
  fakeFs.readFileSync = (file, ...rest) => origExec(file, ...rest);
  let result, exit;
  vm.runInNewContext(source, {
    __dirname: path.join(root, 'tools'),
    require(name) {
      if (name === 'fs') return fakeFs;
      if (name === 'path') return path;
      if (name === 'child_process') return { execSync(command) {
        if (command === 'node tools/ui-gate-run.mjs --check --json') {
          return JSON.stringify({
            gated: true,
            triggered: true,
            valid: false,
            reason: 'no gate result yet',
            failing: ['G6'],
            rerun: 'node tools/ui-gate-run.mjs --repo /tmp',
          });
        }
        if (command.startsWith('node --test ')) return '# pass 1\n';
        return '';
      } };
      throw new Error(`Unexpected module ${name}`);
    },
    console: { log: s => { result = JSON.parse(s); }, error() {} },
    process: { argv: ['node', 'release-check.js', '--json', '--scans-only'], exit: n => { exit = n; } }
  });
  assert.equal(result.checks['ui-gate'].status, 'warn');
  assert.ok(result.checks['ui-gate'].messages.some((m) => /verify:ui|ui-gate-run/.test(m)));
  assert.equal(result.overall, 'SCAN ONLY');
  assert.equal(exit, 0);
});

test('default release check launches tests once and propagates failure', () => {
  for (const testFailure of [false, true]) {
    const r = run([], { testFailure });
    assert.equal(r.tests, 1);
    assert.equal(r.scans, 1);
    assert.equal(r.result.checks.tests.status, testFailure ? 'fail' : 'pass');
    assert.equal(r.exit, testFailure ? 1 : 0);
  }
});

test('CI invokes the full release gate once without a second full suite', () => {
  const yaml = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8');
  const commands = [...yaml.matchAll(/^\s+run:\s*(.+)\r?$/gm)].map(m => m[1].trim());
  assert.equal(commands.filter(c => c === 'npm run release-check').length, 1);
  assert.equal(commands.filter(c => c === 'npm run test:slow').length, 1,
    '.github/workflows/test.yml must run npm run test:slow exactly once; npm test uses reduced simulation samples and cannot establish false-alarm calibration.');
  assert.ok(!commands.includes('npm test'));
  assert.ok(!commands.includes('npm run release-check:scans'));
  assert.ok(commands.includes('npm run build:cloudflare'));
  assert.ok(commands.includes('npx wrangler deploy --dry-run'));
});
