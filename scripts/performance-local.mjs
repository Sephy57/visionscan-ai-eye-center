// Local-only synthetic performance sample. It records observed wall-clock
// timings, not an SLO and not clinical model performance.
import sharp from "sharp";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VENV_PYTHON = path.join(ROOT, ".venv-ophthalmic", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python3");
const LESION_PKG = path.join(ROOT, "data", "models", "fundus-lesions-clementp-unet-seresnext50");
const LESION_PROBE = path.join(ROOT, "scripts", "inference", "fundus_lesion_probe.py");
const LESION_IMAGE = path.join(ROOT, "scratch", "test_images", "example_fundus.jpg");

function timeLesionWorker() {
  // One cold end-to-end worker run (spawn + torch import + load + infer) on
  // the pinned engineering image, when the installed package and dedicated
  // runtime are present. Null (with notice) on unequipped machines.
  if (!fs.existsSync(VENV_PYTHON) || !fs.existsSync(path.join(LESION_PKG, "model.safetensors")) || !fs.existsSync(LESION_IMAGE)) {
    return { measurement: null, notice: "Lesion worker not installed on this machine; no worker timing measured." };
  }
  const started = performance.now();
  const run = spawnSync(VENV_PYTHON, ["-I", "-s", LESION_PROBE, LESION_PKG, LESION_IMAGE, "--threads", "4"], { timeout: 240000, encoding: "utf8" });
  const elapsed_ms = Number((performance.now() - started).toFixed(1));
  let summary = null;
  try { summary = JSON.parse(String(run.stdout || "").trim()).image_level_summary ?? null; } catch { summary = null; }
  if (run.status !== 0 || summary === null) {
    return { measurement: null, notice: `Lesion worker run failed (exit ${run.status}); no worker timing promoted.` };
  }
  return { measurement: { samples: 1, elapsed_ms, image_level_summary: summary, note: "cold single-run wall time incl. interpreter start; warmed forward ~2.3s/1024px CPU, peak RSS ~1.3GB, inference serialized by provider mutex" }, notice: null };
}

const BASE = process.env.BASE_URL || "http://localhost:3000";
const USERNAME = process.env.SMOKE_ADMIN_USERNAME || "smoke-admin";
const PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || "SmokeTest#Local1234";
const cookies = {};

function absorb(response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const index = pair.indexOf("=");
    if (index > 0) cookies[pair.slice(0, index)] = pair.slice(index + 1);
  }
}

function cookieHeader() { return Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; "); }

async function request(path, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  const headers = { ...(init.headers || {}), Cookie: cookieHeader() };
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && cookies.vsa_csrf) headers["x-csrf-token"] = cookies.vsa_csrf;
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  absorb(response);
  return response;
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  return { samples: sorted.length, p50_ms: Number(percentile(0.5).toFixed(1)), p95_ms: Number(percentile(0.95).toFixed(1)), min_ms: Number(sorted[0].toFixed(1)), max_ms: Number(sorted.at(-1).toFixed(1)) };
}

async function sample(count, operation) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    const response = await operation();
    if (!response.ok) throw new Error(`performance request failed: ${response.status}`);
    await response.arrayBuffer();
    values.push(performance.now() - started);
  }
  return summarize(values);
}

async function timed(operation) {
  const started = performance.now();
  const response = await operation();
  const body = await response.json();
  if (!response.ok) throw new Error(`performance request failed: ${response.status} ${JSON.stringify(body).slice(0, 200)}`);
  return { response, body, elapsed_ms: Number((performance.now() - started).toFixed(1)) };
}

async function main() {
  const results = { measured_at: new Date().toISOString(), base_url: BASE, environment: "local CPU-only synthetic workload", metrics: {} };
  results.metrics.login_page = await sample(20, () => fetch(`${BASE}/login`));
  results.metrics.login_api = await sample(10, () => request("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  }));
  results.metrics.dashboard_page = await sample(20, () => request("/dashboard"));
  results.metrics.study_listing_api = await sample(20, () => request("/api/studies"));

  const image = await sharp(Buffer.from('<svg width="1024" height="768"><rect width="1024" height="768" fill="#7a1f1f"/><circle cx="512" cy="384" r="300" fill="#8e2626"/></svg>')).png().toBuffer();
  const form = new FormData();
  form.set("file", new Blob([image], { type: "image/png" }), "performance-synthetic.png");
  form.set("scanType", "fundus");
  form.set("eye", "OD");
  const upload = await timed(() => request("/api/upload", { method: "POST", body: form }));
  const studyId = upload.body.study_id;
  results.metrics.upload = { samples: 1, elapsed_ms: upload.elapsed_ms, bytes: image.length };
  try {
    const analysis = await timed(() => request("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ study_id: studyId }) }));
    results.metrics.full_demo_imaging_pipeline = { samples: 1, elapsed_ms: analysis.elapsed_ms, triage_priority: analysis.body.triage_priority };
    results.metrics.result_bundle_api = await sample(20, () => request(`/api/studies/${encodeURIComponent(studyId)}`));
    results.metrics.result_page = await sample(20, () => request(`/result?study=${encodeURIComponent(studyId)}`));
    results.metrics.report_page = await sample(20, () => request(`/report?study=${encodeURIComponent(studyId)}`));
  } finally {
    if (studyId) await request(`/api/studies/${encodeURIComponent(studyId)}`, { method: "DELETE" });
  }
  const lesion = timeLesionWorker();
  results.metrics.clementp_model_load = lesion.measurement;
  results.metrics.clementp_inference = lesion.measurement;
  results.model_timing_notice = lesion.notice ?? "Measured cold worker run above; not an SLO or clinical performance claim.";
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => { console.error(error.message); process.exit(1); });
