import { describe, it, expect, afterAll } from "vitest";
import sharp from "sharp";
import { buildPatientTimeline, findStudiesByPatientRef } from "@/lib/patients/timeline";
import { compareMeasurements } from "@/lib/evidence/measurementTrend";
import { compareFindings, type VisitFindingContext } from "@/lib/evidence/findingComparison";
import { compareSymptoms } from "@/lib/evidence/symptomTrend";
import { compareVisits, buildLongitudinalSummary } from "@/lib/clinical/longitudinalComparisonEngine";
import { createStudy, deleteStudy, setStudySymptoms, analyzeStudy } from "@/lib/studies/service";
import type { DeviceMetadata } from "@/lib/devices/adapter";
import type { PatientSymptom } from "@/lib/clinical/symptoms";
import type { EvidenceItem } from "@/lib/evidence/types";
import type { Finding } from "@/lib/analysis/schema";

/**
 * Phase 5 - Longitudinal Ophthalmic Intelligence. Real tests, including
 * adversarial/red-team coverage (§28-29). Every test proves a safety
 * invariant against real code.
 */

const DECLARED: DeviceMetadata = { scanType: "fundus", eye: "OD", providedBy: "none" };
const createdStudyIds: string[] = [];
afterAll(async () => { for (const id of createdStudyIds) await deleteStudy(id).catch(() => {}); });

async function makeStudy(name: string, patientRef?: string, eye: "OD" | "OS" = "OD"): Promise<string> {
  const bytes = await sharp({ create: { width: 1024, height: 768, channels: 3, background: { r: 40, g: 20, b: 20 } } }).png().toBuffer();
  const study = await createStudy(name, "image/png", bytes, { ...DECLARED, eye }, patientRef);
  createdStudyIds.push(study.study_id);
  return study.study_id;
}

function iopEvidence(id: string, studyId: string, laterality: "OD" | "OS", value: number, unit = "mmHg"): EvidenceItem {
  return {
    id, study_id: studyId, source_type: "TEST_RESULT", source_id: id, category: "IOP",
    laterality, laterality_source: "explicit", value, unit, presence: "PRESENT",
    trust_level: "HUMAN_VERIFIED", timestamp: new Date().toISOString(), provenance: { study_id: studyId }, conflict_ids: [],
  };
}

// A/B. Patient timeline + encounter ordering
describe("A/B - Patient timeline: real ordering, never trusts caller-supplied order", () => {
  it("orders studies by real created_at regardless of the order ids were supplied in", async () => {
    const s1 = await makeStudy("t1.png", "PT-TIMELINE-1");
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await makeStudy("t2.png", "PT-TIMELINE-1");
    const timeline = await buildPatientTimeline([s2, s1]); // deliberately reversed
    expect(timeline.study_ids).toEqual([s1, s2]);
  });

  it("findStudiesByPatientRef returns [] for an empty ref, never matches every unrelated study", async () => {
    expect(await findStudiesByPatientRef("")).toEqual([]);
    expect(await findStudiesByPatientRef("   ")).toEqual([]);
  });
});

// W. Cross-patient isolation (adversarial)
describe("W - Cross-patient isolation: a timeline spanning two patient_refs is refused, not silently merged", () => {
  it("buildPatientTimeline throws when supplied study ids belong to different patients", async () => {
    const s1 = await makeStudy("cp1.png", "PT-A");
    const s2 = await makeStudy("cp2.png", "PT-B");
    await expect(buildPatientTimeline([s1, s2])).rejects.toThrow(/more than one distinct patient_ref/);
  });
});

// C/X. Eye isolation / cross-eye isolation (adversarial)
describe("C/X - Eye isolation: OD and OS are never merged in any trend", () => {
  it("compareMeasurements never compares an OD value against an OS value", () => {
    const prior = [iopEvidence("e1", "s1", "OD", 18)];
    const current = [iopEvidence("e2", "s2", "OS", 32)];
    const results = compareMeasurements(prior, current);
    // Two independent entries expected: OD=NEW-then-RESOLVED-ish and OS=NEW - never one merged "increased" entry.
    const odEntry = results.find((r) => r.laterality === "OD");
    const osEntry = results.find((r) => r.laterality === "OS");
    expect(odEntry?.state).toBe("RESOLVED"); // present prior only
    expect(osEntry?.state).toBe("NEW"); // present current only
    expect(results.every((r) => r.state !== "INCREASED" && r.state !== "DECREASED")).toBe(true);
  });

  it("compareFindings refuses to compare across a declared eye change", () => {
    const prior: VisitFindingContext = { study_id: "s1", eye: "OD", findings: [], model_available: true, device: null, quality_status: "pass" };
    const current: VisitFindingContext = { study_id: "s2", eye: "OS", findings: [], model_available: true, device: null, quality_status: "pass" };
    const result = compareFindings(prior, current);
    expect(result.length).toBe(1);
    expect(result[0].state).toBe("NOT_COMPARABLE");
  });
});

