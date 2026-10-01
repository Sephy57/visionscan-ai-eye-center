// Viewer overlay release gate: research localizations stay attached to the
// same anatomy, the original is always independently viewable, and every
// "nothing drawn" state says why instead of leaving a blank panel.
//
// Data-safe and honest about what is real:
//  * REAL: the study is uploaded and analysed through the normal API. The
//    region counts the API holds are compared with the boxes the browser
//    renders (model -> persisted -> API -> rendered reconciliation). Set
//    VIEWER_QA_FIXTURE to an approved fundus file to analyse a specific image;
//    otherwise a synthetic, metadata-free raster is used, which may
//    legitimately yield zero regions (then the no-signal state is asserted).
//  * SYNTHETIC UI FIXTURES: geometry, state and missing-source cases use
//    network interception of the served bundle/image (never persisted). Those
//    regions are test geometry for the viewer, NOT model output, and are
//    labelled "synthetic-qa" everywhere they appear.
//
// Needs a running server (BASE_URL, default http://localhost:3000) and the
// repo's loopback smoke account, exactly like browser-real-study-qa.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import sharp from "sharp";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), "visionscan-viewer-qa");
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(BASE).hostname);
const USERNAME = process.env.BROWSER_QA_USERNAME || process.env.SMOKE_ADMIN_USERNAME || "smoke-admin";
const PASSWORD = process.env.BROWSER_QA_PASSWORD || process.env.SMOKE_ADMIN_PASSWORD || "SmokeTest#Local1234";
if (!LOOPBACK && !(process.env.BROWSER_QA_USERNAME && process.env.BROWSER_QA_PASSWORD)) {
  console.error("Set BROWSER_QA_USERNAME and BROWSER_QA_PASSWORD for a non-loopback BASE_URL.");
  process.exit(2);
}
const WIDTHS = [320, 375, 390, 414, 768, 1024, 1280, 1440, 1920];
const TOLERANCE_PX = 1.25;

const failures = [];
const fail = (message) => { failures.push(message); console.log(`[FAIL] ${message}`); };
const ok = (message) => console.log(`[ok ] ${message}`);
const check = (condition, message) => { if (!condition) fail(message); return !!condition; };

// Known test geometry, original-normalized: one large, one small, one the size
// of a real 7px microaneurysm box (which must get a locator ring).
const QA_REGIONS = [
  { id: "qa-large", finding_type: "synthetic_qa_region", localization: { kind: "bounding_box", coordinates: { x: 0.3, y: 0.3, w: 0.3, h: 0.2 } } },
  { id: "qa-small", finding_type: "synthetic_qa_region", localization: { kind: "bounding_box", coordinates: { x: 0.62, y: 0.41, w: 0.03, h: 0.02 } } },
  { id: "qa-tiny", finding_type: "synthetic_qa_region", localization: { kind: "bounding_box", coordinates: { x: 0.5443, y: 0.9043, w: 0.0047, h: 0.0037 } } },
].map((r) => ({ ...r, source_model_id: "synthetic-qa", source_model_version: "0", note: "Synthetic QA geometry (not model output)" }));

const fundusState = (state, over = {}) => ({
  state, regions: [], model_id: null, model_version: null, validation_state: "RESEARCH",
  quality_state: "pass", ood_state: "IN_DISTRIBUTION", limitations: ["Synthetic QA fixture"], ...over,
});

