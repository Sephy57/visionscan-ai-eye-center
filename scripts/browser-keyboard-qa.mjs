// Real-Chrome keyboard/focus smoke check for the local workstation UI.
// This is an automated keyboard contract, not NVDA/JAWS certification.
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USERNAME = process.env.SMOKE_ADMIN_USERNAME || "smoke-admin";
const PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || "SmokeTest#Local1234";
const ROUTES = ["/dashboard", "/patients", "/analyze", "/history", "/result", "/report", "/validation", "/clinician"];

function fail(message) {
  throw new Error(`Keyboard browser QA failed: ${message}`);
}

async function visibleSkipLink(page) {
  await page.keyboard.press("Tab");
  const skip = page.locator(".skip-link");
  if (!(await skip.isVisible())) fail("skip link did not become visible on first Tab");
  if ((await page.evaluate(() => document.activeElement?.className)) !== "skip-link") fail("first Tab did not focus skip link");
  await page.keyboard.press("Enter");
  if ((await page.evaluate(() => document.activeElement?.id)) !== "main-content") fail("skip link did not move focus to main content");
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Username").fill(USERNAME);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByLabel("Password").press("Enter");
    await page.waitForFunction(() => window.location.pathname === "/dashboard", undefined, { timeout: 10_000 });
    console.log("[ok ] Enter submits login and reaches dashboard");

    let checks = 1;
    for (const route of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      await visibleSkipLink(page);
      const main = page.locator("#main-content");
      if (!(await main.getAttribute("tabindex"))) fail(`${route} main content is not programmatically focusable`);
      // A bounded Tab walk must keep focus on an interactive/document target.
      for (let i = 0; i < 40; i += 1) {
        await page.keyboard.press("Tab");
        const focused = await page.evaluate(() => document.activeElement?.tagName ?? "");
        if (!focused) fail(`${route} lost focus during Tab walk`);
      }
      checks += 2;
      console.log(`[ok ] ${route.padEnd(11)} skip link, focus target, bounded Tab walk`);
    }

    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    const menu = page.getByRole("button", { name: "Open navigation menu" });
    await menu.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Navigation menu" });
    await dialog.waitFor({ state: "visible" });
    if ((await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) !== "Close menu") fail("drawer did not focus Close menu");
    const last = dialog.locator("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])").last();
    await last.focus();
    await page.keyboard.press("Tab");
    if (!(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")) === "Close menu")) fail("drawer Tab did not wrap to first control");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    if (!(await menu.evaluate((node) => node === document.activeElement))) fail("Escape did not restore focus to menu trigger");
    checks += 4;
    console.log("[ok ] mobile drawer Enter, focus trap, Escape, and focus restoration");
    console.log(`\nREAL BROWSER KEYBOARD QA: PASSED (${checks}/${checks})`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
