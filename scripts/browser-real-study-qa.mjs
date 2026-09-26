// Real-study browser release gate: responsive overflow and WCAG A/AA in the
// dark AND light themes on routes rendered with an actual analysed study, plus
// the viewer's source-availability states.
//
// Deterministic and data-safe: it creates one synthetic, metadata-free fundus
// raster (no patient imagery), analyses it through the normal API (works with
// or without installed model artifacts), and deletes the study at the end.
// Network interception is used ONLY in the viewer section to simulate a
// missing/forbidden original and a research overlay; nothing intercepted is
// persisted.
import fs from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { PDFDocument, StandardFonts } from "pdf-lib";

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CONFIGURED_USERNAME = process.env.BROWSER_QA_USERNAME || process.env.BROWSER_CI_USERNAME || process.env.SMOKE_ADMIN_USERNAME;
const CONFIGURED_PASSWORD = process.env.BROWSER_QA_PASSWORD || process.env.BROWSER_CI_PASSWORD || process.env.SMOKE_ADMIN_PASSWORD;
// The repo's local smoke account is only a default on a loopback server;
// anywhere else explicit credentials are required. This gate never creates
// an account (CI's browser:ci step bootstraps its own ephemeral one).
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(BASE).hostname);
if (!LOOPBACK && (!CONFIGURED_USERNAME || !CONFIGURED_PASSWORD)) {
  console.error("Set BROWSER_QA_USERNAME and BROWSER_QA_PASSWORD for a non-loopback BASE_URL.");
  process.exit(2);
}
const USERNAME = CONFIGURED_USERNAME || "smoke-admin";
const PASSWORD = CONFIGURED_PASSWORD || "SmokeTest#Local1234";
const THEMES = ["dark", "light"];
const WIDTHS = [320, 375, 390, 414, 768, 1024, 1280, 1440, 1920];
const AXE_WIDTHS = new Set([320, 768, 1280, 1920]);
// A deliberately long unbreakable identifier, like the pipeline's own
// UNCALIBRATED_RESEARCH_* tokens, to prove running text wraps on phones.
const LONG_TOKEN = "UNCALIBRATED_RESEARCH_GRADE_ESTIMATE_REQUIRES_OPHTHALMIC_REVIEW_NOT_A_DIAGNOSIS_SYNTHETIC_QA";

const failures = [];
const fail = (message) => { failures.push(message); console.log(`[FAIL] ${message}`); };
const ok = (message) => console.log(`[ok ] ${message}`);

