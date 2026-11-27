import { test } from '../ui-gate/gate-fixture.mjs';
import { loginFromLoginPage } from '../ui-gate/helpers.mjs';

test('[AC-1] 登入表單送出後進入主分析台', async ({ page }) => {
  await loginFromLoginPage(page);
});