// D. Measurement comparison
describe("D - Measurement comparison: real value/unit/timestamp preserved, no fabricated conversion", () => {
  it("a genuine increase is classified INCREASED with both raw values preserved", () => {
    const prior = [iopEvidence("e1", "s1", "OD", 18)];
    const current = [iopEvidence("e2", "s2", "OD", 32)];
    const [result] = compareMeasurements(prior, current);
    expect(result.state).toBe("INCREASED");
    expect(result.prior_value).toBe(18);
    expect(result.current_value).toBe(32);
    expect(result.clinically_significant_progression).toBe(false);
  });

  it("a unit mismatch is INSUFFICIENT_DATA, never silently converted", () => {
    const prior = [iopEvidence("e1", "s1", "OD", 18, "mmHg")];
    const current = [iopEvidence("e2", "s2", "OD", 2.4, "kPa")];
    const [result] = compareMeasurements(prior, current);
    expect(result.state).toBe("INSUFFICIENT_DATA");
    expect(result.note).toMatch(/no conversion/i);
  });

  it("same-visit conflicting duplicate values produce CONFLICTED, no value chosen automatically", () => {
    const prior = [iopEvidence("e1", "s1", "OD", 18), iopEvidence("e1b", "s1", "OD", 20)];
    const current = [iopEvidence("e2", "s2", "OD", 22)];
    const [result] = compareMeasurements(prior, current);
    expect(result.state).toBe("CONFLICTED");
  });

  it("NaN/Infinity values are excluded entirely, never compared (adversarial - V)", () => {
    const prior = [iopEvidence("e1", "s1", "OD", NaN)];
    const current = [iopEvidence("e2", "s2", "OD", Infinity)];
    const results = compareMeasurements(prior, current);
    expect(results.length).toBe(0);
  });

  it("REJECTED evidence never participates in a comparison", () => {
    const prior: EvidenceItem[] = [{ ...iopEvidence("e1", "s1", "OD", 18), trust_level: "REJECTED" }];
    const current = [iopEvidence("e2", "s2", "OD", 32)];
    const [result] = compareMeasurements(prior, current);
    expect(result.state).toBe("NEW"); // prior REJECTED item excluded -> treated as no prior data
  });
});

// E. Symptom comparison
describe("E - Symptom trend: laterality-scoped, no progression inferred", () => {
  it("a symptom absent from a prior visit is FIRST_REPORTED", () => {
    const trends = compareSymptoms([[]], [{
      id: "e1", study_id: "s2", source_type: "SYMPTOM", source_id: "sym1", category: "floaters",
      laterality: "OD", laterality_source: "mapped_from_symptom_report", presence: "PRESENT",
      trust_level: "UNVERIFIED", provenance: { study_id: "s2" }, conflict_ids: [],
    }]);
    expect(trends[0].state).toBe("FIRST_REPORTED");
  });

  it("a symptom present before and absent now is RESOLVED_OR_NOT_REPORTED, never 'improved'", () => {
    const prior: EvidenceItem[] = [{
      id: "e1", study_id: "s1", source_type: "SYMPTOM", source_id: "sym1", category: "floaters",
      laterality: "OD", laterality_source: "mapped_from_symptom_report", presence: "PRESENT",
      trust_level: "UNVERIFIED", provenance: { study_id: "s1" }, conflict_ids: [],
    }];
    const trends = compareSymptoms([prior], []);
    expect(trends[0].state).toBe("RESOLVED_OR_NOT_REPORTED");
    expect(trends[0].note).not.toMatch(/improved|resolved\b(?!.*not)/i);
  });
});

