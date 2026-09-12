// Real-browser responsive smoke check. Run against an already-started local
// server; do not point this at a shared or production deployment.
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USERNAME = process.env.SMOKE_ADMIN_USERNAME || "smoke-admin";
const PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || "SmokeTest#Local1234";
const VIEWPORTS = [320, 375, 414, 768, 1024, 1280, 1440, 1920];
const ROUTES = ["/login", "/dashboard", "/patients", "/analyze", "/history", "/result", "/report", "/clinician", "/settings", "/admin", "/validation-center"];

function fail(message) {
  throw new Error(`Responsive browser QA failed: ${message}`);
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
    // Next client routing does not always create a traditional browser
    // navigation, so wait for the actual location rather than a load event.
    await page.getByRole("button", { name: "Sign in" }).click({ noWaitAfter: true });
    try {
      await page.waitForFunction(() => window.location.pathname === "/dashboard", undefined, { timeout: 10_000 });
    } catch {
      const visibleError = await page.locator('[role="alert"]').textContent().catch(() => null);
      fail(`login did not reach dashboard within 10 seconds${visibleError ? `: ${visibleError}` : ""}`);
    }

    let checks = 0;
    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ROUTES) {
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(75);
        const measured = await page.evaluate(() => ({
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          hasMain: Boolean(document.querySelector("#main-content")),
        }));
        if (!measured.hasMain) fail(`${route} at ${width}px rendered without main content`);
        if (measured.scrollWidth > measured.viewport) {
          fail(`${route} at ${width}px has horizontal overflow (${measured.scrollWidth - measured.viewport}px)`);
        }
        checks += 1;
        console.log(`[ok ] ${route.padEnd(11)} ${String(width).padStart(4)}px`);
      }
    }
    console.log(`\nREAL BROWSER RESPONSIVE QA: PASSED (${checks}/${checks})`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
