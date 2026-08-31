// End-to-end smoke test against a running server (http://localhost:3000).
// Uses synthetic images only; deletes the study it creates.
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const tmp = path.join(root, "data", "tmp");
fs.mkdirSync(tmp, { recursive: true });

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
  const res = await fetch(`${BASE}/api/upload`, { method: "POST", body: fd });
  return { status: res.status, json: await res.json() };
}

async function main() {
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "[ok ]" : "[FAIL]"} ${name} ${detail}`);
  };

  // Clean, well-lit synthetic fundus-like image
  const clean = await makeImage("smoke-clean.png", (s) =>
    s(Buffer.from(
      `<svg width="1024" height="768"><rect width="1024" height="768" fill="#7a1f1f"/><circle cx="512" cy="384" r="300" fill="#8e2626"/><circle cx="640" cy="384" r="70" fill="#c96a2a"/><circle cx="660" cy="384" r="28" fill="#e8d9b0"/><path d="M 600 384 Q 500 300 380 260" stroke="#d94f2a" stroke-width="10" fill="none"/></svg>`
    )).resize(1024, 768)
  );
  // Dark image -> must be rejected by quality gate
  const dark = await makeImage("smoke-dark.png", (s) =>
    s(clean).linear(0.03, 0)
  );

  // 1. Upload + analyze clean
  const up = await upload(clean);
  check("upload clean", up.status === 201, JSON.stringify(up.json));
  const studyId = up.json.study_id;

  const an = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ study_id: studyId }),
  });
  const anJson = await an.json();
  check("analyze clean", an.status === 200, JSON.stringify(anJson).slice(0, 200));

  // 2. Bundle present, report generated
  const bundleRes = await fetch(`${BASE}/api/studies/${studyId}`);
  const bundle = await bundleRes.json();
  check("report generated", !!bundle.report, bundle.report?.overall_result);

  // 3. Quality gate rejects dark image (no findings)
  const upDark = await upload(dark);
  const anDark = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ study_id: upDark.json.study_id }),
  });
  const anDarkJson = await anDark.json();
  if (!anDark.ok) {
    check("quality gate blocks poor image", false, `analyze error: ${JSON.stringify(anDarkJson).slice(0, 200)}`);
  } else {
    const darkBundle = await (await fetch(`${BASE}/api/studies/${upDark.json.study_id}`)).json();
    check(
      "quality gate blocks poor image",
      anDarkJson.quality?.acceptable === false && darkBundle.analysis?.findings?.length === 0,
      `status=${anDarkJson.quality?.status} findings=${darkBundle.analysis?.findings?.length}`
    );
  }

  // 4. Clinician review workflow
  const rev = await fetch(`${BASE}/api/review/${studyId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewer_id: "smoke-tester", action: "finalize", note: "smoke test note" }),
  });
  const revJson = await rev.json();
  check("clinician finalize", rev.status === 200 && revJson.report?.review?.status === "clinician_finalized");

  // 5. Temporal comparison
  const cmp = await fetch(`${BASE}/api/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ previous: upDark.json.study_id, current: studyId }),
  });
  const cmpJson = await cmp.json();
  check("temporal comparison", cmp.status === 200 && cmpJson.performed === true, cmpJson.quantitative_comparison?.slice(0, 80));

  // 6. Self-test endpoint
  const st = await (await fetch(`${BASE}/api/selftest`)).json();
  check("self-test endpoint", st.all_passed === true, `${st.passed}/${st.total}`);

  // 7. Deletion
  const del = await fetch(`${BASE}/api/studies/${studyId}`, { method: "DELETE" });
  const del2 = await fetch(`${BASE}/api/studies/${upDark.json.study_id}`, { method: "DELETE" });
  check("deletion", del.status === 200 && del2.status === 200);

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