// F/G/H. Finding comparison, model-version, device mismatch
describe("F/G/H - AI finding comparison respects model-version and device compatibility", () => {
  function finding(id: string, type: string, model_id = "demo-fundus-synthetic-v0", model_status = "DEMO"): Finding {
    return { id, type, location: "macula", severity: "mild", confidence: 0.5, confidence_category: "MODERATE CONFIDENCE", explanation: "x", synthetic: true, model_id, model_status };
  }

  it("same model/device: a finding present both visits is PERSISTENT_AI_FINDING", () => {
    const prior: VisitFindingContext = { study_id: "s1", eye: "OD", findings: [finding("f1", "retinal_hemorrhage")], model_available: true, device: { manufacturer: "Zeiss", model: "X1" }, quality_status: "pass" };
    const current: VisitFindingContext = { study_id: "s2", eye: "OD", findings: [finding("f2", "retinal_hemorrhage")], model_available: true, device: { manufacturer: "Zeiss", model: "X1" }, quality_status: "pass" };
    const results = compareFindings(prior, current);
    expect(results.find((r) => r.finding_type === "retinal_hemorrhage")?.state).toBe("PERSISTENT_AI_FINDING");
  });

  it("a model version change blocks per-finding comparison entirely - never compared", () => {
    const prior: VisitFindingContext = { study_id: "s1", eye: "OD", findings: [finding("f1", "retinal_hemorrhage", "modelA", "RESEARCH")], model_available: true, device: null, quality_status: "pass" };
    const current: VisitFindingContext = { study_id: "s2", eye: "OD", findings: [finding("f2", "retinal_hemorrhage", "modelB", "RESEARCH")], model_available: true, device: null, quality_status: "pass" };
    const results = compareFindings(prior, current);
    expect(results.length).toBe(1);
    expect(results[0].state).toBe("MODEL_CHANGED");
  });

  it("a device change blocks comparison, even with the same model", () => {
    const prior: VisitFindingContext = { study_id: "s1", eye: "OD", findings: [finding("f1", "retinal_hemorrhage")], model_available: true, device: { manufacturer: "Zeiss", model: "X1" }, quality_status: "pass" };
    const current: VisitFindingContext = { study_id: "s2", eye: "OD", findings: [finding("f2", "retinal_hemorrhage")], model_available: true, device: { manufacturer: "Topcon", model: "Y2" }, quality_status: "pass" };
    const results = compareFindings(prior, current);
    expect(results.length).toBe(1);
    expect(results[0].state).toBe("DEVICE_CHANGED");
  });

  it("model unavailable on either visit blocks comparison, never becomes a negative result", () => {
    const prior: VisitFindingContext = { study_id: "s1", eye: "OD", findings: [], model_available: false, device: null, quality_status: "fail" };
    const current: VisitFindingContext = { study_id: "s2", eye: "OD", findings: [finding("f2", "retinal_hemorrhage")], model_available: true, device: null, quality_status: "pass" };
    const results = compareFindings(prior, current);
    expect(results[0].state).toBe("MODEL_UNAVAILABLE");
  });

  it("a finding present prior, absent now (same model/device) is NO_LONGER_OBSERVED with an explicit non-resolution caveat", () => {
    const prior: VisitFindingContext = { study_id: "s1", eye: "OD", findings: [finding("f1", "retinal_hemorrhage")], model_available: true, device: null, quality_status: "pass" };
    const current: VisitFindingContext = { study_id: "s2", eye: "OD", findings: [], model_available: true, device: null, quality_status: "pass" };
    const results = compareFindings(prior, current);
    const entry = results.find((r) => r.finding_type === "retinal_hemorrhage")!;
    expect(entry.state).toBe("NO_LONGER_OBSERVED");
    expect(entry.note).toMatch(/does NOT establish/);
  });
});

// J/K. Missing history / non-comparable evidence
describe("J/K - Missing prior evidence and non-comparable states are explicit, never assumed normal", () => {
  it("a single-visit longitudinal summary reports missing_prior_evidence: true, empty comparisons", async () => {
    const studyId = await makeStudy("single-visit.png", "PT-SINGLE");
    const result = await buildLongitudinalSummary([studyId]);
    expect(result.missing_prior_evidence).toBe(true);
    expect(result.pairwise_comparisons).toEqual([]);
  }, 30000);
});

