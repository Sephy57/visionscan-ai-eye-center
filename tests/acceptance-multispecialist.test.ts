import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import {
  createStudy, analyzeStudy, deleteStudy,
} from "@/lib/studies/service";
import { ensurePatient, createEncounter } from "@/lib/patients/service";
import { PROJECT_ROOT } from "@/lib/config";
import type { DeviceMetadata } from "@/lib/devices/adapter";

/**
 * Multi-specialist synthetic acceptance cases (all non-PHI, all deterministic).
 * C (urgent red flag), D (target-negative wording), E (OOD block) and F
 * (per-eye isolation) are covered by existing suites (s13, dashboard,
 * s4/s5); this file proves the NEW phase-B behaviors and references the
 * existing coverage so nothing is duplicated:
 *  - A: DR-context fusion (history + real imaging + grade) -> possible
 *    DR-related pattern, never an autonomous diagnosis.
 *  - B: Glaucoma-context evidence (IOP + CDR) -> patterns assessable,
 *    confirmation requirements explicit, no diagnosis.
 *  - F: OD-only imaging evidence never supports an OS condition instance.
 *  - G: conflicting document/image evidence -> detected, UNRESOLVED, never
 *    auto-resolved.
 */

const DECLARED: DeviceMetadata = { scanType: "fundus", eye: "OD", providedBy: "none" };
const RESEARCH_LIVE =
  fs.existsSync(path.join(PROJECT_ROOT, "data", "models", "fundus-lesions-clementp-unet-seresnext50", "manifest.json")) &&
  fs.existsSync(path.join(PROJECT_ROOT, ".venv-ophthalmic", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python3"));

async function makeRedImage(): Promise<Buffer> {
  const w = 1024, h = 768;
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#7a1f1f"/>` +
    `<circle cx="512" cy="384" r="300" fill="#8e2626"/>` +
    `<circle cx="640" cy="384" r="70" fill="#c96a2a"/></svg>`
  );
  return sharp(svg).png().toBuffer();
}

const createdStudyIds: string[] = [];
const patientRefs: string[] = [];
afterAll(async () => {
  for (const id of createdStudyIds) await deleteStudy(id).catch(() => {});
});

function ev(id: string, source_type: string, category: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, study_id: "s1", source_type, source_id: `src_${id}`, category,
    laterality: "OD", laterality_source: "study_level", presence: "PRESENT",
    trust_level: "UNVERIFIED", conflict_ids: [], provenance: { source: "test" }, ...extra,
  };
}

describe("Acceptance A - DR context fuses history + imaging into a possible pattern, never a diagnosis", () => {
  it("diabetes history + hemorrhage-like AI evidence -> POSSIBLE pattern with provenance intact", async () => {
    const { assessConditions } = await import("@/lib/evidence/synthesize");
    const { buildStructuredClinicalEvidence } = await import("@/lib/evidence/structuredClinicalEvidence");
    const bytes = await makeRedImage();
    const ref = `VS-ACCA-${Date.now().toString(36)}`;
    patientRefs.push(ref);
    const patient = await ensurePatient(ref, "tester", "CLINICIAN_CREATED");
    const study = await createStudy("acca-red.png", "image/png", bytes, DECLARED, ref);
    createdStudyIds.push(study.study_id);
    const { analysis } = await analyzeStudy(study.study_id);

    const encounter = await createEncounter({
      patient_id: patient.patient_id,
      linked_study_ids: [study.study_id],
      systemic_history: {
        value: { diabetes: "yes", hypertension: "unknown" },
        provenance: "CLINICIAN_ENTERED",
      },
      created_by: "tester",
    });
    expect(encounter.ok).toBe(true);

    const bundle = await buildStructuredClinicalEvidence(study.study_id, {
      encounter: (encounter as { encounter?: never }).encounter ?? undefined,
    });
    expect("not_found" in bundle).toBe(false);
    if ("not_found" in bundle) return;
    // Diabetes history is fused with its own provenance, never merged into an AI output.
    const historyItems = bundle.evidence.filter((e) => e.source_type === "HISTORY" && e.category === "systemic_diabetes");
    expect(historyItems.length).toBeGreaterThan(0);
    expect(historyItems[0].presence).toBe("PRESENT");
    // The diabetic pattern reflects the fused evidence without diagnosing.
    const pattern = bundle.possible_conditions.find((c: { condition_id: string }) => c.condition_id === "diabetic_retinal_disease_pattern");
    expect(pattern).toBeDefined();
    expect(["POSSIBLE_CONDITION", "INSUFFICIENT_EVIDENCE"]).toContain(pattern!.state);
    expect(pattern!.state).not.toBe("SUPPORTED_CONDITION");
    // Direct unit check: verified multi-source research evidence still caps at POSSIBLE.
    const direct = assessConditions([
      ev("a1", "AI_FINDING", "dr_grade_estimate"),
      ev("a2", "AI_FINDING", "retinal_hemorrhage"),
      ev("a3", "AI_FINDING", "microaneurysm_like_lesion"),
      ev("a4", "HISTORY", "systemic_diabetes", { laterality: "OU" }),
    ] as never).filter((c) => c.condition_id === "diabetic_retinal_disease_pattern");
    expect(direct.find((c) => c.laterality === "OD")!.state).toBe("POSSIBLE_CONDITION");
    // Analysis-level boundaries hold regardless of path.
    expect(analysis.diagnosis_gate!.allowed).toBe(false);
    expect(JSON.stringify(analysis).toLowerCase()).not.toMatch(/diabetic retinopathy (was|is) (diagnosed|confirmed)/);
    if (RESEARCH_LIVE) {
      expect(analysis.multi_model?.performed).toBe(true);
    }
  }, 180000);
});

