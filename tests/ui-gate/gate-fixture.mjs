// Web UI Acceptance Gate fixture for flow tests (copied by `ui-gate.mjs --init-project`).
// Flows import { test, expect } from this file. Under the gate (UI_GATE_RUNTIME set) every flow
// also fails on uncaught errors, console.error, same-origin HTTP >= 400 (G2) and on layout
// violations L1–L7 in its final state (G3). Outside the gate it behaves like @playwright/test.
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rtPath = process.env.UI_GATE_RUNTIME;
const rt = rtPath ? JSON.parse(fs.readFileSync(rtPath, 'utf8')) : null;

export const test = base.extend({
  uiGate: [
    async ({ page }, use, testInfo) => {
      if (!rt) {
        await use();
        return;
      }
      const { watchRuntime, runLayout } = await import(pathToFileURL(rt.helperPath).href);
      const g2 = watchRuntime(page, rt);
      await use();
      // Skipped tests and tests that never navigated have no UI state to judge.
      const judged = !page.isClosed() && testInfo.status !== 'skipped' && page.url() !== 'about:blank';
      if (!judged) return;
      const g3 = await runLayout(page, rt, testInfo.project.use.isMobile);
      fs.writeFileSync(path.join(rt.outDir, 'flows', `${testInfo.project.name}__${testInfo.testId}.json`), JSON.stringify({ g2, g3 }));
      expect(g2, 'G2 RUNTIME-CLEAN during this flow (pageerror / console.error / HTTP >= 400)').toEqual([]);
      expect(g3, 'G3 LAYOUT-INVARIANTS in the final state of this flow').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
