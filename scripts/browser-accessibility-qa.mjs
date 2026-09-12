// Real-Chrome automated accessibility smoke. This does not claim manual
// NVDA/JAWS coverage; it runs axe WCAG A/AA rules against representative
// desktop and narrow layouts on an already-started local server.
import { chromium } from "playwright-core";
import axe from "axe-core";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USERNAME = process.env.SMOKE_ADMIN_USERNAME || "smoke-admin";
const PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || "SmokeTest#Local1234";
const VIEWPORTS = [320, 1280];
const ROUTES = ["/login", "/dashboard", "/patients", "/analyze", "/history", "/result", "/report", "/clinician", "/settings", "/admin", "/validation-center"];

function fail(message) {
  throw new Error(`Accessibility browser QA failed: ${message}`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const submit = document.querySelector("button[type='submit']");
      return Boolean(submit && Object.keys(submit).some((key) => key.startsWith("__reactProps$")));
    }, undefined, { timeout: 10_000 });
    await page.getByLabel("Username").fill(USERNAME);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click({ noWaitAfter: true });
    await page.waitForFunction(() => window.location.pathname === "/dashboard", undefined, { timeout: 10_000 });

    let checks = 0;
    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ROUTES) {
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
        await page.addScriptTag({ content: axe.source });
        const violations = await page.evaluate(async () => {
          const result = await globalThis.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
          return result.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.length,
            targets: v.nodes.slice(0, 3).map((node) => node.target),
            summaries: v.nodes.slice(0, 3).map((node) => node.failureSummary),
          }));
        });
        if (violations.length) fail(`${route} at ${width}px: ${JSON.stringify(violations)}`);
        checks += 1;
        console.log(`[ok ] ${route.padEnd(11)} ${String(width).padStart(4)}px axe WCAG A/AA`);
      }
    }
    console.log(`\nREAL BROWSER ACCESSIBILITY QA: PASSED (${checks}/${checks})`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
