import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { createStudy, analyzeStudy, deleteStudy, compareStudies } from "@/lib/studies/service";
import { ensurePatient, createEncounter } from "@/lib/patients/service";
import { assessEncounterCrossModality } from "@/lib/evidence/encounterCrossModality";
import { PROJECT_ROOT } from "@/lib/config";
import type { DeviceMetadata } from "@/lib/devices/adapter";

/**
 * Encounter-level acceptance: cross-modality fundus<->OCT comparison and
 * same-eye longitudinal comparison on real analyses (non-PHI fixtures).
 * Cases C (glaucoma evidence), E (cross-eye), F (OOD) are covered by
 * tests/acceptance-multispecialist.test.ts, tests/s13-redteam.test.ts and
 * the prior-current/cross-modality unit suites; this file proves the
 * encounter-scoped and longitudinal paths end to end.
 */

const DECLARED_FUNDUS: DeviceMetadata = { scanType: "fundus", eye: "OD", providedBy: "none" };
const DECLARED_OCT: DeviceMetadata = { scanType: "oct", eye: "OD", providedBy: "none" };
const RESEARCH_LIVE =
  fs.existsSync(path.join(PROJECT_ROOT, "data", "models", "fundus-lesions-clementp-unet-seresnext50", "manifest.json")) &&
  fs.existsSync(path.join(PROJECT_ROOT, ".venv-ophthalmic", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python3"));

async function makeRedImage(): Promise<Buffer> {
  // Same style as the s13 synthetic fixture (NOT a medical image): large and
  // sharp enough to pass the real quality gate.
  const w = 1024, h = 768;
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#7a1f1f"/>` +
    `<circle cx="512" cy="384" r="300" fill="#8e2626"/>` +
    `<circle cx="640" cy="384" r="70" fill="#c96a2a"/>` +
    `<circle cx="660" cy="384" r="28" fill="#e8d9b0"/>` +
    `<path d="M 600 384 Q 500 300 380 260" stroke="#d94f2a" stroke-width="10" fill="none"/>` +
    `<path d="M 600 384 Q 500 470 380 520" stroke="#d94f2a" stroke-width="8" fill="none"/></svg>`
  );
  return sharp(svg).png().toBuffer();
}

const createdStudyIds: string[] = [];
afterAll(async () => {
  for (const id of createdStudyIds) await deleteStudy(id).catch(() => {});
});

describe("Acceptance A/B - encounter cross-modality comparison on real analyses", () => {
  it("links fundus + OCT studies and returns a scoped agreement verdict", async () => {
    const ref = `VS-XMOD-${Date.now().toString(36)}`;
    const patient = await ensurePatient(ref, "tester", "CLINICIAN_CREATED");
    const fundus = await createStudy("xmod-f.png", "image/png", await makeRedImage(), DECLARED_FUNDUS, ref);
    const octBytes = fs.readFileSync(path.join(PROJECT_ROOT, "scratch", "test_images", "oct_kermany_0.png"));
    const oct = await createStudy("xmod-o.png", "image/png", octBytes, DECLARED_OCT, ref);
    createdStudyIds.push(fundus.study_id, oct.study_id);
    await analyzeStudy(fundus.study_id);
    await analyzeStudy(oct.study_id);

    const encounter = await createEncounter({
      patient_id: patient.patient_id,
      linked_study_ids: [fundus.study_id, oct.study_id],
      created_by: "tester",
    });
    expect(encounter.ok).toBe(true);
    const encounterId = (encounter as unknown as { encounter: { encounter_id: string } }).encounter.encounter_id;

    const result = await assessEncounterCrossModalityById(encounterId);
    expect("not_found" in result).toBe(false);
    if ("not_found" in result) return;
    expect(result.encounter_id).toBe(encounterId);
    expect(result.pairs).toHaveLength(1);
    const pair = result.pairs[0];
    expect(pair.eye).toBe("OD");
    expect(pair.fundus_study_id).toBe(fundus.study_id);
    expect(pair.oct_study_id).toBe(oct.study_id);
    if (RESEARCH_LIVE) {
      // Both research models complete on these fixtures: verdict is either
      // corroboration or disagreement — never normality, never a diagnosis.
      expect(["CROSS_MODALITY_CORROBORATION", "CROSS_MODALITY_DISAGREEMENT"]).toContain(pair.agreement);
      expect(pair.notes.join(" ").toLowerCase()).not.toContain("normal fundus");
      expect(pair.notes.join(" ").toLowerCase()).not.toContain("confirmed diagnosis");
    } else {
      expect(pair.agreement).toBe("NOT_COMPARABLE");
      expect(pair.notComparableReason).toBe("MODEL_UNAVAILABLE");
    }
  }, 240000);

  it("returns not_found for an unknown encounter without throwing", async () => {
    const { assessEncounterCrossModalityById } = await import("@/lib/evidence/encounterCrossModality");
    const result = await assessEncounterCrossModalityById("enc_does_not_exist");
    expect("not_found" in result).toBe(true);
  });
});

async function assessEncounterCrossModalityById(encounterId: string) {
  const { assessEncounterCrossModalityById } = await import("@/lib/evidence/encounterCrossModality");
  return assessEncounterCrossModalityById(encounterId);
}

describe("Acceptance D - longitudinal same-eye comparison without progression claims", () => {
  it("two analyses of the same eye compare with observed-difference states only", async () => {
    const ref = `VS-LONG-${Date.now().toString(36)}`;
    const bytes = await makeRedImage();
    const prior = await createStudy("long-prior.png", "image/png", bytes, DECLARED_FUNDUS, ref);
    const current = await createStudy("long-current.png", "image/png", bytes, DECLARED_FUNDUS, ref);
    createdStudyIds.push(prior.study_id, current.study_id);
    await analyzeStudy(prior.study_id);
    await analyzeStudy(current.study_id);

    const outcome = await compareStudies(prior.study_id, current.study_id);
    expect(outcome.performed).toBe(true);
    expect(outcome.prior_current).toBeDefined();
    const pc = outcome.prior_current!;
    expect(pc.eye).toBe("OD");
    // Same bytes + same model + same (absent) device -> findings persist.
    if (RESEARCH_LIVE) {
      expect(pc.finding_states.length).toBeGreaterThan(0);
      expect(pc.finding_states.every((s) => ["NEW", "PERSISTENT", "CHANGED"].includes(s.state))).toBe(true);
    }
    const text = JSON.stringify(outcome.prior_current).toLowerCase();
    expect(text).toMatch(/do not establish disease progression/);
    expect(text).not.toMatch(/worsen/);
    expect(text).not.toMatch(/improv/);
    expect(text).not.toMatch(/resolved/);
    expect(pc.requires_clinician_review).toBe(true);
  }, 240000);
});