const STATE_CASES = [
  { label: "model executed, no localized signals", fundus: fundusState("NO_TARGET_ABNORMALITY_DETECTED", { model_id: "synthetic-qa", model_version: "0" }), code: "NO_LOCALIZED_SIGNALS" },
  { label: "model unavailable", fundus: fundusState("MODEL_UNAVAILABLE", { validation_state: "MODEL_UNAVAILABLE" }), code: "MODEL_UNAVAILABLE" },
  { label: "model failed", fundus: fundusState("MODEL_UNAVAILABLE", { model_id: "synthetic-qa", model_version: "0", validation_state: "MODEL_UNAVAILABLE" }), code: "MODEL_FAILED" },
  { label: "image quality insufficient", fundus: fundusState("IMAGE_NOT_SUITABLE", { quality_state: "fail", validation_state: "NOT_VALIDATED_FOR_IMAGE" }), code: "IMAGE_QUALITY_INSUFFICIENT" },
  { label: "out of distribution", fundus: fundusState("OUT_OF_DISTRIBUTION", { ood_state: "OUT_OF_DISTRIBUTION", validation_state: "NOT_VALIDATED_FOR_IMAGE" }), code: "OUT_OF_DISTRIBUTION" },
  { label: "not validated for this image", fundus: fundusState("MODEL_NOT_VALIDATED_FOR_IMAGE", { validation_state: "NOT_VALIDATED_FOR_IMAGE" }), code: "INSUFFICIENT_EVIDENCE" },
];

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
  if (!login.ok()) throw new Error(`login failed (HTTP ${login.status()})`);
  const csrf = (await context.storageState()).cookies.find((c) => c.name === "vsa_csrf")?.value;
  if (!csrf) throw new Error("no CSRF cookie after login");
  return csrf;
}

async function createAnalysedStudy(context, csrf) {
  const fixturePath = process.env.VIEWER_QA_FIXTURE;
  const buffer = fixturePath ? fs.readFileSync(fixturePath) : await syntheticFundus();
  const name = fixturePath ? path.basename(fixturePath) : "synthetic-viewer-qa-fundus.jpg";
  const mimeType = name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  const upload = await context.request.post(`${BASE}/api/upload`, { headers: { "x-csrf-token": csrf }, multipart: { file: { name, mimeType, buffer }, scanType: "fundus", eye: "OD" } });
  if (!upload.ok()) throw new Error(`upload failed (HTTP ${upload.status()})`);
  const { study_id: studyId } = await upload.json();
  for (const purpose of ["IMAGE_MODEL_ANALYSIS", "CLINICAL_RESEARCH_ANALYSIS"]) {
    const consent = await context.request.post(`${BASE}/api/studies/${encodeURIComponent(studyId)}/consent`, { headers: { "x-csrf-token": csrf }, data: { purpose, consentType: "explicit" } });
    if (!consent.ok()) throw new Error(`${purpose} consent failed (HTTP ${consent.status()})`);
  }
  const started = Date.now();
  const analysis = await context.request.post(`${BASE}/api/analyze`, { headers: { "x-csrf-token": csrf }, data: { study_id: studyId }, timeout: 300_000 });
  if (!analysis.ok()) throw new Error(`analysis failed (HTTP ${analysis.status()})`);
  const { analysis_mode: mode } = await analysis.json();
  return { studyId, mode, ms: Date.now() - started };
}

/** Replaces the served analysis (test-only; the stored study is never touched). */
async function interceptBundle(page, studyId, mutate) {
  await page.route((url) => url.pathname === `/api/studies/${studyId}`, async (route) => {
    const response = await route.fetch();
    const bundle = await response.json();
    mutate(bundle);
    await route.fulfill({ response, json: bundle });
  });
}

const withQaRegions = (bundle) => {
  if (!bundle.analysis) return;
  bundle.analysis.findings = [];
  bundle.analysis.fundus_abnormality = fundusState("MULTIPLE_ABNORMALITIES", { regions: QA_REGIONS, model_id: "synthetic-qa", model_version: "0" });
};

async function openResult(browser, state, studyId, { width = 1280, height, theme = "dark", mutate, image } = {}) {
  const context = await browser.newContext({ storageState: state, viewport: { width, height: height ?? (width < 800 ? 844 : 900) } });
  await context.addInitScript((t) => { try { localStorage.setItem("vsa-theme", t); } catch { /* storage blocked */ } }, theme);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 240)); });
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  if (mutate) await interceptBundle(page, studyId, mutate);
  if (image) await page.route((url) => url.pathname === `/api/studies/${studyId}/image`, (route) => route.fulfill(image));
  await page.goto(`${BASE}/result?study=${studyId}`, { waitUntil: "domcontentloaded" });
  await page.locator(".viewer-frame").first().waitFor({ state: "attached", timeout: 60_000 });
  await page.locator(".viewer-frame").first().scrollIntoViewIfNeeded();
  return { context, page, consoleErrors };
}

