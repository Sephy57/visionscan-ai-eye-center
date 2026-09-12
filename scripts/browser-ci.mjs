// Lightweight hosted browser smoke gate. It uses only a clean, local
// synthetic account and does not upload a study, load model weights, or call
// an external provider. The server must already be running on BASE_URL.
import fs from "fs";
import { spawnSync } from "child_process";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const USERNAME = process.env.BROWSER_CI_USERNAME;
const PASSWORD = process.env.BROWSER_CI_PASSWORD;

function fail(message) {
  throw new Error(`Hosted browser smoke failed: ${message}`);
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.CHROMIUM_PATH,
    ...(process.platform === "win32"
      ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      ]
      : [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      ]),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  if (process.platform !== "win32") {
    for (const command of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
      const result = spawnSync("which", [command], { encoding: "utf8" });
      if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
    }
  }
  fail("no Chromium/Chrome executable found; set CHROME_PATH");
}

async function bootstrapSyntheticAccount() {
  if (!USERNAME || !PASSWORD) {
    fail("BROWSER_CI_USERNAME and BROWSER_CI_PASSWORD must be provided by the isolated CI job; no default credentials are embedded");
  }
  const response = await fetch(`${BASE}/api/auth/bootstrap-admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD, display_name: "Hosted Browser CI" }),
  });
  // A persisted local account is valid for an explicitly configured local
  // run; the hosted job starts with an empty database and normally receives
  // 201 here. Never print the response body because it may contain account
  // metadata.
  if (!response.ok && response.status !== 403) {
    fail(`synthetic account bootstrap returned HTTP ${response.status}`);
  }
}

async function main() {
  await bootstrapSyntheticAccount();
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  const errors = [];
  let checks = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));

    const response = await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    if (response?.status() !== 200) fail(`/login returned HTTP ${response?.status() ?? "unknown"}`);
    await page.getByRole("heading", { name: "VisionScan AI" }).waitFor({ state: "visible" });
    // The page can be visible from SSR before React has attached the submit
    // handler. Waiting for React's delegated props prevents a fast hosted
    // runner from falling through to the browser's native GET form submit.
    await page.waitForFunction(() => {
      const submit = document.querySelector("button[type='submit']");
      return Boolean(submit && Object.keys(submit).some((key) => key.startsWith("__reactProps$")));
    }, undefined, { timeout: 10_000 });
    await page.getByLabel("Username").fill(USERNAME);
    await page.getByLabel("Password").fill(PASSWORD);
    const loginResponsePromise = page.waitForResponse((candidate) =>
      candidate.url() === `${BASE}/api/auth/login` && candidate.request().method() === "POST",
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "Sign in" }).click({ noWaitAfter: true });
    const loginResponse = await loginResponsePromise;
    if (!loginResponse.ok()) fail(`/api/auth/login returned HTTP ${loginResponse.status()}`);
    await page.waitForURL((url) => url.pathname === "/dashboard", { waitUntil: "domcontentloaded", timeout: 20_000 });
    checks += 1;
    console.log("[ok ] login -> dashboard");

    // Exercise the requested workstation destinations with the authenticated
    // synthetic session. No study id is supplied, so result/report pages only
    // render their empty-state contract and cannot execute inference.
    const routes = [
      ["/dashboard", /^Good (morning|afternoon|evening)\.?$/],
      ["/patients", "Patients"],
      ["/analyze", /Optional Patient Context|Upload records and scan/],
      ["/result", "Result"],
      ["/report", "Report"],
    ];
    for (const [route, heading] of routes) {
      const routeResponse = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      if (routeResponse?.status() !== 200) fail(`${route} returned HTTP ${routeResponse?.status() ?? "unknown"}`);
      const main = page.locator("main#main-content");
      await main.waitFor({ state: "visible" });
      const structure = await page.evaluate(() => {
        const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
        return {
          hasMain: Boolean(document.querySelector("main#main-content")),
          hasSkipLink: Boolean(document.querySelector("a.skip-link[href='#main-content']")),
          hasLanguage: document.documentElement.lang === "en",
          uniqueIds: new Set(ids).size === ids.length,
        };
      });
      if (!structure.hasMain || !structure.hasSkipLink || !structure.hasLanguage || !structure.uniqueIds) {
        fail(`${route} failed basic accessible structure checks`);
      }
      // The Result/Report empty states intentionally vary their heading text;
      // the route-level main landmark is the stable render contract there.
      if (route !== "/result" && route !== "/report") {
        await page.getByRole("heading", { name: heading }).first().waitFor({ state: "visible" });
      }
      checks += 1;
      console.log(`[ok ] ${route} HTTP ${routeResponse.status()}`);
    }

    if (errors.length) fail(`fatal browser errors: ${errors.slice(0, 5).join(" | ")}`);
    console.log(`\nHOSTED BROWSER SMOKE: PASSED (${checks} checks; synthetic account, no model/data assets)`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
