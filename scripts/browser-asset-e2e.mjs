// Browser acceptance workflow for the server-computed asset router.
// Uses only generated, non-PHI fixtures and deletes the study at the end.
import { chromium } from "playwright-core";
import sharp from "sharp";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USERNAME = process.env.SMOKE_ADMIN_USERNAME;
const PASSWORD = process.env.SMOKE_ADMIN_PASSWORD;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function makeFundus() {
  // Deterministic metadata-free fundus-like raster: a dark circular field,
  // red/orange textured retina, and a bright optic-disc-like region.  This
  // is synthetic acceptance data only; it contains no patient imagery.
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

async function makeOct() {
  const width = 900, height = 480;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // Layer-like high-frequency texture keeps the bounded B-scan crops above
    // the engineering sharpness gate while remaining deterministic synthetic
    // data (no clinical image is embedded in the test).
    const edge = ((x + y) % 2) * 26;
    const value = Math.max(0, Math.min(255, 88 + Math.round(55 * Math.sin(y / 3) + 38 * Math.sin(x / 7) + edge)));
    const i = (y * width + x) * 3;
    raw[i] = value; raw[i + 1] = value; raw[i + 2] = value;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function makeMixedPdf(octPng) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const image = await pdf.embedPng(octPng);
  const lab = pdf.addPage([800, 600]);
  lab.drawText("LABORATORY REPORT CBC Hemoglobin 13.4 g/dL", { x: 50, y: 540, size: 16, font, color: rgb(0, 0, 0) });
  lab.drawText("Serology and chemistry reference page", { x: 50, y: 500, size: 12, font });
  const od = pdf.addPage([800, 600]);
  od.drawText("ZEISS CIRRUS Macula Thickness: Macular Cube 512x128 OD", { x: 30, y: 565, size: 13, font });
  od.drawText("Central Subfield Thickness 274 um Cube Volume 10.2 mm3", { x: 30, y: 540, size: 11, font });
  od.drawImage(image, { x: 40, y: 100, width: 720, height: 380 });
  const os = pdf.addPage([800, 600]);
  os.drawText("ZEISS CIRRUS High Definition Images: 5 Line Raster OS", { x: 30, y: 565, size: 13, font });
  os.drawText("Retinal Raster signal 286 um", { x: 30, y: 540, size: 11, font });
  os.drawImage(image, { x: 40, y: 100, width: 720, height: 380 });
  return Buffer.from(await pdf.save());
}

async function main() {
  if (!USERNAME || !PASSWORD) {
    throw new Error("Set SMOKE_ADMIN_USERNAME and SMOKE_ADMIN_PASSWORD for the local browser acceptance run.");
  }
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  let studyId;
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Username").fill(USERNAME);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click({ noWaitAfter: true });
    await page.waitForFunction(() => window.location.pathname === "/dashboard", undefined, { timeout: 10_000 });
    console.log("[ok ] Chrome login/dashboard");

    const csrf = (await context.cookies()).find((cookie) => cookie.name === "vsa_csrf")?.value;
    check(csrf, "CSRF cookie missing after login");
    const request = context.request;
    const fundus = await makeFundus();
    const upload = await request.post(`${BASE}/api/upload`, {
      headers: { "x-csrf-token": csrf },
      multipart: { file: { name: "browser-fundus.jpg", mimeType: "image/jpeg", buffer: fundus }, scanType: "unknown", eye: "OD" },
    });
    check(upload.ok(), `fundus upload failed (${upload.status()})`);
    const uploadJson = await upload.json();
    studyId = uploadJson.study_id;
    check(typeof studyId === "string", "fundus upload returned no study id");
    console.log(`[ok ] metadata-free fundus upload ${studyId}`);

    const analysis = await request.post(`${BASE}/api/analyze`, { headers: { "x-csrf-token": csrf }, data: { study_id: studyId }, timeout: 120_000 });
    check(analysis.ok(), `fundus analysis failed (${analysis.status()})`);
    const analysisJson = await analysis.json();
    check(["RESEARCH_MODEL_ANALYSIS", "MIXED_RESEARCH_AND_DEMO"].includes(analysisJson.analysis_mode), `unexpected fundus mode ${analysisJson.analysis_mode}`);
    check((analysisJson.model_execution?.models_executed ?? []).length > 0, "fundus research model did not execute");
    console.log(`[ok ] fundus research analysis ${analysisJson.analysis_mode} models=${(analysisJson.model_execution.models_executed ?? []).join(",")}`);

    const pdf = await makeMixedPdf(await makeOct());
    const documentUpload = await request.post(`${BASE}/api/studies/${encodeURIComponent(studyId)}/documents`, {
      headers: { "x-csrf-token": csrf },
      multipart: { file: { name: "mixed-oct-lab.pdf", mimeType: "application/pdf", buffer: pdf } },
    });
    check(documentUpload.ok(), `PDF upload failed (${documentUpload.status()})`);
    const documentJson = await documentUpload.json();
    const documentId = documentJson.document?.document_id;
    const jobId = documentJson.extraction_job_id;
    check(documentId && jobId, "PDF upload returned no extraction job");
    console.log(`[ok ] mixed PDF queued ${documentId} job=${jobId}`);

    let jobStatus = "queued";
    for (let i = 0; i < 120; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const jobResponse = await request.get(`${BASE}/api/jobs/${encodeURIComponent(jobId)}`);
      const job = await jobResponse.json();
      jobStatus = job.status;
      if (jobStatus === "completed" || jobStatus === "failed") break;
    }
    check(jobStatus === "completed", `PDF extraction ended ${jobStatus}`);
    console.log("[ok ] mixed PDF extraction completed");

    const reanalysis = await request.post(`${BASE}/api/analyze`, { headers: { "x-csrf-token": csrf }, data: { study_id: studyId }, timeout: 120_000 });
    check(reanalysis.ok(), `mixed analysis failed (${reanalysis.status()})`);
    const bundleResponse = await request.get(`${BASE}/api/studies/${encodeURIComponent(studyId)}`);
    check(bundleResponse.ok(), "bundle fetch failed");
    const bundle = await bundleResponse.json();
    const pages = (bundle.analysis?.document_routing ?? []).flatMap((document) => document.pages);
    const regions = bundle.analysis?.oct_region_results ?? [];
    const ledger = bundle.analysis?.model_execution_ledger ?? [];
    check(pages.some((p) => p.content_type === "LAB_RESULT"), "LAB_RESULT page missing");
    check(pages.some((p) => p.content_type === "OCT_MACULAR_CUBE" && p.laterality === "OD"), "OD OCT page missing");
    check(pages.some((p) => p.content_type === "OCT_RASTER" && p.laterality === "OS"), "OS OCT page missing");
    check(regions.length > 0, "no OCT B-scan ROI result recorded");
    check(ledger.length >= 4, `execution ledger is incomplete (${ledger.length} rows)`);
    check(ledger.some((row) => row.task === "fundus_lesion_localization" && row.input_roi_id === null), "primary fundus ledger row missing");
    check(ledger.some((row) => row.task === "oct_classification" && row.input_roi_id), "OCT ROI ledger row missing");
    console.log(`[ok ] mixed PDF routing pages=${pages.length} OCT_ROIs=${regions.length}`);

    await page.goto(`${BASE}/report?study=${encodeURIComponent(studyId)}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    const body = await page.locator("body").innerText();
    check(/Uploaded assets|Document doc_/i.test(body), "report omitted PDF routing");
    check(/RESEARCH MODEL ANALYSIS|RESEARCH/i.test(body), "report omitted research provenance");
    console.log("[ok ] report shows research provenance and PDF routing");
    console.log("BROWSER ASSET E2E: PASSED");
  } finally {
    if (studyId) {
      const csrf = (await context.cookies()).find((cookie) => cookie.name === "vsa_csrf")?.value;
      if (csrf) await context.request.delete(`${BASE}/api/studies/${encodeURIComponent(studyId)}`, { headers: { "x-csrf-token": csrf } }).catch(() => {});
    }
    await browser.close();
  }
}

main().catch((error) => { console.error(`BROWSER ASSET E2E FAILED: ${error.message}`); process.exit(1); });
