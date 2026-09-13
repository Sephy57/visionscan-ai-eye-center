// Phase 8 visual evidence capture. The caller should point the server at an
// isolated empty DATA_ROOT so these screenshots cannot contain project data.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import sharp from "sharp";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USERNAME = process.env.PHASE8_SCREENSHOT_USERNAME || "phase8-screenshot-admin";
const PASSWORD = process.env.PHASE8_SCREENSHOT_PASSWORD || "Phase8Screenshot#Local1234";
const OUTPUT = path.resolve(process.env.PHASE8_SCREENSHOT_DIR || path.join(process.cwd(), "data", "tmp", "phase8-screenshots"));
const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "375x812", width: 375, height: 812 },
];
const ROUTES = [
  { name: "landing", path: "/" },
  { name: "dashboard", path: "/dashboard" },
  { name: "analysis", path: "/analyze" },
  { name: "result", path: "/result" },
  { name: "viewer", path: "/clinician" },
  { name: "specialist-board", path: "/clinician" },
  { name: "review-queue", path: "/dashboard" },
  { name: "validation-center", path: "/validation-center" },
  { name: "report", path: "/report" },
];

function ensureOutputIsScoped() {
  const expectedRoot = path.resolve(process.cwd(), "data", "tmp");
  const resolved = path.resolve(OUTPUT);
  if (resolved !== expectedRoot && !resolved.startsWith(`${expectedRoot}${path.sep}`)) {
    throw new Error(`Screenshot output must stay under ${expectedRoot}`);
  }
  fs.mkdirSync(resolved, { recursive: true });
}

async function contactSheet(files, viewport) {
  const tileWidth = 480;
  const tileHeight = 300;
  const tiles = await Promise.all(files.map(async (file) => ({
    input: await sharp(file).resize({ width: tileWidth, height: tileHeight, fit: "contain", background: "#ffffff" }).png().toBuffer(),
    left: 0,
    top: 0,
  })));
  const composites = tiles.map((tile, index) => ({ ...tile, left: (index % 3) * tileWidth, top: Math.floor(index / 3) * tileHeight }));
  const target = path.join(OUTPUT, `contact-${viewport.name}.png`);
  await sharp({ create: { width: tileWidth * 3, height: tileHeight * 3, channels: 4, background: "#ffffff" } })
    .composite(composites)
    .png()
    .toFile(target);
  return target;
}

async function main() {
  ensureOutputIsScoped();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const captured = [];
  const contactSheets = [];
  try {
    const context = await browser.newContext({ viewport: VIEWPORTS[0] });
    const page = await context.newPage();
    const bootstrap = await page.request.post(`${BASE}/api/auth/bootstrap-admin`, {
      data: { username: USERNAME, password: PASSWORD, display_name: "Phase 8 Screenshot QA" },
    });
    if (!bootstrap.ok() && bootstrap.status() !== 403) throw new Error(`isolated screenshot account bootstrap failed (${bootstrap.status()})`);

    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const submit = document.querySelector("button[type='submit']");
      return Boolean(submit && Object.keys(submit).some((key) => key.startsWith("__reactProps$")));
    }, undefined, { timeout: 10_000 });
    await page.getByLabel("Username").fill(USERNAME);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click({ noWaitAfter: true });
    await page.waitForFunction(() => window.location.pathname === "/dashboard", undefined, { timeout: 10_000 });

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const viewportFiles = [];
      for (const route of ROUTES) {
        const response = await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded" });
        if (response?.status() !== 200) throw new Error(`${route.path} returned HTTP ${response?.status() ?? "unknown"}`);
        await page.waitForTimeout(150);
        const main = page.locator("main#main-content");
        await main.waitFor({ state: "visible" });
        const file = path.join(OUTPUT, `${route.name}-${viewport.name}.png`);
        await page.screenshot({ path: file, fullPage: false, animations: "disabled" });
        captured.push(file);
        viewportFiles.push(file);
      }
      contactSheets.push(await contactSheet(viewportFiles, viewport));
    }
    console.log(JSON.stringify({ output: path.relative(process.cwd(), OUTPUT), screenshots: captured.length, contact_sheets: contactSheets.map((file) => path.relative(process.cwd(), file)), phi_included: false }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`PHASE 8 SCREENSHOT QA FAILED: ${error.message}`);
  process.exit(1);
});
