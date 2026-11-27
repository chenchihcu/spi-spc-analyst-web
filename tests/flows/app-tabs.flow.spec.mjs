import { test, expect } from '../ui-gate/gate-fixture.mjs';
import { loginViaForm } from '../ui-gate/helpers.mjs';

test('[AC-2] 登入後可見問題偵測主分頁', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'duo-landscape', '由 [AC-3] duo-landscape.flow 覆蓋');
  await loginViaForm(page);
  await expect(page.locator('#p-issues')).toBeVisible();
  const overview = page.locator('button[data-tab="overview"]:visible').first();
  await overview.click();
  await expect(page.locator('#p-overview')).toBeVisible();
});