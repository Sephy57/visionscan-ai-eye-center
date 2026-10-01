// End-to-end journey gate:
//   login (real form) -> upload -> consent -> analyze -> processing -> result
//   -> overlay -> evidence -> clinician review -> report -> history -> logout
//
// Fails on: no research model having run (a DEMO placeholder does not count;
// MODEL_FAILED, NO_MODEL_EXECUTED and DEMO_ONLY all fail unless
// JOURNEY_ALLOW_NO_MODEL=1), an HTTP 5xx seen by the page or on a checked API call, a
// browser console or page error, a broken loaded <img>, a rendered localization
// that is not in the stored analysis (a fabricated finding), colliding finding
// ids, a session token that still works after sign-out, and the status checks
// of each step. Prints the model -> persisted -> API -> rendered reconciliation
// with provenance, so the numbers come from the actual run, not a fixture claim.
//
// The overlay is only exercised if the input produces a region. With the
// default synthetic raster it may not; the gate then says so and does not list
// the overlay as verified. Use VIEWER_QA_FIXTURE (an approved non-patient image
// the model flags) and JOURNEY_MIN_REGIONS to require it.
//
// Run it only against a server with an ISOLATED data root: it creates a study
// and a clinician review event. Deleting the study removes its source bytes,
// but the audit trail and review history are retained by design.
// Needs a running server (BASE_URL, default http://localhost:3000) and the
// loopback smoke account.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import sharp from "sharp";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(BASE).hostname);
const USERNAME = process.env.BROWSER_QA_USERNAME || process.env.SMOKE_ADMIN_USERNAME || "smoke-admin";
const PASSWORD = process.env.BROWSER_QA_PASSWORD || process.env.SMOKE_ADMIN_PASSWORD || "SmokeTest#Local1234";
if (!LOOPBACK && !(process.env.BROWSER_QA_USERNAME && process.env.BROWSER_QA_PASSWORD)) {
  console.error("Set BROWSER_QA_USERNAME and BROWSER_QA_PASSWORD for a non-loopback BASE_URL.");
  process.exit(2);
}
const FIXTURE = process.env.VIEWER_QA_FIXTURE;
const failures = [];
const fail = (m) => { failures.push(m); console.log(`[FAIL] ${m}`); };
const ok = (m) => console.log(`[ok ] ${m}`);
const check = (c, m) => { if (!c) fail(m); return !!c; };