async function syntheticFundus() {
  const size = 768;
  const raw = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot(x - size / 2, y - size / 2);
    let r = 8, g = 5, b = 5;
    if (radius < size * 0.43) {
      const wave = (x * 13 + y * 7 + Math.round(18 * Math.sin(x / 11) + 12 * Math.sin(y / 17))) % 90;
      r = 75 + wave; g = 25 + Math.round(wave * 0.45); b = 16 + Math.round(wave * 0.18);
    }
    if (radius < size * 0.12 && x > size * 0.58) { r = 242; g = 220; b = 188; }
    const i = (y * size + x) * 3; raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

async function signIn(context) {
  const login = await context.request.post(`${BASE}/api/auth/login`, { data: { username: USERNAME, password: PASSWORD } });
  if (!login.ok()) throw new Error(`login failed (HTTP ${login.status()}); set BROWSER_QA_USERNAME/BROWSER_QA_PASSWORD`);
  const csrf = (await context.storageState()).cookies.find((c) => c.name === "vsa_csrf")?.value;
  if (!csrf) throw new Error("no CSRF cookie after login");
  return csrf;
}

async function createAnalysedStudy(context, csrf) {
  const upload = await context.request.post(`${BASE}/api/upload`, {
    headers: { "x-csrf-token": csrf },
    multipart: { file: { name: "synthetic-qa-fundus.jpg", mimeType: "image/jpeg", buffer: await syntheticFundus() }, scanType: "fundus", eye: "OD" },
  });
  if (!upload.ok()) throw new Error(`upload failed (HTTP ${upload.status()})`);
  const { study_id: studyId } = await upload.json();
  for (const purpose of ["IMAGE_MODEL_ANALYSIS", "CLINICAL_RESEARCH_ANALYSIS"]) {
    const consent = await context.request.post(`${BASE}/api/studies/${encodeURIComponent(studyId)}/consent`, { headers: { "x-csrf-token": csrf }, data: { purpose, consentType: "explicit" } });
    if (!consent.ok()) throw new Error(`${purpose} consent failed (HTTP ${consent.status()})`);
  }
  // Synchronous analysis: no separate worker is needed for this gate.
  const analysis = await context.request.post(`${BASE}/api/analyze`, { headers: { "x-csrf-token": csrf }, data: { study_id: studyId }, timeout: 240_000 });
  if (!analysis.ok()) throw new Error(`analysis failed (HTTP ${analysis.status()})`);
  const { analysis_mode: mode } = await analysis.json();
  return { studyId, mode };
}

/** Response headers the running server actually sends (config rules and route headers combined). */
async function checkRuntimeHeaders(context, csrf, studyId) {
  const page = await context.request.get(`${BASE}/login`);
  const pageCsp = page.headersArray().filter((h) => h.name.toLowerCase() === "content-security-policy").map((h) => h.value);
  if (pageCsp.length !== 1 || !pageCsp[0].includes("default-src 'self'") || !pageCsp[0].includes("frame-ancestors 'none'")) fail(`page CSP unexpected: ${JSON.stringify(pageCsp)}`);
  else ok("pages send the application CSP");

  // A synthetic one-page PDF (no patient data) attached to the synthetic study.
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([595, 842]).drawText("Synthetic VisionScan QA document - no patient data", { x: 48, y: 780, size: 12, font });
  const consent = await context.request.post(`${BASE}/api/studies/${encodeURIComponent(studyId)}/consent`, { headers: { "x-csrf-token": csrf }, data: { purpose: "DOCUMENT_EXTRACTION", consentType: "explicit" } });
  if (!consent.ok()) return fail(`DOCUMENT_EXTRACTION consent failed (HTTP ${consent.status()})`);
  const upload = await context.request.post(`${BASE}/api/studies/${encodeURIComponent(studyId)}/documents`, {
    headers: { "x-csrf-token": csrf },
    multipart: { file: { name: "synthetic-qa.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) } },
  });
  if (upload.status() !== 201) return fail(`synthetic PDF upload failed (HTTP ${upload.status()})`);
  const documentId = (await upload.json()).document?.document_id;
  const file = await context.request.get(`${BASE}/api/documents/${encodeURIComponent(documentId)}/file`);
  const fileCsp = file.headersArray().filter((h) => h.name.toLowerCase() === "content-security-policy").map((h) => h.value);
  if (file.status() !== 200 || JSON.stringify(fileCsp) !== JSON.stringify(["sandbox"])) {
    fail(`stored PDF must be served with exactly "Content-Security-Policy: sandbox"; got HTTP ${file.status()} ${JSON.stringify(fileCsp)}`);
  } else ok("stored PDF is served with CSP sandbox (not overridden by the app CSP)");
  if (file.headers()["x-content-type-options"] !== "nosniff") fail("stored PDF missing X-Content-Type-Options: nosniff");
}

async function settle(page) {
  await page.locator("main#main-content").waitFor({ state: "visible", timeout: 60_000 });
  // Wait for client data loads to finish rendering (loading placeholders gone).
  await page.waitForFunction(() => !document.querySelector("main .page-loading, main .loading-row"), undefined, { timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

async function overflowReport(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const over = document.documentElement.scrollWidth - vw;
    if (over <= 0) return null;
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const style = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1 && !/(auto|scroll|hidden|clip)/.test(style.overflowX) && el.clientWidth > 0) {
        const nested = [...el.children].some((c) => c.scrollWidth > c.clientWidth + 1 && !/(auto|scroll|hidden|clip)/.test(getComputedStyle(c).overflowX));
        if (!nested) offenders.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`);
      }
    }
    return `${over}px (${offenders.slice(0, 3).join(", ") || "no single offender"})`;
  });
}

async function axeViolations(page) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const result = await globalThis.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return result.violations.map((v) => `${v.id}(${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
  });
}

/** Adds a research overlay region and a long pipeline token to the served bundle (test-only, never persisted). */
async function withSyntheticBundle(page, studyId, { overlay, longToken }) {
  await page.route((url) => url.pathname === `/api/studies/${studyId}`, async (route) => {
    const response = await route.fetch();
    const bundle = await response.json();
    if (bundle.analysis) {
      if (overlay) {
        bundle.analysis.fundus_abnormality = {
          state: "SUSPICIOUS_ABNORMALITY",
          regions: [{ id: "qa-region-1", finding_type: "synthetic_qa_region", localization: { kind: "bounding_box", coordinates: { x: 0.4, y: 0.4, w: 0.12, h: 0.12 } }, source_model_id: "synthetic-qa", source_model_version: "0", note: "Synthetic QA overlay" }],
          model_id: "synthetic-qa", model_version: "0", validation_state: "RESEARCH", limitations: ["Synthetic QA fixture"],
        };
      }
      if (longToken) {
        for (const finding of bundle.analysis.findings ?? []) finding.explanation = `${finding.explanation} ${LONG_TOKEN}`;
        bundle.analysis.uncertainty = { ...(bundle.analysis.uncertainty ?? {}), reasons: [...(bundle.analysis.uncertainty?.reasons ?? []), LONG_TOKEN] };
      }
    }
    await route.fulfill({ response, json: bundle });
  });
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  let studyId = null;
  let csrf = null;
  const setupContext = await browser.newContext();
  try {
    csrf = await signIn(setupContext);
    const created = await createAnalysedStudy(setupContext, csrf);
    studyId = created.studyId;
    ok(`synthetic study ${studyId} analysed (mode ${created.mode})`);
    await checkRuntimeHeaders(setupContext, csrf, studyId);
    const state = await setupContext.storageState();
    const routes = ["/dashboard", "/analyze", "/history", `/result?study=${studyId}`, `/clinician?study=${studyId}`, `/report?study=${studyId}`];

    // 1. Responsive overflow + accessibility, both themes, real study.
    for (const theme of THEMES) {
      const context = await browser.newContext({ storageState: state });
      await context.addInitScript((t) => { try { localStorage.setItem("vsa-theme", t); } catch { /* storage blocked */ } }, theme);
      const page = await context.newPage();
      const errors = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(`${new URL(page.url()).pathname}: ${m.text().slice(0, 200)}`); });
      page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${e.message}`));
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
        for (const route of routes) {
          await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
          await settle(page);
          const applied = await page.evaluate(() => document.documentElement.dataset.theme);
          if (applied !== theme) fail(`${route} ${width}px: theme ${applied} applied, expected ${theme}`);
          const overflow = await overflowReport(page);
          if (overflow) fail(`${theme} ${route} ${width}px: horizontal overflow ${overflow}`);
          if (AXE_WIDTHS.has(width)) {
            const violations = await axeViolations(page);
            if (violations.length) fail(`${theme} ${route} ${width}px axe: ${violations.join("; ")}`);
          }
        }
        ok(`${theme} ${width}px: ${routes.length} real-study routes checked`);
      }
      if (errors.length) fail(`${theme}: browser console errors: ${[...new Set(errors)].slice(0, 5).join(" | ")}`);
      await context.close();
    }

    // 2. Long unbreakable pipeline tokens must wrap on the narrowest phone.
    {
      const context = await browser.newContext({ storageState: state, viewport: { width: 320, height: 844 } });
      const page = await context.newPage();
      await withSyntheticBundle(page, studyId, { overlay: false, longToken: true });
      for (const route of routes.slice(3)) {
        // Font metrics differ by platform (Linux CI's fallback font is wider
        // than Windows' Segoe UI), so also check with a deliberately wide font.
        for (const wideFont of [false, true]) {
          await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
          await settle(page);
          if (wideFont) {
            await page.addStyleTag({ content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important; }' });
            await page.waitForTimeout(200);
          }
          const overflow = await overflowReport(page);
          if (overflow) fail(`long-token${wideFont ? " wide-font" : ""} ${route} 320px: horizontal overflow ${overflow}`);
        }
      }
      ok("long unbreakable identifiers wrap at 320px on result/clinician/report (default and wide fonts)");
      await context.close();
    }

    // 3. Viewer source availability: overlays render only over a loaded original.
    const viewerCase = async (label, { image, expectState, expectOverlays, expectText }) => {
      const context = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await withSyntheticBundle(page, studyId, { overlay: true, longToken: false });
      if (image) await page.route((url) => url.pathname === `/api/studies/${studyId}/image`, (route) => route.fulfill(image));
      await page.goto(`${BASE}/result?study=${studyId}`, { waitUntil: "domcontentloaded" });
      await settle(page);
      const frame = page.locator(".viewer-frame").first();
      try {
        await page.waitForFunction((s) => document.querySelector(".viewer-frame")?.getAttribute("data-source-state") === s, expectState, { timeout: 20_000 });
      } catch {
        fail(`viewer ${label}: data-source-state=${await frame.getAttribute("data-source-state")}, expected ${expectState}`);
        await context.close();
        return;
      }
      await page.waitForTimeout(300);
      const overlays = await page.locator(".viewer-overlay-box").count();
      if (expectOverlays ? overlays === 0 : overlays !== 0) fail(`viewer ${label}: ${overlays} overlay box(es) drawn`);
      if (expectText && !(await frame.innerText()).includes(expectText)) fail(`viewer ${label}: missing text "${expectText}"`);
      else ok(`viewer ${label}: ${expectState}, ${overlays} overlay box(es)`);
      await context.close();
    };
    await viewerCase("original available", { expectState: "SOURCE_AVAILABLE", expectOverlays: true, expectText: "Source available" });
    await viewerCase("original missing", { image: { status: 404, contentType: "application/json", body: JSON.stringify({ error: "SOURCE_MISSING" }) }, expectState: "SOURCE_MISSING", expectOverlays: false, expectText: "Source missing" });
    await viewerCase("original forbidden", { image: { status: 403, contentType: "application/json", body: JSON.stringify({ error: "Forbidden" }) }, expectState: "SOURCE_UNAVAILABLE", expectOverlays: false, expectText: "not permitted" });
    await viewerCase("service error", { image: { status: 500, contentType: "application/json", body: "{}" }, expectState: "SOURCE_UNAVAILABLE", expectOverlays: false, expectText: "Source unavailable" });
  } catch (error) {
    fail(`gate aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (studyId && csrf) {
      const removed = await setupContext.request.delete(`${BASE}/api/studies/${encodeURIComponent(studyId)}`, { headers: { "x-csrf-token": csrf } }).catch(() => null);
      console.log(`cleanup: synthetic study ${removed?.ok() ? "deleted" : `NOT deleted (HTTP ${removed?.status() ?? "error"})`}`);
      if (!removed?.ok()) failures.push("synthetic study cleanup failed");
    }
    if (csrf) {
      const logout = await setupContext.request.post(`${BASE}/api/auth/logout`, { headers: { "x-csrf-token": csrf } }).catch(() => null);
      if (logout?.ok()) ok("synthetic session logged out after study cleanup");
      else failures.push(`synthetic session logout failed (HTTP ${logout?.status() ?? "error"})`);
    }
    await browser.close();
  }
  if (failures.length) {
    console.log(`\nREAL-STUDY BROWSER QA: FAILED (${failures.length} problem(s))`);
    process.exit(1);
  }
  console.log(`\nREAL-STUDY BROWSER QA: PASSED (runtime security headers; ${THEMES.length} themes × ${WIDTHS.length} widths × 6 routes; axe at ${[...AXE_WIDTHS].join("/")}px; 4 viewer source states)`);
}

main().catch((error) => { console.error(error); process.exit(1); });
