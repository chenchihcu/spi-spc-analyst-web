import { chromium } from "playwright";
import fs from "node:fs";

const outDir = "/workspace/artifacts/r4-ui";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://127.0.0.1:8765/#data", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(2000);
const dismiss = page.locator("#btnBannerDismiss");
if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
await page.evaluate(() => {
  document.documentElement.setAttribute("data-theme", "dark");
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  if (typeof loadExample === "function") loadExample();
  else document.querySelector("#btnSample")?.click();
});
await page.waitForTimeout(5000);
await page.locator('[data-tab="board"],#tabBoard,button:has-text("板面")').first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.locator('[data-tab="adv"],#tabAdv,button:has-text("進階")').first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(2000);
await page.screenshot({ path: `${outDir}/app-manual-dark-overview.png`, fullPage: true });
const legHtml = await page.locator("#csLegend").first().innerHTML().catch(() => "");
const leg3d = await page.locator("#leg3d").first().innerHTML().catch(() => "");
fs.writeFileSync(`${outDir}/legend-html.json`, JSON.stringify({ csLegend: legHtml.slice(0, 500), leg3d: leg3d.slice(0, 800) }, null, 2));
const css = await page.evaluate(() => {
  const ok = getComputedStyle(document.documentElement).getPropertyValue("--ok").trim();
  const lisa = getComputedStyle(document.documentElement).getPropertyValue("--lisa-hh").trim();
  return { ok, lisa_hh: lisa, theme: document.documentElement.getAttribute("data-theme") };
});
fs.writeFileSync(`${outDir}/computed-tokens.json`, JSON.stringify(css, null, 2));
await browser.close();
console.log(JSON.stringify(css, null, 2));
