import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const credPath = path.join(root, '.ui-gate/run/credentials.json');

export function loadCredentials() {
  if (!fs.existsSync(credPath)) throw new Error(`missing ${credPath}; run the UI gate prepare step first`);
  return JSON.parse(fs.readFileSync(credPath, 'utf8'));
}

async function submitLogin(page, cred) {
  await page.locator('#user').fill(cred.user);
  await page.locator('#pass').fill(cred.password);
  await page.locator('#go').scrollIntoViewIfNeeded();
  const loginResp = page.waitForResponse(
    (r) => r.url().includes('/__login') && r.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.locator('#go').click();
  const resp = await loginResp;
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok() || !body.ok) {
    const msg = body.message || body.error || `HTTP ${resp.status()}`;
    expect.fail(`登入失敗：${msg}`);
  }
  await page.waitForURL((url) => !url.pathname.includes('__login'), { timeout: 120_000 });
}

/** Same-origin form login as verify-spi-spc journeys.login */
export async function loginViaForm(page) {
  page.setDefaultTimeout(120_000);
  const cred = loadCredentials();
  const version = cred.version;
  await page.goto('/');
  await expect(page.locator('#loginForm')).toBeVisible();
  if (cred.built) {
    await expect(page.locator('.ver')).toContainText(`v${version}`);
  }
  await submitLogin(page, cred);
  await expect(page.locator('#appVer')).toHaveText(`v${version}`);
  return cred;
}

export async function loginFromLoginPage(page) {
  page.setDefaultTimeout(120_000);
  const cred = loadCredentials();
  await page.goto('/__login');
  await expect(page.locator('#loginForm')).toBeVisible();
  await submitLogin(page, cred);
  await expect(page.locator('#appVer')).toHaveText(`v${cred.version}`);
  await expect(page.locator('#p-issues')).toBeVisible();
  return cred;
}