async function syntheticFundus() {
  const size = 768, raw = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot(x - size / 2, y - size / 2);
    let r = 8, g = 5, b = 5;
    if (radius < size * 0.43) { const wave = (x * 13 + y * 7 + Math.round(18 * Math.sin(x / 11) + 12 * Math.sin(y / 17))) % 90; r = 75 + wave; g = 25 + Math.round(wave * 0.45); b = 16 + Math.round(wave * 0.18); }
    if (radius < size * 0.12 && x > size * 0.58) { r = 242; g = 220; b = 188; }
    const i = (y * size + x) * 3; raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const status5xx = [], consoleErrors = [];
  page.on("response", (r) => { if (r.status() >= 500) status5xx.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  const failedLoads = [];
  page.on("response", (r) => { if (r.status() >= 400) failedLoads.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const where = m.location()?.url ? ` [${new URL(m.location().url).pathname}]` : "";
    consoleErrors.push(`${new URL(page.url()).pathname}: ${m.text().slice(0, 200)}${where}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`${new URL(page.url()).pathname}: ${e.message}`));
  const brokenImages = async (label) => {
    const broken = await page.evaluate(() => [...document.images].filter((i) => !i.getAttribute("aria-hidden") && i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src));
    check(broken.length === 0, `${label}: broken image(s): ${broken.join(", ")}`);
  };
  const settle = async () => { await page.locator("main#main-content").waitFor({ state: "visible", timeout: 60_000 }); await page.waitForFunction(() => !document.querySelector("main .page-loading, main .loading-row"), undefined, { timeout: 60_000 }).catch(() => undefined); await page.waitForTimeout(300); };

  let studyId = null, csrf = null, overlayExercisedFinal = false;
  try {
    // 1. login through the real form
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.locator("#username").fill(USERNAME);
    await page.locator("#password").fill(PASSWORD);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000, waitUntil: "domcontentloaded" }), page.getByRole("button", { name: /sign in|log in/i }).click()]);
    csrf = (await context.storageState()).cookies.find((c) => c.name === "vsa_csrf")?.value;
    check(!!csrf, "login set no CSRF cookie");
    ok(`login through the form -> ${new URL(page.url()).pathname}`);

    // 2. upload -> consent -> analyze (same API the UI uses), timed
    const buffer = FIXTURE ? fs.readFileSync(FIXTURE) : await syntheticFundus();
    const inputSha = crypto.createHash("sha256").update(buffer).digest("hex");
    const name = FIXTURE ? path.basename(FIXTURE) : "synthetic-journey-fundus.jpg";
    const uploadStarted = Date.now();
    const upload = await context.request.post(`${BASE}/api/upload`, { headers: { "x-csrf-token": csrf }, timeout: 120_000, multipart: { file: { name, mimeType: name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg", buffer }, scanType: "fundus", eye: "OD" } });
    const uploadMs = Date.now() - uploadStarted;
    check(upload.status() === 201, `upload HTTP ${upload.status()}`);
    console.log(`upload_ms=${uploadMs}`);
    studyId = (await upload.json()).study_id;
    for (const purpose of ["IMAGE_MODEL_ANALYSIS", "CLINICAL_RESEARCH_ANALYSIS"]) {
      const c = await context.request.post(`${BASE}/api/studies/${studyId}/consent`, { headers: { "x-csrf-token": csrf }, data: { purpose, consentType: "explicit" } });
      check(c.ok(), `${purpose} consent HTTP ${c.status()}`);
    }
    const started = Date.now();
    const analyze = await context.request.post(`${BASE}/api/analyze`, { headers: { "x-csrf-token": csrf }, data: { study_id: studyId }, timeout: 300_000 });
    const analyzeMs = Date.now() - started;
    check(analyze.ok(), `analyze HTTP ${analyze.status()}`);
    ok(`study ${studyId} uploaded, consented, analysed in ${(analyzeMs / 1000).toFixed(1)}s`);

    // 3. processing page
    await page.goto(`${BASE}/processing?study=${studyId}`, { waitUntil: "domcontentloaded" });
    await settle(); await brokenImages("processing");
    ok("processing page rendered");

    // 4. API truth, then the rendered result against it
    const bundleResponse = await context.request.get(`${BASE}/api/studies/${studyId}`);
    check(bundleResponse.status() === 200, `study API HTTP ${bundleResponse.status()}`);
    const bundle = await bundleResponse.json();
    const a = bundle.analysis, fundus = a?.fundus_abnormality, exec = a?.model_execution;
    const apiRegions = fundus?.regions ?? [];
    // The journey is only meaningful if the model actually ran: a regression that
    // skips or fails the provider would otherwise reconcile 0 stored = 0 rendered.
    // The DEMO placeholder also "executes", so it must not count: a research (non-demo)
    // model has to have run. JOURNEY_ALLOW_NO_MODEL=1 lets a flow-only run proceed, loudly.
    const realModels = (exec?.models_executed ?? []).filter((id) => !id.startsWith("demo-"));
    const modelRan = ["RESEARCH_MODEL_ANALYSIS", "MIXED_RESEARCH_AND_DEMO"].includes(a?.analysis_mode) && realModels.length > 0 && exec?.runtime_status === "COMPLETED";
    if (process.env.JOURNEY_ALLOW_NO_MODEL === "1") {
      if (!modelRan) console.log(`NOTE: JOURNEY_ALLOW_NO_MODEL=1 and no research model ran (analysis_mode=${a?.analysis_mode}); this run verifies the flow only, not the model.`);
    } else {
      check(modelRan, `no research model ran (analysis_mode=${a?.analysis_mode}, executed=${(exec?.models_executed ?? []).join(",") || "none"}, runtime=${exec?.runtime_status}); set JOURNEY_ALLOW_NO_MODEL=1 only for a flow-only run`);
    }
    const overlayExercised = apiRegions.length > 0;
    overlayExercisedFinal = overlayExercised;
    const minRegions = Number(process.env.JOURNEY_MIN_REGIONS || 0);
    check(apiRegions.length >= minRegions, `expected at least ${minRegions} stored region(s) (JOURNEY_MIN_REGIONS) but the analysis holds ${apiRegions.length}`);
    if (!overlayExercised) console.log("NOTE: this input produced no localized region, so the overlay itself was NOT exercised. Use a fixture the model flags (VIEWER_QA_FIXTURE) or set JOURNEY_MIN_REGIONS.");
    // Every finding id is unique and carries the model that produced it.
    const findingIds = (a?.findings ?? []).map((f) => f.id);
    check(new Set(findingIds).size === findingIds.length, `finding ids collide: ${findingIds.join(", ")}`);
    for (const f of a?.findings ?? []) check(f.id.includes(f.model_id), `finding ${f.id} does not carry its model id (${f.model_id})`);
    check(bundle.study?.original_sha256 === inputSha, `stored original hash ${bundle.study?.original_sha256} != uploaded input hash ${inputSha}`);
    await page.goto(`${BASE}/result?study=${studyId}`, { waitUntil: "domcontentloaded" });
    await settle();
    await page.waitForFunction(() => document.querySelector(".viewer-frame")?.getAttribute("data-source-state") === "SOURCE_AVAILABLE", undefined, { timeout: 30_000 });
    await page.waitForTimeout(400);
    const rendered = await page.evaluate(() => [...document.querySelectorAll(".viewer-pane .viewer-overlay-box")].map((b) => b.getAttribute("data-localization-id")));
    const fabricated = rendered.filter((id) => !apiRegions.some((r) => r.id === id));
    check(fabricated.length === 0, `rendered localization(s) not in the stored analysis: ${fabricated.join(", ")}`);
    check(rendered.length === apiRegions.length, `API holds ${apiRegions.length} region(s) but ${rendered.length} rendered`);
    const state = await page.locator(".viewer-frame").first().getAttribute("data-analysis-state");
    const pageText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    // Page-owned wording (inside <main>); the global app banner is on every page and proves nothing about this one.
    check(/SCREENING RESULT · RESEARCH OUTPUT/.test(pageText), "result page no longer labels its output as research output");
    // "No disease conclusion can be made" is the required safety wording, not a claim.
    const claim = pageText.match(/.{0,60}(\b(diagnosis confirmed|disease absent|disease excluded|no evidence of disease|healthy (eye|retina|fundus))\b|\bno disease(?! conclusion)\b).{0,60}/i);
    check(!claim, `result page makes a normal/healthy/disease-absent claim: "${claim?.[0]}"`);
    await brokenImages("result");
    console.log(`PROVENANCE  models_executed=${(exec?.models_executed ?? []).join(",")}  status=${exec?.runtime_status}`);
    for (const id of exec?.models_executed ?? []) console.log(`  ${id} v${exec.model_versions?.[id]} sha256=${exec.artifact_hashes?.[id]} (${exec.artifact_verification?.[id]})`);
    console.log(`RECONCILIATION  input_sha256=${inputSha}  api_state=${fundus?.state}  persisted/API regions=${apiRegions.length}  RENDERED=${rendered.length}  viewer_state=${state}  analyze_ms=${analyzeMs}`);
    ok(`result viewer: ${rendered.length} rendered = ${apiRegions.length} stored, none fabricated`);

    // 5. evidence (API + panel on the result page)
    const evidence = await context.request.get(`${BASE}/api/studies/${studyId}/evidence`);
    check(evidence.status() === 200, `evidence API HTTP ${evidence.status()}`);
    check(await page.getByText(/multimodal evidence/i).first().isVisible(), "evidence section not visible on the result page");
    ok(`evidence available (API ${evidence.status()})`);

    // 6. clinician review: confirm the first finding, then see the recorded message
    await page.goto(`${BASE}/clinician?study=${studyId}`, { waitUntil: "domcontentloaded" });
    await settle(); await brokenImages("clinician");
    const confirm = page.getByRole("button", { name: /^Confirm$/ }).first();
    if (await confirm.count()) {
      const [review] = await Promise.all([page.waitForResponse((r) => r.url().includes("/api/review/") && r.request().method() === "POST", { timeout: 30_000 }), confirm.click()]);
      check(review.ok(), `clinician review HTTP ${review.status()}`);
      // the page's own confirmation (not static copy that merely contains the word)
      await page.getByText(/Action "confirm" recorded/).first().waitFor({ timeout: 15_000 });
      ok("clinician review action recorded");
    } else {
      // A finding the API holds must be reviewable; only a finding-free analysis may skip this step.
      check((a?.findings ?? []).length === 0, `the API holds ${(a?.findings ?? []).length} finding(s) but the clinician page offers no Confirm button`);
      ok("clinician page rendered (no finding to confirm for this image)");
    }

    // 7. report, 8. history
    await page.goto(`${BASE}/report?study=${studyId}`, { waitUntil: "domcontentloaded" });
    await settle(); await brokenImages("report");
    check(/RESEARCH OUTPUT/.test(await page.locator("main").innerText()), "report no longer labels its output as research output");
    ok("report rendered and labels its output as research output");
    await page.goto(`${BASE}/history`, { waitUntil: "domcontentloaded" });
    await settle();
    check((await page.locator("main").innerText()).includes(studyId.slice(0, 12)) || await page.getByText(studyId.slice(0, 10)).count() > 0, "study missing from history");
    ok("history lists the study");

    // 9. logout through the UI, then the session must be gone
    const sessionCookie = (await context.storageState()).cookies.find((c) => c.name === "vsa_session")?.value;
    await Promise.all([page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 60_000, waitUntil: "domcontentloaded" }), page.getByRole("button", { name: /sign out/i }).click()]);
    const after = await context.request.get(`${BASE}/api/studies/${studyId}`);
    check(after.status() === 401 || after.status() === 403, `after logout the study API answered ${after.status()}`);
    // The server must have destroyed the session, not merely cleared the browser's cookie:
    // replay the old session token from a context that has no cookies of its own.
    const replayer = await browser.newContext();
    const replay = await replayer.request.get(`${BASE}/api/studies/${studyId}`, { headers: { Cookie: `vsa_session=${sessionCookie}` } });
    check(!!sessionCookie && (replay.status() === 401 || replay.status() === 403), `the pre-logout session token still works after logout (HTTP ${replay.status()})`);
    await replayer.close();
    ok(`logged out; study API now ${after.status()}, old session token rejected (${replay.status()})`);
    csrf = null;
  } catch (error) {
    fail(`journey aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (studyId) {
      // re-authenticate to clean up the synthetic study
      const cleaner = await browser.newContext();
      const login = await cleaner.request.post(`${BASE}/api/auth/login`, { data: { username: USERNAME, password: PASSWORD } }).catch(() => null);
      const token = (await cleaner.storageState()).cookies.find((c) => c.name === "vsa_csrf")?.value;
      const del = login?.ok() && token ? await cleaner.request.delete(`${BASE}/api/studies/${studyId}`, { headers: { "x-csrf-token": token } }).catch(() => null) : null;
      console.log(`cleanup: study ${del?.ok() ? "deleted" : "NOT deleted"}`);
      if (!del?.ok()) failures.push("study cleanup failed");
      await cleaner.request.post(`${BASE}/api/auth/logout`, { headers: { "x-csrf-token": token ?? "" } }).catch(() => null);
    }
    check(status5xx.length === 0, `unexpected HTTP 5xx: ${[...new Set(status5xx)].join(", ")}`);
    check(consoleErrors.length === 0, `browser console errors: ${[...new Set(consoleErrors)].slice(0, 4).join(" | ")} (failed loads: ${[...new Set(failedLoads)].join(", ")})`);
    await browser.close();
  }
  if (failures.length) { console.log(`\nJOURNEY QA: FAILED (${failures.length} problem(s))`); process.exit(1); }
  console.log(`\nJOURNEY QA: PASSED (login -> upload -> consent -> analyze -> processing -> result -> ${overlayExercisedFinal ? "overlay" : "overlay NOT EXERCISED (no region for this input)"} -> evidence -> clinician review -> report -> history -> logout; 0 page-observed HTTP 5xx, 0 console errors, 0 broken loaded images, 0 fabricated findings)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
