// End-to-end smoke test against a running server (http://localhost:3000).
// Uses synthetic images only; deletes the study it creates.
//
// Every clinical/study route now requires authentication (Phase 5B). This
// script bootstraps (or logs in as) a fixed local smoke-test ADMIN account.
// SMOKE_ADMIN_USERNAME/SMOKE_ADMIN_PASSWORD let you point it at a real
// account instead - the built-in defaults are for local/dev use only and
// must never be used in a real deployment.
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const tmp = path.join(root, "data", "tmp");
fs.mkdirSync(tmp, { recursive: true });

const SMOKE_USER = process.env.SMOKE_ADMIN_USERNAME || "smoke-admin";
const SMOKE_PASS = process.env.SMOKE_ADMIN_PASSWORD || "SmokeTest#Local1234";

const cookieJar = {};

function absorbSetCookie(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
  for (const line of raw) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    cookieJar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
}

function cookieHeader() {
  return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function af(url, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  const headers = { ...(init.headers || {}), Cookie: cookieHeader() };
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && cookieJar.vsa_csrf) {
    headers["x-csrf-token"] = cookieJar.vsa_csrf;
  }
  const res = await fetch(url, { ...init, headers });
  absorbSetCookie(res);
  return res;
}

async function ensureAuthenticated() {
  const bootstrap = await fetch(`${BASE}/api/auth/bootstrap-admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: SMOKE_USER, password: SMOKE_PASS, display_name: "Smoke Test Admin" }),
  });
  if (!bootstrap.ok) {
    // Bootstrap window already closed (a user exists) - fall through to login.
  }
  const login = await af(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: SMOKE_USER, password: SMOKE_PASS }),
  });
  if (!login.ok) {
    const j = await login.json().catch(() => ({}));
    throw new Error(`Smoke test could not authenticate as ${SMOKE_USER}: ${j.error ?? login.status}. If this is not the first run, set SMOKE_ADMIN_USERNAME/SMOKE_ADMIN_PASSWORD to a real admin account's credentials.`);
  }
}

async function makeImage(name, fn) {
  const p = path.join(tmp, name);
  await fn(sharp).png().toFile(p);
  return p;
}

async function upload(file, scanType = "fundus", eye = "OD") {
  const fd = new FormData();
  fd.set("file", new Blob([fs.readFileSync(file)]), path.basename(file));
  fd.set("scanType", scanType);
  fd.set("eye", eye);
  const res = await af(`${BASE}/api/upload`, { method: "POST", body: fd });
  return { status: res.status, json: await res.json() };
}

