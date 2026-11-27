import { test, expect } from '../ui-gate/gate-fixture.mjs';
import { loadCredentials } from '../ui-gate/helpers.mjs';

test('[AC-1] 登入表單送出後進入主分析台', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'duo-landscape', '橫向 Duo 登入表單待另開專用 flow');
  const cred = loadCredentials();
  await page.goto('/__login');
  await expect(page.locator('#loginForm')).toBeVisible();
  await page.locator('#user').fill(cred.user);
  await page.locator('#pass').fill(cred.password);
  await page.locator('#go').click();
  await expect(page.locator('#appVer')).toHaveText(`v${cred.version}`);
  await expect(page.locator('#p-issues')).toBeVisible();
});