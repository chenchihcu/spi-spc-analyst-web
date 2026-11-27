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
  await page.locator('#user').fill(cred.user);
  await page.locator('#pass').fill(cred.password);
  await page.locator('#go').click();
  await expect(page.locator('#appVer')).toHaveText(`v${version}`);
  return cred;
}