async function waitForSource(page, expected = "SOURCE_AVAILABLE") {
  await page.waitForFunction((s) => document.querySelector(".viewer-frame")?.getAttribute("data-source-state") === s, expected, { timeout: 30_000 });
  // fitted size is applied a frame after the image loads
  await page.waitForFunction(() => { const w = document.querySelector(".viewer-img-wrap"); return !!w && parseFloat(w.style.width || "0") > 0; }, undefined, { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(250);
}

/** Rectangles of one viewer pane's image and boxes, in page pixels (transforms included). */
function measure(page, paneIndex = 0) {
  return page.evaluate((index) => {
    const pane = document.querySelectorAll(".viewer-frame .viewer-pane")[index];
    if (!pane) return null;
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const img = pane.querySelector("img");
    return {
      src: img.getAttribute("src"), natural: { w: img.naturalWidth, h: img.naturalHeight },
      img: rect(img), pane: rect(pane), hint: pane.querySelector(".viewer-hint")?.textContent ?? "",
      boxes: [...pane.querySelectorAll(".viewer-overlay-box")].map((b) => ({
        id: b.dataset.localizationId ?? null, active: b.classList.contains("is-active"), box: rect(b),
        label: b.querySelector(".viewer-label") ? rect(b.querySelector(".viewer-label")) : null,
        locator: b.querySelector(".viewer-locator") ? rect(b.querySelector(".viewer-locator")) : null,
      })),
    };
  }, paneIndex);
}

/** Every drawn box must sit at its normalized coordinates inside the displayed image. */
function checkAlignment(label, m, expectedRegions) {
  if (!check(m, `${label}: viewer pane missing`)) return false;
  let good = check(m.boxes.length === expectedRegions.length, `${label}: ${m.boxes.length} box(es) rendered, expected ${expectedRegions.length}`);
  for (const region of expectedRegions) {
    const c = region.localization.coordinates;
    const drawn = m.boxes.find((b) => b.id === region.id);
    if (!check(drawn, `${label}: ${region.id} not rendered`)) { good = false; continue; }
    const want = { x: m.img.x + c.x * m.img.w, y: m.img.y + c.y * m.img.h, w: c.w * m.img.w, h: c.h * m.img.h };
    for (const key of ["x", "y", "w", "h"]) {
      if (Math.abs(drawn.box[key] - want[key]) > TOLERANCE_PX) { fail(`${label}: ${region.id}.${key} drawn ${drawn.box[key].toFixed(2)} expected ${want[key].toFixed(2)}`); good = false; }
    }
    if (drawn.locator) {
      const dx = drawn.locator.x + drawn.locator.w / 2 - (want.x + want.w / 2);
      const dy = drawn.locator.y + drawn.locator.h / 2 - (want.y + want.h / 2);
      if (Math.hypot(dx, dy) > TOLERANCE_PX) { fail(`${label}: ${region.id} locator ring off-centre by ${Math.hypot(dx, dy).toFixed(2)}px`); good = false; }
    }
    // A label can only be cut off if its region is in view; a region panned or
    // zoomed out of the pane takes its label with it, which is correct.
    if (centreInPane(drawn.box, m.pane) && drawn.label && (drawn.label.x < m.pane.x - 1 || drawn.label.y < m.pane.y - 1 || drawn.label.x + drawn.label.w > m.pane.x + m.pane.w + 1 || drawn.label.y + drawn.label.h > m.pane.y + m.pane.h + 1)) {
      fail(`${label}: ${region.id} label is clipped by the viewer pane`); good = false;
    }
  }
  // Labels of regions in view must not sit on top of one another.
  const visible = m.boxes.filter((b) => b.label && centreInPane(b.box, m.pane));
  for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
    const a = visible[i].label, b = visible[j].label;
    const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 2 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 2;
    if (overlap) { fail(`${label}: labels of ${visible[i].id} and ${visible[j].id} collide`); good = false; }
  }
  const tiny = m.boxes.find((b) => b.id === "qa-tiny");
  if (tiny && !check(tiny.locator, `${label}: sub-visible region has no locator ring`)) good = false;
  const large = m.boxes.find((b) => b.id === "qa-large");
  if (large && !check(!large.locator, `${label}: a clearly visible region was given a locator ring`)) good = false;
  return good;
}

const NOT_NORMAL = /(?<!not a )(?<!not )\bnormal\b(?!-fundus)/i;

// A finding whose region is NOT one of the fundus localizations: "View on scan"
// then goes through the viewer's single highlighted-region path.
const QA_FINDING_REGION = { x: 0.2, y: 0.3, w: 0.2, h: 0.15 };
const QA_FINDING = {
  id: "qa-finding-1", type: "retinal_hemorrhage", location: "unspecified", severity: "indeterminate",
  confidence: 0, confidence_category: "INDETERMINATE", confidence_raw: null, confidence_calibrated: null,
  taxonomy_level: "observation", region: QA_FINDING_REGION, explanation: "Synthetic QA finding (not model output)",
  synthetic: false, model_id: "synthetic-qa", model_version: "0", model_status: "RESEARCH", source_modality: "FUNDUS", laterality: "OD",
};
const withQaFinding = (bundle) => {
  if (!bundle.analysis) return;
  bundle.analysis.findings = [QA_FINDING];
  bundle.analysis.fundus_abnormality = fundusState("NO_TARGET_ABNORMALITY_DETECTED", { model_id: "synthetic-qa", model_version: "0" });
};

const centreInPane = (box, pane) => {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  return cx >= pane.x && cx <= pane.x + pane.w && cy >= pane.y && cy <= pane.y + pane.h;
};
const zoomPart = (readout) => readout.split("·")[0].trim();

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  let studyId = null;
  let csrf = null;
  const setupContext = await browser.newContext();
  try {
    csrf = await signIn(setupContext);
    const created = await createAnalysedStudy(setupContext, csrf);
    studyId = created.studyId;
    ok(`study ${studyId} analysed through the normal API (mode ${created.mode}, ${(created.ms / 1000).toFixed(1)}s)`);
    const state = await setupContext.storageState();

    // 1. REAL reconciliation: what the API stored vs what the browser drew.
    {
      const bundle = await (await setupContext.request.get(`${BASE}/api/studies/${studyId}`)).json();
      const fundus = bundle.analysis?.fundus_abnormality;
      const apiRegions = fundus?.regions ?? [];
      const { context, page, consoleErrors } = await openResult(browser, state, studyId);
      await page.waitForFunction(() => document.querySelector(".viewer-frame")?.getAttribute("data-analysis-state"), undefined, { timeout: 30_000 });
      await waitForSource(page);
      const m = await measure(page);
      const code = await page.locator(".viewer-frame").first().getAttribute("data-analysis-state");
      console.log(`RECONCILIATION  api_state=${fundus?.state} model=${fundus?.model_id ?? "none"}@${fundus?.model_version ?? "-"}  API regions=${apiRegions.length}  RENDERED boxes=${m.boxes.length}  viewer state=${code}`);
      check(m.boxes.length === apiRegions.length, `reconciliation: API holds ${apiRegions.length} region(s) but ${m.boxes.length} rendered`);
      for (const region of apiRegions) {
        const c = region.localization.coordinates;
        const drawn = m.boxes.find((b) => b.id === region.id);
        if (!check(drawn, `reconciliation: ${region.id} not rendered`)) continue;
        for (const [key, want] of Object.entries({ x: m.img.x + c.x * m.img.w, y: m.img.y + c.y * m.img.h })) {
          check(Math.abs(drawn.box[key] - want) <= TOLERANCE_PX, `reconciliation: ${region.id}.${key} misaligned`);
        }
      }
      check(!consoleErrors.some((e) => /same key/i.test(e)), `fresh analysis logs duplicate React keys: ${consoleErrors.find((e) => /same key/i.test(e))}`);
      const ids = (bundle.analysis?.findings ?? []).map((f) => f.id);
      check(new Set(ids).size === ids.length, `finding ids are not unique: ${ids.join(", ")}`);
      if (apiRegions.length === 0) check(code && code !== "SIGNALS_FOUND", `no regions but viewer state is ${code}`);
      ok(`real study reconciles: API ${apiRegions.length} = rendered ${m.boxes.length}, state ${code}`);
      await context.close();
    }

    // 2. Alignment at every width (dark) plus light theme at two widths.
    const matrix = WIDTHS.map((w) => ({ width: w, theme: "dark" })).concat([{ width: 390, theme: "light" }, { width: 1280, theme: "light" }]);
    for (const { width, theme } of matrix) {
      const { context, page, consoleErrors } = await openResult(browser, state, studyId, { width, theme, mutate: withQaRegions });
      await waitForSource(page);
      const label = `${theme} ${width}px`;
      const mode = await page.locator(".viewer-frame").first().getAttribute("data-view-mode");
      check(mode === "overlay", `${label}: opened in ${mode} mode, expected overlay`);
      const m = await measure(page);
      if (checkAlignment(label, m, QA_REGIONS)) ok(`${label}: ${m.boxes.length} synthetic UI regions aligned within ${TOLERANCE_PX}px; sub-visible region ringed`);
      await page.locator(".viewer-frame").first().screenshot({ path: path.join(OUT_DIR, `overlay-${theme}-${width}.png`) });
      check(consoleErrors.length === 0, `${label}: console errors: ${consoleErrors.slice(0, 2).join(" | ")}`);
      await context.close();
    }

    // 3. Original / overlay toggle, side-by-side, zoom, resize, keyboard.
    {
      const { context, page } = await openResult(browser, state, studyId, { width: 1280, mutate: withQaRegions });
      await waitForSource(page);
      const overlay = await measure(page);
      const frame = page.locator(".viewer-frame").first();
      await frame.getByRole("button", { name: "Original", exact: true }).click();
      await page.waitForTimeout(150);
      const original = await measure(page);
      check(original.boxes.length === 0, `toggle: ${original.boxes.length} box(es) drawn in Original view`);
      check(original.src === overlay.src && original.natural.w === overlay.natural.w && original.natural.h === overlay.natural.h, "toggle: the source image changed between views");
      check(Math.abs(original.img.x - overlay.img.x) < 0.5 && Math.abs(original.img.w - overlay.img.w) < 0.5, "toggle: the image moved or resized between Original and Overlay");
      const sourceHash = await page.evaluate(async () => { const r = await fetch(document.querySelector(".viewer-pane img").src, { cache: "no-store" }); const b = await r.arrayBuffer(); return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b))).map((x) => x.toString(16).padStart(2, "0")).join(""); });
      const studyHash = (await (await setupContext.request.get(`${BASE}/api/studies/${studyId}`)).json()).study?.original_sha256;
      check(sourceHash === studyHash, `toggle: served pixels (${sourceHash.slice(0, 12)}…) differ from the stored original (${String(studyHash).slice(0, 12)}…)`);
      await frame.getByRole("button", { name: "Research overlay" }).click();
      await page.waitForTimeout(150);
      check((await measure(page)).boxes.length === QA_REGIONS.length, "toggle: overlay did not return after Original");
      ok("toggle: Original shows no boxes and the same unmodified pixels; Overlay restores all regions");

      // "View on scan" must work even after the user chose Original.
      await frame.getByRole("button", { name: "Original", exact: true }).click();
      await page.getByRole("button", { name: /View on scan/ }).first().click();
      await page.waitForTimeout(200);
      check(await frame.getAttribute("data-view-mode") === "overlay", "View on scan did not switch the viewer back to the overlay");
      const highlighted = (await measure(page)).boxes.filter((b) => b.active);
      check(highlighted.length === 1, `View on scan: ${highlighted.length} highlighted box(es), expected 1`);
      check((await measure(page)).boxes.length === QA_REGIONS.length, "View on scan duplicated or dropped a region box");
      ok("View on scan returns to the overlay and highlights exactly one existing region");

      await frame.getByRole("button", { name: "Side-by-side" }).click();
      await page.waitForTimeout(500);
      const left = await measure(page, 0), right = await measure(page, 1);
      check(left && right && left.boxes.length === 0, "side-by-side: the original pane has overlays");
      if (right) checkAlignment("side-by-side overlay pane", right, QA_REGIONS) && ok("side-by-side: overlay pane aligned to its own image");
      await frame.getByRole("button", { name: "Research overlay" }).click();
      await page.waitForTimeout(300);

      // Zoom keeps alignment, keeps ring size, and Ctrl+/- stay with the browser.
      await frame.locator(".viewer-viewport").focus();
      await page.keyboard.press("+"); await page.keyboard.press("+");
      await page.waitForTimeout(250);
      const zoomed = await measure(page);
      checkAlignment("zoomed 144%", zoomed, QA_REGIONS) && ok("zoom: regions stay aligned after zooming in");
      const ctrlPrevented = await page.evaluate(() => { const e = new KeyboardEvent("keydown", { key: "=", ctrlKey: true, bubbles: true, cancelable: true }); document.querySelector(".viewer-viewport").dispatchEvent(e); return e.defaultPrevented; });
      check(!ctrlPrevented, "Ctrl+= is swallowed by the viewer (breaks browser zoom)");
      // Pan (keyboard and mouse drag) moves image and boxes together.
      const beforePan = await measure(page);
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(150);
      const keyPanned = await measure(page);
      check(Math.abs(keyPanned.img.x - beforePan.img.x) > 20, "pan: keyboard arrows did not move the image");
      checkAlignment("after keyboard pan", keyPanned, QA_REGIONS) && ok("pan: keyboard pan keeps regions aligned");
      const vp = await frame.locator(".viewer-viewport").boundingBox();
      await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
      await page.mouse.down(); await page.mouse.move(vp.x + vp.width / 2 + 45, vp.y + vp.height / 2 + 30, { steps: 6 }); await page.mouse.up();
      await page.waitForTimeout(150);
      const dragged = await measure(page);
      check(Math.abs(dragged.img.x - keyPanned.img.x) > 20, "pan: mouse drag did not move the image");
      checkAlignment("after mouse drag", dragged, QA_REGIONS) && ok("pan: mouse drag keeps regions aligned");
      check(dragged.src === overlay.src && dragged.natural.w === overlay.natural.w, "pan changed the source image");
      await page.keyboard.press("0");

      // Window resize must not reset a chosen zoom, and must keep alignment.
      await page.keyboard.press("+");
      await page.waitForTimeout(200);
      const zoomBefore = await frame.locator(".readout").innerText();
      await page.setViewportSize({ width: 900, height: 900 });
      await page.waitForTimeout(700);
      const zoomAfter = await frame.locator(".readout").innerText();
      check(zoomPart(zoomBefore) === zoomPart(zoomAfter), `resize reset the zoom (${zoomPart(zoomBefore)} -> ${zoomPart(zoomAfter)})`);
      checkAlignment("after window resize", await measure(page), QA_REGIONS) && ok("resize: zoom kept and regions still aligned");
      await context.close();
    }

    // 3b. The single highlighted-region path (a finding that is not a fundus
    // localization): drawn like any other box, labelled, aligned, and "View on
    // scan" works again for the same region after the user chose Original.
    for (const width of [1280, 390]) {
      const { context, page, consoleErrors } = await openResult(browser, state, studyId, { width, mutate: withQaFinding });
      await waitForSource(page);
      const frame = page.locator(".viewer-frame").first();
      const label = `finding region ${width}px`;
      check((await measure(page)).boxes.length === 0, `${label}: a box is drawn before anything was selected`);
      const viewButton = page.getByRole("button", { name: /View on scan/ }).first();
      await viewButton.scrollIntoViewIfNeeded();
      await viewButton.click();
      await page.waitForTimeout(250);
      const m = await measure(page);
      let good = check(m.boxes.length === 1 && m.boxes[0].id === "viewer-region", `${label}: expected one highlighted-region box, got ${m.boxes.map((b) => b.id).join(",") || "none"}`);
      if (m.boxes[0]) {
        const want = { x: m.img.x + QA_FINDING_REGION.x * m.img.w, y: m.img.y + QA_FINDING_REGION.y * m.img.h, w: QA_FINDING_REGION.w * m.img.w, h: QA_FINDING_REGION.h * m.img.h };
        for (const key of ["x", "y", "w", "h"]) good = check(Math.abs(m.boxes[0].box[key] - want[key]) <= TOLERANCE_PX, `${label}: ${key} drawn ${m.boxes[0].box[key].toFixed(2)} expected ${want[key].toFixed(2)}`) && good;
        const labelStyle = await page.locator(".viewer-overlay-box .viewer-label").first().evaluate((el) => ({ position: getComputedStyle(el).position, text: el.textContent, background: getComputedStyle(el).backgroundColor }));
        good = check(labelStyle.position === "absolute" && labelStyle.background !== "rgba(0, 0, 0, 0)", `${label}: highlighted-region label is unstyled (${JSON.stringify(labelStyle)})`) && good;
        good = check(/status not provided/.test(labelStyle.text ?? ""), `${label}: label does not disclose the missing validation status: "${labelStyle.text}"`) && good;
        good = check(m.boxes[0].label && centreInPane(m.boxes[0].box, m.pane) ? m.boxes[0].label.x >= m.pane.x - 1 && m.boxes[0].label.x + m.boxes[0].label.w <= m.pane.x + m.pane.w + 1 : true, `${label}: label clipped by the pane`) && good;
      }
      good = check(/not diagnoses/.test(await frame.locator(".viewer-status-note").innerText()), `${label}: no "not diagnoses" caption beside a drawn region`) && good;
      // Original, then the SAME region requested again.
      await frame.getByRole("button", { name: "Original", exact: true }).click();
      await page.waitForTimeout(150);
      good = check((await measure(page)).boxes.length === 0, `${label}: box still drawn in Original view`) && good;
      await viewButton.click();
      await page.waitForTimeout(250);
      good = check(await frame.getAttribute("data-view-mode") === "overlay" && (await measure(page)).boxes.length === 1, `${label}: asking for the same region again did not restore the overlay`) && good;
      check(consoleErrors.length === 0, `${label}: console errors: ${consoleErrors.slice(0, 2).join(" | ")}`);
      await frame.screenshot({ path: path.join(OUT_DIR, `finding-region-${width}.png`) });
      if (good) ok(`${label}: highlighted region drawn, styled, aligned, status disclosed; re-requesting it restores the overlay`);
      await context.close();
    }

    // 4. Every nothing-drawn state is explicit, focusable, and never reads as normal.
    for (const stateCase of STATE_CASES) {
      const { context, page } = await openResult(browser, state, studyId, { mutate: (bundle) => { if (bundle.analysis) { bundle.analysis.findings = []; bundle.analysis.fundus_abnormality = stateCase.fundus; } } });
      await waitForSource(page);
      const frame = page.locator(".viewer-frame").first();
      const code = await frame.getAttribute("data-analysis-state");
      const text = (await frame.locator(".viewer-state").innerText().catch(() => "")).replace(/\s+/g, " ");
      const boxes = await page.locator(".viewer-overlay-box").count();
      let good = check(code === stateCase.code, `state "${stateCase.label}": code ${code}, expected ${stateCase.code}`);
      good = check(boxes === 0, `state "${stateCase.label}": ${boxes} box(es) drawn`) && good;
      good = check(text.length > 40, `state "${stateCase.label}": no explanatory caption`) && good;
      good = check(!NOT_NORMAL.test(text), `state "${stateCase.label}": caption reads as normal: ${text}`) && good;
      const overlayButton = frame.getByRole("button", { name: "Research overlay" });
      good = check(await overlayButton.getAttribute("aria-disabled") === "true", `state "${stateCase.label}": overlay control is not marked unavailable`) && good;
      good = check(await overlayButton.getAttribute("aria-pressed") === "false", `state "${stateCase.label}": overlay control claims to be pressed with nothing drawn`) && good;
      const describedBy = await overlayButton.getAttribute("aria-describedby");
      good = check(!!describedBy && (await page.locator(`[id="${describedBy}"]`).innerText()).length > 10, `state "${stateCase.label}": unavailable reason is not exposed to assistive tech`) && good;
      await overlayButton.focus();
      good = check(await page.evaluate(() => document.activeElement?.textContent?.includes("Research overlay")), `state "${stateCase.label}": unavailable overlay control is not keyboard-focusable`) && good;
      await overlayButton.press("Enter");
      good = check(await frame.getAttribute("data-view-mode") === "original", `state "${stateCase.label}": activating an unavailable overlay changed the view`) && good;
      await frame.screenshot({ path: path.join(OUT_DIR, `state-${stateCase.code.toLowerCase()}.png`) });
      if (good) ok(`state "${stateCase.label}" -> ${code}: explicit caption, nothing drawn, control reachable and inert`);
      await context.close();
    }

    // 5. Missing / forbidden source: no broken image with floating overlays.
    for (const [label, image, expected] of [
      ["source missing", { status: 404, contentType: "application/json", body: JSON.stringify({ error: "SOURCE_MISSING" }) }, "SOURCE_MISSING"],
      ["source forbidden", { status: 403, contentType: "application/json", body: JSON.stringify({ error: "Forbidden" }) }, "SOURCE_UNAVAILABLE"],
    ]) {
      const { context, page } = await openResult(browser, state, studyId, { mutate: withQaRegions, image });
      await waitForSource(page, expected);
      const boxes = await page.locator(".viewer-overlay-box").count();
      const caption = (await page.locator(".viewer-state").first().innerText()).replace(/\s+/g, " ");
      const alert = await page.locator(".viewer-failed").first().innerText();
      let good = check(boxes === 0, `${label}: ${boxes} floating box(es) over a missing image`);
      good = check(alert.length > 20, `${label}: no explanation shown`) && good;
      good = check(/not drawn because the original image is unavailable/.test(caption), `${label}: analysis caption does not say the signals are undrawn`) && good;
      const note = await page.locator(".viewer-status-note").first().innerText();
      good = check(/original image could not be shown/.test(note) && !/No validated localization data available/.test(note), `${label}: status line contradicts the caption: "${note}"`) && good;
      await page.locator(".viewer-frame").first().screenshot({ path: path.join(OUT_DIR, `${expected.toLowerCase()}-${label.replace(/\W+/g, "-")}.png`) });
      if (good) ok(`${label}: no overlay drawn, explanation and undrawn-signal caption shown`);
      await context.close();
    }

    // 6. Clinician view: a study without an analysis says so.
    {
      const context = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await interceptBundle(page, studyId, (bundle) => { bundle.analysis = null; });
      await page.goto(`${BASE}/clinician?study=${studyId}`, { waitUntil: "domcontentloaded" });
      await page.getByText("Analysis not run for this study").waitFor({ timeout: 30_000 }).then(() => ok("clinician: a study without an analysis shows an explicit 'Analysis not run' state"), () => fail("clinician: no explicit state for a study without an analysis"));
      await context.close();
    }
  } catch (error) {
    fail(`gate aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (studyId && csrf) {
      const removed = await setupContext.request.delete(`${BASE}/api/studies/${encodeURIComponent(studyId)}`, { headers: { "x-csrf-token": csrf } }).catch(() => null);
      console.log(`cleanup: study ${removed?.ok() ? "deleted" : `NOT deleted (HTTP ${removed?.status() ?? "error"})`}`);
      if (!removed?.ok()) failures.push("study cleanup failed");
    }
    if (csrf) await setupContext.request.post(`${BASE}/api/auth/logout`, { headers: { "x-csrf-token": csrf } }).catch(() => null);
    await browser.close();
  }
  console.log(`screenshots: ${OUT_DIR}`);
  if (failures.length) {
    console.log(`\nVIEWER OVERLAY QA: FAILED (${failures.length} problem(s))`);
    process.exit(1);
  }
  console.log(`\nVIEWER OVERLAY QA: PASSED (real reconciliation; ${WIDTHS.length} widths + light theme; toggle/side-by-side/zoom/resize/keyboard; ${STATE_CASES.length} no-signal states; missing/forbidden source; clinician not-run)`);
}

main().catch((error) => { console.error(error); process.exit(1); });
