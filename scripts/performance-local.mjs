// Local-only synthetic performance sample. It records observed wall-clock
// timings, not an SLO and not clinical model performance.
import sharp from "sharp";
import { performance } from "node:perf_hooks";

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
  results.metrics.clementp_model_load = null;
  results.metrics.clementp_inference = null;
  results.model_timing_notice = "Current candidate runtime is not ready; historical timings are not reproduced or promoted here.";
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => { console.error(error.message); process.exit(1); });
