import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { runResearchAnalysis } from "@/lib/evidence/researchAnalysis";
import { createStudy, deleteStudy } from "@/lib/studies/service";
import { createSession, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth/sessions";
import { PROJECT_ROOT } from "@/lib/config";
import { DeviceMetadata } from "@/lib/devices/adapter";

/**
 * S10 - real end-to-end tests for the isolated research-analysis pathway
 * (S9 SegFormer model + S5 evidence workspace, never analyzeStudy()/the
 * model registry/Gate A). Uses the real artifact from S9
 * (scratch/models/segformer-optic-disc-cup-refuge, gitignored) - tests SKIP
 * (not fail) when that artifact isn't present on a fresh checkout.
 */

const SEGFORMER_ARTIFACT = path.join(PROJECT_ROOT, "scratch", "models", "segformer-optic-disc-cup-refuge", "model.safetensors");
const REAL_FUNDUS_IMAGE = path.join(PROJECT_ROOT, "scratch", "test_images", "example_fundus.jpg");
const HAS_ARTIFACT = fs.existsSync(SEGFORMER_ARTIFACT) && fs.existsSync(REAL_FUNDUS_IMAGE);
const FALLBACK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

const createdStudyIds: string[] = [];
afterAll(async () => {
  for (const id of createdStudyIds) await deleteStudy(id).catch(() => {});
});

async function fundusStudy(): Promise<string> {
  const bytes = fs.existsSync(REAL_FUNDUS_IMAGE) ? fs.readFileSync(REAL_FUNDUS_IMAGE) : FALLBACK_PNG;
  const meta: DeviceMetadata = { scanType: "fundus", eye: "OS", providedBy: "user" };
  const study = await createStudy("real_fundus.jpg", "image/jpeg", bytes, meta);
  createdStudyIds.push(study.study_id);
  return study.study_id;
}

async function octStudy(): Promise<string> {
  const bytes = fs.existsSync(REAL_FUNDUS_IMAGE) ? fs.readFileSync(REAL_FUNDUS_IMAGE) : FALLBACK_PNG; // content doesn't matter for the modality-gate test
  const meta: DeviceMetadata = { scanType: "oct", eye: "OD", providedBy: "user" };
  const study = await createStudy("oct.jpg", "image/jpeg", bytes, meta);
  createdStudyIds.push(study.study_id);
  return study.study_id;
}

describe("S10 - modality gate (no artifact required)", () => {
  it("a non-FUNDUS study is rejected as UNSUPPORTED_MODALITY, never silently run", async () => {
    const studyId = await octStudy();
    const result = await runResearchAnalysis(studyId);
    expect(result.state).toBe("UNSUPPORTED_MODALITY");
    expect(result.findings).toEqual([]);
    expect(result.evidence_workspace).toBeNull();
  });

  it("a nonexistent study returns NOT_A_STUDY, never throws", async () => {
    const result = await runResearchAnalysis("study_does_not_exist_s10");
    expect(result.state).toBe("NOT_A_STUDY");
  });
});

describe.skipIf(!HAS_ARTIFACT)("S10 - real end-to-end research analysis", () => {
  // REAL SegFormer python-bridge inference: 60s is not enough under
  // full-suite CPU contention (documented flake). Timeout raised, assertions untouched.
  it("produces real findings with localization, merged into the evidence workspace", { timeout: 240_000 }, async () => {
    const studyId = await fundusStudy();
    const result = await runResearchAnalysis(studyId);
    expect(result.state).toBe("COMPLETED");
    expect(result.findings.length).toBeGreaterThan(0);
    for (const f of result.findings) {
      expect(f.synthetic).toBe(false); // real output, not the DEMO generator
      expect(f.taxonomy_level).toBe("observation"); // never "diagnosis"
      expect(f.confidence_calibrated == null).toBe(true); // never fabricated
      expect(f.region).toBeTruthy(); // real bbox, not fabricated - see segformer_infer.py
      expect(f.region!.x).toBeGreaterThanOrEqual(0);
      expect(f.region!.x + f.region!.w).toBeLessThanOrEqual(1.0001);
    }
    expect(result.evidence_workspace).toBeTruthy();
    const aiEvidence = result.evidence_workspace!.evidence.filter((e) => e.source_type === "AI_FINDING");
    expect(aiEvidence.length).toBe(result.findings.length);
    for (const e of aiEvidence) {
      expect(e.trust_level).toBe("UNVERIFIED"); // no validated model exists - never VALIDATED_AI_FINDING
      expect(e.laterality).toBe("OS"); // inherited from the study's declared eye, never guessed from pixels
    }
    expect(result.safety_banner).toMatch(/NOT A DIAGNOSIS/);
    expect(result.safety_banner).toMatch(/NOT CLINICALLY VALIDATED/);
  });

  it("never lets the research finding taxonomy type leak an unrecognized/unsupported finding", { timeout: 240_000 }, async () => {
    const studyId = await fundusStudy();
    const result = await runResearchAnalysis(studyId);
    for (const f of result.findings) {
      expect(["research_segmented_optic_disc_area", "research_segmented_optic_cup_area"]).toContain(f.type);
    }
  });

  it("the merged evidence workspace never contains a SUPPORTED_CONDITION from this single unverified AI finding alone", { timeout: 240_000 }, async () => {
    const studyId = await fundusStudy();
    const result = await runResearchAnalysis(studyId);
    const conditions = result.evidence_workspace!.possible_conditions;
    // A single UNVERIFIED AI_FINDING source, with no corroborating verified
    // evidence, must never alone produce SUPPORTED_CONDITION (S5's trust-gating rule).
    for (const c of conditions) {
      if (c.supporting_evidence_ids.some((id) => result.evidence_workspace!.evidence.find((e) => e.id === id)?.source_type === "AI_FINDING")) {
        expect(c.state).not.toBe("SUPPORTED_CONDITION");
      }
    }
  });
});

describe.skipIf(HAS_ARTIFACT)("S10 - no artifact present (fresh checkout)", () => {
  it("fails closed with INFERENCE_UNAVAILABLE rather than throwing", async () => {
    const studyId = await fundusStudy();
    const result = await runResearchAnalysis(studyId);
    expect(result.state).toBe("INFERENCE_UNAVAILABLE");
  }, 60_000);
});

/* ---------- route-level RBAC ---------- */

function reqFor(url: string, cookies: Record<string, string> = {}): NextRequest {
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(new URL(url, "http://localhost:3000"), { headers: { cookie: cookieHeader } });
}

const ROUTE = (await import("@/app/api/studies/[id]/research-analysis/route")) as typeof import("@/app/api/studies/[id]/research-analysis/route");

describe("S10 - GET /api/studies/[id]/research-analysis RBAC", () => {
  it("unauthenticated -> 401", async () => {
    const res = await ROUTE.GET(reqFor("http://localhost:3000/api/studies/study_x/research-analysis"), { params: { id: "study_x" } });
    expect(res.status).toBe(401);
  });

  it("TECHNICIAN and RESEARCHER -> 403", async () => {
    for (const role of ["TECHNICIAN", "RESEARCHER"] as const) {
      const { token } = await createSession({ user_id: `s10_${role}`, username: `s10_${role}`, role });
      const res = await ROUTE.GET(reqFor("http://localhost:3000/api/studies/study_x/research-analysis", { [SESSION_COOKIE]: token }), { params: { id: "study_x" } });
      expect(res.status).toBe(403);
    }
  });

  it("a fabricated study id with a valid REVIEWER session -> 404", async () => {
    const { token } = await createSession({ user_id: "s10_reviewer", username: "s10_reviewer", role: "REVIEWER" });
    const res = await ROUTE.GET(reqFor("http://localhost:3000/api/studies/study_totally_fake/research-analysis", { [SESSION_COOKIE]: token }), { params: { id: "study_totally_fake" } });
    expect(res.status).toBe(404);
  });
});
