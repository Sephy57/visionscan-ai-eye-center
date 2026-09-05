import { describe, it, expect, afterAll } from "vitest";
import { CandidateOnlyProvider, CandidateOnlyModelError, candidateProviders } from "@/lib/models/candidateProvider";
import { CANDIDATE_MODEL_DOSSIER_MAP, CANDIDATE_MODEL_DOSSIERS } from "@/lib/models/candidateDossiers";
import { getProviderForModel, defaultProvider } from "@/lib/models/provider";
import { getModel } from "@/lib/models/registry";
import { classifyImageSuitability, ImageSuitabilityInput } from "@/lib/analysis/imageSuitability";
import { verifyModelIntegrity } from "@/lib/models/integrity";
import type { QualityResult } from "@/lib/imaging/quality";
import type { OodResult } from "@/lib/analysis/ood";
import { evidenceFromFindings } from "@/lib/evidence/adapters";
import type { Finding } from "@/lib/analysis/schema";
import { detectConflicts } from "@/lib/evidence/conflicts";
import { assessConditions, buildEvidenceWorkspace } from "@/lib/evidence/synthesize";
import type { EvidenceItem } from "@/lib/evidence/types";
import { createStudy, deleteStudy } from "@/lib/studies/service";
import { uploadDocument } from "@/lib/documents/service";
import { extractDocument } from "@/lib/documents/extraction/service";
import { generateResultsForDocument } from "@/lib/documents/extraction/testResultService";
import { DeviceMetadata } from "@/lib/devices/adapter";
import type { OCRProvider, OcrContext, OcrResult } from "@/lib/documents/extraction/types";

/**
 * S6 - model-integration-infrastructure safety tests (adversarial regression).
 *
 * Gate A is CLOSED: no real ophthalmic model is installed (data/models/ is
 * empty). Every test in this file confirms the S6 candidate-provider,
 * image-suitability, and integrity infrastructure FAILS CLOSED - none of
 * them establishes or exercises any real detection capability.
 */

// ---------------------------------------------------------------------------
// Fixture helpers (mirrors tests/s5-evidence-critical.test.ts style)
// ---------------------------------------------------------------------------

function mockOcr(): OCRProvider {
  return {
    name: "mock-ocr",
    async recognize(_png: Buffer, ctx: OcrContext): Promise<OcrResult> {
      return { text: `MOCK OCR PAGE ${ctx.page}`, confidence: 90, engine: "mock-ocr", engine_version: "0.0.0", language: "eng", time_ms: 1 };
    },
    async release() {},
  };
}

const META: DeviceMetadata = { scanType: "unknown", eye: "unknown", providedBy: "none" };
const createdStudyIds: string[] = [];

async function pngBytes(): Promise<Buffer> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(600, 600);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, 600, 600);
  return canvas.toBuffer("image/png");
}

async function studyWithPdf(lines: string): Promise<{ studyId: string; documentId: string }> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.split("\n").forEach((line, i) => page.drawText(line, { x: 40, y: 780 - i * 24, size: 11, font, color: rgb(0, 0, 0) }));
  const bytes = Buffer.from(await doc.save());
  const study = await createStudy("scan.png", "image/png", await pngBytes(), META);
  createdStudyIds.push(study.study_id);
  const up = await uploadDocument(study.study_id, "report.pdf", "application/pdf", bytes, "s6tester");
  if (!up.ok) throw new Error(`fixture upload failed: ${up.error_code}`);
  const ext = await extractDocument(up.document!.document_id, "s6tester", { ocrProvider: mockOcr() });
  if (!ext.ok) throw new Error(`fixture extraction failed: ${ext.error_code}`);
  return { studyId: study.study_id, documentId: up.document!.document_id };
}

afterAll(async () => {
  for (const id of createdStudyIds) await deleteStudy(id).catch(() => {});
});

// ---------------------------------------------------------------------------
// 1. Candidate provider fails closed at every step
// ---------------------------------------------------------------------------