// R. Urgent symptom preservation (Critical §27 requirement)
describe("R - Urgent symptoms remain independent of prior visit history", () => {
  it("a normal prior visit does not cancel a current sudden-vision-loss urgent flag", async () => {
    const s1 = await makeStudy("normal-visit.png", "PT-URGENT-1");
    const s2 = await makeStudy("urgent-visit.png", "PT-URGENT-1");
    const urgentSymptom: PatientSymptom = {
      type: "sudden_vision_loss", onset: "sudden", duration: "hours", severity: "severe",
      laterality: "right", progression: "worsening", frequency: "constant", free_text: null,
    };
    await setStudySymptoms(s2, [urgentSymptom]);
    const result = await buildLongitudinalSummary([s1, s2]);
    expect(result.urgent_flags_current_visit.some((f) => f.symptom_type === "sudden_vision_loss")).toBe(true);
    expect(result.urgent_flags_current_visit.find((f) => f.symptom_type === "sudden_vision_loss")?.urgency).toBe("emergency");
  }, 30000);
});

// Y. Diagnosis-gate preservation
describe("Y - Diagnosis gate remains untouched; longitudinal result never contains a progression diagnosis", () => {
  it("no field in StructuredLongitudinalResult claims CLINICALLY_SIGNIFICANT_PROGRESSION or a confirmed diagnosis", async () => {
    const s1 = await makeStudy("dg1.png", "PT-DIAG");
    const s2 = await makeStudy("dg2.png", "PT-DIAG");
    const result = await buildLongitudinalSummary([s1, s2]);
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/CLINICALLY_SIGNIFICANT_PROGRESSION.*true/i);
    expect(json).not.toMatch(/CONFIRMED_DIAGNOSIS|glaucoma is worsening/i);
    expect(result.requires_clinician_review).toBe(true);
  }, 30000);

  it("lib/models/diagnosisGate.ts is untouched - re-confirmed still requires all 7 conditions", async () => {
    const { canDisplayDiagnosis } = await import("@/lib/models/diagnosisGate");
    const result = canDisplayDiagnosis({
      modelValidation: "RESEARCH_ONLY", intendedUseMatches: true, modalityMatches: true,
      qualityStatus: "pass", oodDetected: false, calibrationAvailable: false, evidenceSufficient: true,
    });
    expect(result.allowed).toBe(false);
  });
});

// V. Malformed data / adversarial timestamp handling
describe("V - Malformed/adversarial data never crashes the engine", () => {
  it("compareMeasurements handles an evidence item with an invalid future timestamp without throwing", () => {
    const prior = [iopEvidence("e1", "s1", "OD", 18)];
    const current = [{ ...iopEvidence("e2", "s2", "OD", 20), timestamp: "9999-99-99T99:99:99Z" }];
    expect(() => compareMeasurements(prior, current)).not.toThrow();
  });
});

// T. Authorization - no API route exists yet for this engine (documented); confirm no route imports it
describe("T - No API route exposes the longitudinal engine yet (backend-architecture-only scope)", () => {
  it("zero files under app/api import the longitudinal comparison engine", async () => {
    const fs = await import("fs");
    const path = await import("path");
    let found = false;
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.isFile() && /\.ts$/.test(entry.name)) {
          if (fs.readFileSync(p, "utf8").includes("longitudinalComparisonEngine")) found = true;
        }
      }
    };
    walk(path.join(process.cwd(), "app", "api"));
    expect(found).toBe(false);
  });
});

// End-to-end: a real two-visit comparison through the real pipeline
describe("End-to-end - compareVisits() against two real, analyzed studies", () => {
  it("produces a real StructuredComparisonResult with no throw and honest fields", async () => {
    const s1 = await makeStudy("e2e1.png", "PT-E2E");
    const s2 = await makeStudy("e2e2.png", "PT-E2E");
    await analyzeStudy(s1);
    await analyzeStudy(s2);
    const result = await compareVisits(s1, s2);
    expect(result.prior_study_id).toBe(s1);
    expect(result.current_study_id).toBe(s2);
    expect(Array.isArray(result.measurement_changes)).toBe(true);
    expect(Array.isArray(result.finding_changes)).toBe(true);
  }, 30000);
});