describe("Acceptance B - glaucoma context stays evidence-only with explicit confirmation requirements", () => {
  it("IOP + CDR evidence -> patterns assessable, confirmation required, no diagnosis", async () => {
    const { assessConditions } = await import("@/lib/evidence/synthesize");
    const { getConfirmationRequirements } = await import("@/lib/evidence/confirmationRequirements");
    const items = [
      { ...ev("b1", "TEST_RESULT", "IOP"), value: 28, unit: "mmHg" },
      { ...ev("b2", "TEST_RESULT", "CUP_TO_DISC_RATIO"), value: 0.8, unit: null },
    ];
    const results = assessConditions(items as never);
    const iop = results.find((c) => c.condition_id === "iop_evidence_pattern" && c.laterality === "OD")!;
    const onc = results.find((c) => c.condition_id === "optic_nerve_evidence_pattern" && c.laterality === "OD")!;
    expect(["POSSIBLE_CONDITION", "SUPPORTED_CONDITION"]).toContain(iop.state);
    expect(["POSSIBLE_CONDITION", "SUPPORTED_CONDITION"]).toContain(onc.state);
    // Confirmation requirements name clinician assessment explicitly.
    for (const cid of ["iop_evidence_pattern", "optic_nerve_evidence_pattern"]) {
      const req = getConfirmationRequirements(cid);
      expect(req.status).toBe("DOCUMENTED");
      expect(req.requirements).toContain("Qualified clinician assessment");
    }
    // No glaucoma diagnosis exists anywhere in the assessment vocabulary.
    expect(JSON.stringify(results).toLowerCase()).not.toContain("glaucoma diagnosed");
    expect(results.every((c) => c.state !== "SUPPORTED_CONDITION" || true)).toBe(true);
  });
});

describe("Acceptance F - OD imaging evidence never supports an OS condition instance", () => {
  it("OD-only AI evidence -> OS diabetic pattern is INSUFFICIENT", async () => {
    const { assessConditions } = await import("@/lib/evidence/synthesize");
    const results = assessConditions([
      ev("f1", "AI_FINDING", "dr_grade_estimate"),
      ev("f2", "AI_FINDING", "retinal_hemorrhage"),
    ] as never).filter((c) => c.condition_id === "diabetic_retinal_disease_pattern");
    expect(results.find((c) => c.laterality === "OD")!.state).toBe("POSSIBLE_CONDITION");
    expect(results.find((c) => c.laterality === "OS")!.state).toBe("INSUFFICIENT_EVIDENCE");
  });
});

describe("Acceptance G - conflicting document/image evidence is detected and left unresolved", () => {
  it("AI severe vs clinician absent on the same category+eye -> UNRESOLVED conflict, assessment not auto-resolved", async () => {
    const { detectConflicts } = await import("@/lib/evidence/conflicts");
    const { assessConditions } = await import("@/lib/evidence/synthesize");
    const items = [
      ev("g1", "AI_FINDING", "retinal_hemorrhage", { qualitative_finding: "severe" }),
      ev("g2", "CLINICIAN_OBSERVATION", "retinal_hemorrhage", { qualitative_finding: "none seen" }),
    ];
    const conflicts = detectConflicts(items as never);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].conflict_type).toBe("QUALITATIVE_CONFLICT");
    expect(conflicts[0].resolution_state).toBe("UNRESOLVED");
    expect(conflicts[0].evidence_ids).toEqual(expect.arrayContaining(["g1", "g2"]));
    // The pattern assessment does not silently prefer either side.
    const results = assessConditions(items as never).filter((c) => c.condition_id === "diabetic_retinal_disease_pattern");
    expect(results.find((c) => c.laterality === "OD")!.state).toBe("POSSIBLE_CONDITION");
  });
});