describe("S6.1 - CandidateOnlyProvider fails closed at every method, for every dossier", () => {
  for (const candidateId of Object.keys(CANDIDATE_MODEL_DOSSIER_MAP)) {
    describe(`candidate: ${candidateId}`, () => {
      it("loadModel() rejects", async () => {
        const p = new CandidateOnlyProvider(candidateId);
        await expect(p.loadModel()).rejects.toThrow(CandidateOnlyModelError);
      });

      it("validateModel() resolves untrusted and ungated", async () => {
        const p = new CandidateOnlyProvider(candidateId);
        const result = await p.validateModel();
        expect(result.trusted).toBe(false);
        expect(result.gate.allowed).toBe(false);
        expect(result.gate.reasons.join(" ")).toMatch(/CANDIDATE_ONLY/);
        expect(result.model).toBeNull();
      });

      it("analyzeStudy() rejects - never silently returns findings", async () => {
        const p = new CandidateOnlyProvider(candidateId);
        const fakeStudy = { study_id: "s6-fake", modality: "FUNDUS", eye: "OD", hashSeed: 1 } as any;
        await expect(
          p.analyzeStudy(fakeStudy, { qualityScore: 1, eye: "OD" })
        ).rejects.toThrow(CandidateOnlyModelError);
      });

      it("getModelMetadata() resolves to null - never registered", async () => {
        const p = new CandidateOnlyProvider(candidateId);
        await expect(p.getModelMetadata()).resolves.toBeNull();
      });
    });
  }

  it("candidateProviders() constructs one fail-closed provider per dossier, no more no less", () => {
    const providers = candidateProviders();
    expect(providers.length).toBe(CANDIDATE_MODEL_DOSSIERS.length);
    expect(new Set(providers.map((p) => p.modelId)).size).toBe(CANDIDATE_MODEL_DOSSIERS.length);
  });

  it("constructing a CandidateOnlyProvider for an unknown id throws", () => {
    expect(() => new CandidateOnlyProvider("not-a-real-candidate-id")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. Candidate providers are never reachable through the live registry
// ---------------------------------------------------------------------------
// (Basic id-level unreachability is already covered by
//  tests/s6-candidates-route.test.ts - this adds the CandidateOnlyProvider
//  instance-level checks that file does not cover: the live PROVIDERS map
//  cannot be reached via a candidate's own providerId, and defaultProvider()
//  is unaffected by the existence of the candidate infrastructure.)

describe("S6.2 - CandidateOnlyProvider instances are never live-registry-reachable", () => {
  it("a candidate's own providerId is not resolvable via the live provider registry", async () => {
    const { getProvider } = await import("@/lib/models/provider");
    for (const p of candidateProviders()) {
      expect(getProvider(p.providerId)).toBeNull();
    }
  });

  it("getProviderForModel/getModel return nothing for every candidate id; defaultProvider is still DEMO", () => {
    for (const id of Object.keys(CANDIDATE_MODEL_DOSSIER_MAP)) {
      expect(getProviderForModel(id)).toBeNull();
      expect(getModel(id)).toBeFalsy();
    }
    expect(defaultProvider().modelId).toBe("demo-fundus-synthetic-v0");
  });
});

// ---------------------------------------------------------------------------
// 3. classifyImageSuitability fail-closed precedence
// ---------------------------------------------------------------------------

function baseQuality(overrides: Partial<QualityResult> = {}): QualityResult {
  return {
    quality_score: 0.95,
    quality_status: "pass",
    detected_artifacts: [],
    affected_regions: [],
    recommended_reacquisition: false,
    metrics: {
      width: 1024, height: 1024, sharpness_score: 0.9,
      illumination_mean: 120, illumination_p5: 20, illumination_p95: 230,
      highlight_clip_ratio: 0.001, shadow_clip_ratio: 0.001,
      colorfulness: 0.3, grayscale_only: false,
    },
    thresholds: {},
    limitations: [],
    ...overrides,
  };
}

function baseOod(overrides: Partial<OodResult> = {}): OodResult {
  return { detected: false, reasons: [], message: "Input is outside the validated operating conditions of this model.", ...overrides };
}

function fundusModel(): ReturnType<typeof getModel> {
  const demo = getModel("demo-fundus-synthetic-v0")!;
  return { ...demo, model_id: "s6-test-fundus-only", modalities: ["FUNDUS"] as any };
}

describe("S6.3 - classifyImageSuitability: fail-closed precedence over the 7 states", () => {
  it("model: null -> INFERENCE_UNAVAILABLE, suitable_for_inference false", () => {
    const input: ImageSuitabilityInput = { modality: "FUNDUS", quality: baseQuality(), ood: baseOod(), model: null, device: null };
    const result = classifyImageSuitability(input);
    expect(result.state).toBe("INFERENCE_UNAVAILABLE");
    expect(result.suitable_for_inference).toBe(false);
  });

  it("modality mismatch -> UNSUPPORTED_MODALITY", () => {
    const input: ImageSuitabilityInput = { modality: "OCT", quality: baseQuality(), ood: baseOod(), model: fundusModel(), device: null };
    const result = classifyImageSuitability(input);
    expect(result.state).toBe("UNSUPPORTED_MODALITY");
    expect(result.suitable_for_inference).toBe(false);
  });

  it("detected_artifacts includes incorrect_field_of_view -> INSUFFICIENT_FOV", () => {
    const input: ImageSuitabilityInput = {
      modality: "FUNDUS",
      quality: baseQuality({ detected_artifacts: ["incorrect_field_of_view"] }),
      ood: baseOod(),
      model: fundusModel(),
      device: null,
    };
    const result = classifyImageSuitability(input);
    expect(result.state).toBe("INSUFFICIENT_FOV");
    expect(result.suitable_for_inference).toBe(false);
  });

  it("quality_status fail -> LOW_QUALITY", () => {
    const input: ImageSuitabilityInput = {
      modality: "FUNDUS",
      quality: baseQuality({ quality_status: "fail", quality_score: 0.1 }),
      ood: baseOod(),
      model: fundusModel(),
      device: null,
    };
    const result = classifyImageSuitability(input);
    expect(result.state).toBe("LOW_QUALITY");
    expect(result.suitable_for_inference).toBe(false);
  });

  it("ood.reasons contains a device-mentioning reason -> DEVICE_UNSUPPORTED", () => {
    const input: ImageSuitabilityInput = {
      modality: "FUNDUS",
      quality: baseQuality(),
      ood: baseOod({ detected: true, reasons: ["Device compatibility has not been validated for this model."] }),
      model: fundusModel(),
      device: null,
    };
    const result = classifyImageSuitability(input);
    expect(result.state).toBe("DEVICE_UNSUPPORTED");
    expect(result.suitable_for_inference).toBe(false);
  });

  it("ood.detected true with no device-specific reason -> OUT_OF_DISTRIBUTION", () => {
    const input: ImageSuitabilityInput = {
      modality: "FUNDUS",
      quality: baseQuality(),
      ood: baseOod({ detected: true, reasons: ["Extreme illumination values; image may not resemble the intended imaging distribution."] }),
      model: fundusModel(),
      device: null,
    };
    const result = classifyImageSuitability(input);
    expect(result.state).toBe("OUT_OF_DISTRIBUTION");
    expect(result.suitable_for_inference).toBe(false);
  });

  it("fully clean input -> SUITABLE, suitable_for_inference true", () => {
    const input: ImageSuitabilityInput = { modality: "FUNDUS", quality: baseQuality(), ood: baseOod(), model: fundusModel(), device: null };
    const result = classifyImageSuitability(input);
    expect(result.state).toBe("SUITABLE");
    expect(result.suitable_for_inference).toBe(true);
  });

  it("every non-SUITABLE state has suitable_for_inference: false (no accidental inference-allowing state)", () => {
    const cases: ImageSuitabilityInput[] = [
      { modality: "FUNDUS", quality: baseQuality(), ood: baseOod(), model: null, device: null },
      { modality: "OCT", quality: baseQuality(), ood: baseOod(), model: fundusModel(), device: null },
      { modality: "FUNDUS", quality: baseQuality({ detected_artifacts: ["incorrect_field_of_view"] }), ood: baseOod(), model: fundusModel(), device: null },
      { modality: "FUNDUS", quality: baseQuality({ quality_status: "fail" }), ood: baseOod(), model: fundusModel(), device: null },
      { modality: "FUNDUS", quality: baseQuality(), ood: baseOod({ detected: true, reasons: ["device not validated"] }), model: fundusModel(), device: null },
      { modality: "FUNDUS", quality: baseQuality(), ood: baseOod({ detected: true, reasons: ["some other ood reason"] }), model: fundusModel(), device: null },
    ];
    for (const input of cases) {
      const result = classifyImageSuitability(input);
      expect(result.state).not.toBe("SUITABLE");
      expect(result.suitable_for_inference).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Model artifact hash mismatch prevents inference
// ---------------------------------------------------------------------------

describe("S6.4 - integrity verification fails closed", () => {
  it("baseline: the DEMO model currently reports trusted: true (placeholder, no artifact required)", () => {
    const result = verifyModelIntegrity("demo-fundus-synthetic-v0");
    expect(result.trusted).toBe(true);
    expect(result.model?.model_id).toBe("demo-fundus-synthetic-v0");
  });

  // A true bit-flip/hash-mismatch scenario cannot be simulated here without
  // writing a fake artifact under data/models/ or mutating the MODELS
  // registry - both are explicitly out of scope for this test file (no
  // modification of candidateDossiers.ts/candidateProvider.ts/
  // imageSuitability.ts, and no touching data/models/ or the registry).
  // Instead we exercise the other fail-closed path verifyModelIntegrity
  // guarantees: an id with no registry entry at all is never trusted.
  it("verifyModelIntegrity(unknown id) fails closed: trusted false, registry check failed", () => {
    const result = verifyModelIntegrity("nonexistent-model-id-s6");
    expect(result.trusted).toBe(false);
    expect(result.model).toBeNull();
    expect(result.checks.some((c) => c.check === "registry" && !c.passed)).toBe(true);
  });

  it("every candidate dossier id is likewise untrusted through verifyModelIntegrity (no registry entry)", () => {
    for (const id of Object.keys(CANDIDATE_MODEL_DOSSIER_MAP)) {
      const result = verifyModelIntegrity(id);
      expect(result.trusted).toBe(false);
      expect(result.model).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Model version produces a distinct provenance record (no silent merge)
// ---------------------------------------------------------------------------

function mkFinding(id: string, modelVersion: string): Finding {
  return {
    id,
    type: "possible_retinal_hemorrhage",
    location: "macular_region",
    severity: "indeterminate",
    confidence: 0.5,
    confidence_category: "INDETERMINATE",
    taxonomy_level: "observation",
    structured_measurements: [
      { key: "area", value: 1.2, unit: "mm2", anatomical_region: "macula", source_modality: "FUNDUS", measurement_confidence: 0.5, model_id: "s6-shared-model", model_version: modelVersion },
    ],
    explanation: "Synthetic test finding for provenance test.",
    synthetic: true,
    model_id: "s6-shared-model",
  };
}

describe("S6.5 - same model_id, different model_version - distinct provenance, never merged", () => {
  it("evidenceFromFindings keeps two same-model-id findings as two distinct evidence items", () => {
    const f1 = mkFinding("find_v1", "1.0.0");
    const f2 = mkFinding("find_v2", "2.0.0");
    const items = evidenceFromFindings("s6-study", "OD", [f1, f2]);

    expect(items.length).toBe(2);
    const ids = new Set(items.map((i) => i.id));
    expect(ids.size).toBe(2);

    const item1 = items.find((i) => i.provenance.finding_id === "find_v1")!;
    const item2 = items.find((i) => i.provenance.finding_id === "find_v2")!;
    expect(item1).toBeDefined();
    expect(item2).toBeDefined();
    expect(item1.id).not.toBe(item2.id);
    expect(item1.source_id).not.toBe(item2.source_id);

    // Nothing collapsed/merged the two source findings' distinct model_version.
    expect(f1.structured_measurements![0].model_id).toBe(f2.structured_measurements![0].model_id);
    expect(f1.structured_measurements![0].model_version).not.toBe(f2.structured_measurements![0].model_version);
  });
});

// ---------------------------------------------------------------------------
// 6. Missing modality -> INSUFFICIENT_EVIDENCE / UNABLE_TO_ASSESS, never a
//    fabricated conclusion (S5 evidence layer, IOP-only study)
// ---------------------------------------------------------------------------

describe("S6.6 - IOP-only study: no condition assessment is ever SUPPORTED_CONDITION", () => {
  it("a study with only an IOP test result and no image/OCT/visual-field evidence never yields SUPPORTED_CONDITION", async () => {
    const { studyId, documentId } = await studyWithPdf("IOP OD 24 mmHg documented");
    await generateResultsForDocument(documentId, "s6tester");

    const ws = await buildEvidenceWorkspace(studyId);
    if ("not_found" in ws) throw new Error("study not found");

    expect(ws.examination_context.source_count.ai_findings).toBe(0);
    expect(ws.examination_context.source_count.symptoms).toBe(0);
    expect(ws.examination_context.source_count.test_results).toBeGreaterThan(0);

    for (const c of ws.possible_conditions) {
      expect(c.state).not.toBe("SUPPORTED_CONDITION");
    }
    // Conditions requiring evidence types this study never provides (macular
    // thickness, cup-to-disc ratio, any image finding, any symptom) are
    // correctly UNABLE_TO_ASSESS or INSUFFICIENT_EVIDENCE.
    const macular = ws.possible_conditions.filter((c) => c.condition_id === "macular_thickening_pattern");
    for (const m of macular) {
      expect(["UNABLE_TO_ASSESS", "INSUFFICIENT_EVIDENCE"]).toContain(m.state);
    }
    const opticNerve = ws.possible_conditions.filter((c) => c.condition_id === "optic_nerve_evidence_pattern");
    for (const o of opticNerve) {
      expect(["UNABLE_TO_ASSESS", "INSUFFICIENT_EVIDENCE"]).toContain(o.state);
    }
    const acute = ws.possible_conditions.filter((c) => c.condition_id === "acute_vision_change_pattern");
    for (const a of acute) {
      expect(["UNABLE_TO_ASSESS", "INSUFFICIENT_EVIDENCE"]).toContain(a.state);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Conflicting modalities/sources are preserved as a conflict, never
//    silently resolved
// ---------------------------------------------------------------------------

function mkEvidence(overrides: Partial<EvidenceItem> & Pick<EvidenceItem, "id" | "source_type" | "category" | "laterality">): EvidenceItem {
  return {
    study_id: "s6-conflict-study",
    source_id: `src_${overrides.id}`,
    laterality_source: "study_level",
    presence: "PRESENT",
    trust_level: "UNVERIFIED",
    provenance: { study_id: "s6-conflict-study" },
    conflict_ids: [],
    ...overrides,
  };
}

describe("S6.7 - conflicting qualitative findings across sources are preserved as QUALITATIVE_CONFLICT", () => {
  it("two items, same category+laterality, different source_type, opposing qualitative findings -> QUALITATIVE_CONFLICT with both ids, neither item altered", () => {
    const aiItem = mkEvidence({
      id: "ev_ai_1", source_type: "AI_FINDING", category: "retinal_thickening", laterality: "OD",
      qualitative_finding: "thickening_present",
    });
    const testItem = mkEvidence({
      id: "ev_test_1", source_type: "TEST_RESULT", category: "retinal_thickening", laterality: "OD",
      qualitative_finding: "no_thickening",
    });

    const conflicts = detectConflicts([aiItem, testItem]);
    const qual = conflicts.find((c) => c.conflict_type === "QUALITATIVE_CONFLICT");
    expect(qual).toBeDefined();
    expect(qual!.evidence_ids).toContain("ev_ai_1");
    expect(qual!.evidence_ids).toContain("ev_test_1");

    // Neither item was removed or its content altered by conflict detection.
    expect(aiItem.qualitative_finding).toBe("thickening_present");
    expect(testItem.qualitative_finding).toBe("no_thickening");
    expect(aiItem.laterality).toBe("OD");
    expect(testItem.laterality).toBe("OD");
  });
});

// ---------------------------------------------------------------------------
// 8. Wrong-eye conflict via a model (AI_FINDING) finding
// ---------------------------------------------------------------------------

describe("S6.8 - an OD AI_FINDING and an OS SYMPTOM never combine (mirrors S5.22, AI_FINDING variant)", () => {
  it("OD AI_FINDING and OS SYMPTOM never appear together in a conflict or in the same per-eye condition assessment", () => {
    const aiItem = mkEvidence({
      id: "ev_ai_od", source_type: "AI_FINDING", category: "detachment_like_abnormality", laterality: "OD",
      qualitative_finding: "indeterminate",
    });
    const symptomItem = mkEvidence({
      id: "ev_sym_os", source_type: "SYMPTOM", category: "curtain_shadow", laterality: "OS",
      qualitative_finding: "curtain_shadow",
    });

    const items = [aiItem, symptomItem];
    const conflicts = detectConflicts(items);
    for (const c of conflicts) {
      const hasAi = c.evidence_ids.includes(aiItem.id);
      const hasSymptom = c.evidence_ids.includes(symptomItem.id);
      expect(hasAi && hasSymptom).toBe(false);
    }

    const assessments = assessConditions(items);
    const acuteOD = assessments.find((a) => a.condition_id === "acute_vision_change_pattern" && a.laterality === "OD");
    const acuteOS = assessments.find((a) => a.condition_id === "acute_vision_change_pattern" && a.laterality === "OS");

    expect(acuteOD?.supporting_evidence_ids).toContain(aiItem.id);
    expect(acuteOD?.supporting_evidence_ids).not.toContain(symptomItem.id);
    expect(acuteOS?.supporting_evidence_ids).toContain(symptomItem.id);
    expect(acuteOS?.supporting_evidence_ids).not.toContain(aiItem.id);
  });
});