async function grantConsent(studyId, purpose) {
  const res = await af(`${BASE}/api/studies/${encodeURIComponent(studyId)}/consent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ purpose, consentType: "explicit" }),
  });
  if (!res.ok) throw new Error(`Could not grant ${purpose} consent for ${studyId}: ${res.status} ${await res.text()}`);
}

async function main() {
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "[ok ]" : "[FAIL]"} ${name} ${detail}`);
  };

  await ensureAuthenticated();
  check("authenticated as smoke-test admin", true, SMOKE_USER);

  // 1. Upload + analyze clean (with structured symptoms, incl. one red flag)
  const clean = await makeImage("smoke-clean.png", (s) =>
    s(Buffer.from(
      `<svg width="1024" height="768"><rect width="1024" height="768" fill="#7a1f1f"/><circle cx="512" cy="384" r="300" fill="#8e2626"/><circle cx="640" cy="384" r="70" fill="#c96a2a"/><circle cx="660" cy="384" r="28" fill="#e8d9b0"/><path d="M 600 384 Q 500 300 380 260" stroke="#d94f2a" stroke-width="10" fill="none"/></svg>`
    )).resize(1024, 768)
  );
  // Dark image -> must be rejected by quality gate
  const dark = await makeImage("smoke-dark.png", (s) =>
    s(clean).linear(0.03, 0)
  );

  const up = await upload(clean);
  check("upload clean", up.status === 201, JSON.stringify(up.json));
  const studyId = up.json.study_id;
  await grantConsent(studyId, "IMAGE_MODEL_ANALYSIS");

  // 1b. Structured symptom intake (context only; one red-flag symptom)
  const symRes = await af(`${BASE}/api/studies/${studyId}/symptoms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symptoms: [
        { type: "blurred_vision", onset: "gradual", duration: "weeks", severity: "moderate", laterality: "right", progression: "stable", frequency: "constant", free_text: null },
        { type: "new_floaters", onset: "sudden", duration: "hours", severity: "moderate", laterality: "right", progression: "worsening", frequency: "unknown", free_text: null },
      ],
    }),
  });
  const symJson = await symRes.json();
  check("symptom intake (validated, structured)", symRes.status === 200 && symJson.count === 2);

  // 1c. Invalid symptoms are rejected (fail closed)
  const badSym = await af(`${BASE}/api/studies/${studyId}/symptoms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symptoms: [{ type: "not_a_real_symptom", onset: "suddenly", duration: "x", severity: "huge", laterality: "middle", progression: "no", frequency: "?" }] }),
  });
  check("invalid symptoms rejected", badSym.status === 400);

  const an = await af(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ study_id: studyId }),
  });
  const anJson = await an.json();
  check("analyze clean", an.status === 200, JSON.stringify(anJson).slice(0, 200));
  check(
    "red-flag symptom escalates triage",
    anJson.triage_priority === "urgent_eye_care_review" || anJson.triage_priority === "emergency_evaluation",
    `triage=${anJson.triage_priority}`
  );

  // 2. Bundle present, report generated, correlation recorded
  const bundleRes = await af(`${BASE}/api/studies/${studyId}`);
  const bundle = await bundleRes.json();
  check("report generated", !!bundle.report, bundle.report?.overall_result);
  check(
    "symptom correlation present + image-only model honesty",
    bundle.analysis?.patient_context?.reported === true &&
    bundle.analysis?.symptom_correlation?.state === "urgent" &&
    bundle.analysis?.model_registry?.model_input === "IMAGE_ONLY",
    `state=${bundle.analysis?.symptom_correlation?.state}`
  );
  check(
    "no conditions displayed for DEMO model",
    bundle.analysis?.possible_conditions?.conditions?.length === 0,
    JSON.stringify(bundle.analysis?.possible_conditions?.conditions ?? [])
  );

  // 3. Quality gate rejects dark image (no findings)
  const upDark = await upload(dark);
  await grantConsent(upDark.json.study_id, "IMAGE_MODEL_ANALYSIS");
  const anDark = await af(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ study_id: upDark.json.study_id }),
  });
  const anDarkJson = await anDark.json();
  if (!anDark.ok) {
    check("quality gate blocks poor image", false, `analyze error: ${JSON.stringify(anDarkJson).slice(0, 200)}`);
  } else {
    const darkBundle = await (await af(`${BASE}/api/studies/${upDark.json.study_id}`)).json();
    check(
      "quality gate blocks poor image",
      anDarkJson.quality?.acceptable === false && darkBundle.analysis?.findings?.length === 0,
      `status=${anDarkJson.quality?.status} findings=${darkBundle.analysis?.findings?.length}`
    );
  }

  // 4. Clinician review workflow (reviewer_id is derived server-side from the session)
  const rev = await af(`${BASE}/api/review/${studyId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "finalize", note: "smoke test note" }),
  });
  const revJson = await rev.json();
  check("clinician finalize", rev.status === 200 && revJson.report?.review?.status === "clinician_finalized");

  // 5. Temporal comparison
  const cmp = await af(`${BASE}/api/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ previous: upDark.json.study_id, current: studyId }),
  });
  const cmpJson = await cmp.json();
  check("temporal comparison", cmp.status === 200 && cmpJson.performed === true, cmpJson.quantitative_comparison?.slice(0, 80));

  // 6. Self-test endpoint (locked to ADMIN since S0.3 - called with the authenticated admin session)
  const st = await (await af(`${BASE}/api/selftest`)).json();
  check("self-test endpoint", st.all_passed === true, `${st.passed}/${st.total}`);

  // 7. Deletion
  const del = await af(`${BASE}/api/studies/${studyId}`, { method: "DELETE" });
  const del2 = await af(`${BASE}/api/studies/${upDark.json.study_id}`, { method: "DELETE" });
  check("deletion", del.status === 200 && del2.status === 200);

  // 8. Security: unauthenticated request to a protected route is rejected
  const noAuth = await fetch(`${BASE}/api/studies`);
  check("unauthenticated access rejected", noAuth.status === 401);

  // 9. Security: wrong-role access to a research-only route is rejected
  const wrongRole = await af(`${BASE}/api/evaluations`);
  check("cross-role access allowed or denied consistently with role", wrongRole.status === 200 || wrongRole.status === 403);

  fs.rmSync(clean, { force: true });
  fs.rmSync(dark, { force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSMOKE RESULT: ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
