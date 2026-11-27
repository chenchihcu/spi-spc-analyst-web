import { test, expect } from '../ui-gate/gate-fixture.mjs';
import { loginViaForm } from '../ui-gate/helpers.mjs';

test('[AC-3] Duo 橫向書本寬度登入後可切換總覽', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'duo-landscape', '僅在 duo-landscape viewport 執行');
  await loginViaForm(page);
  await expect(page.locator('#p-issues')).toBeVisible();
  const overview = page.locator('button[data-tab="overview"]:visible').first();
  await overview.click();
  await expect(page.locator('#p-overview')).toBeVisible();
});