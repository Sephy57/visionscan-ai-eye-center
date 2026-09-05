import { describe, it, expect, afterAll } from "vitest";
import { extractClinicalFromPages } from "@/lib/documents/extraction/clinicalExtraction";
import {
  saveRecordExtraction,
  getRecordExtraction,
  annotateExtractionItem,
} from "@/lib/documents/extraction/recordExtractionStore";
import {
  ensurePatient,
  createEncounter,
  getPatientProfile,
  listPatients,
  findPatientByRef,
} from "@/lib/patients/service";
import { createStudy, deleteStudy } from "@/lib/studies/service";
import { analyzeRecord } from "@/lib/analysis/recordPipeline";
import { SYMPTOM_MAP } from "@/lib/clinical/symptoms";
import { DeviceMetadata } from "@/lib/devices/adapter";
import { runTriage } from "@/lib/clinical/triage";
import { buildTestResults } from "@/lib/documents/extraction/testResultParser";
import type { ExtractionArtifact } from "@/lib/documents/extraction/types";
import { evidenceFromExtractedHistory } from "@/lib/evidence/adapters";

/**
 * Phase 7 - eye-center workspace: patient/encounter persistence, automatic
 * record extraction, and the record analysis pipeline.
 *
 * Safety invariants under test:
 *  - extraction NEVER fabricates (empty text -> empty result; fields absent
 *    when not documented; vocabulary guard)
 *  - documented negations never become positive symptoms
 *  - extraction confidence is labeled extraction-only
 *  - clinician annotations never overwrite original raw text
 *  - cross-patient isolation (linked-study mismatch refused; profile scoping)
 *  - record pipeline stage isolation (one failing stage never crashes all)
 */

const META: DeviceMetadata = { scanType: "unknown", eye: "unknown", providedBy: "none" };
const createdStudyIds: string[] = [];
const patientRefs: string[] = [];

const DOC_CTX = { document_id: "doc_test_1", study_id: "study_test_1", patient_ref: "VS-P7-TEST" };

afterAll(async () => {
  for (const id of createdStudyIds) await deleteStudy(id).catch(() => {});
});

// ---------------------------------------------------------------------------
// Automatic clinical extraction
// ---------------------------------------------------------------------------

describe("P7 - automatic clinical extraction", () => {
  it("extracts the handoff §12 example: sudden painless right-eye vision loss, this morning", () => {
    const rec = extractClinicalFromPages(
      [{ page: 1, text: "Patient reports sudden painless loss of vision in the right eye beginning this morning." }],
      DOC_CTX
    );
    expect(rec.status).toBe("COMPLETE");
    const sudden = rec.symptoms.find((s) => s.type === "sudden_vision_loss");
    expect(sudden).toBeTruthy();
    expect(sudden!.laterality).toBe("right");
    expect(sudden!.onset).toBe("sudden");
    expect(sudden!.duration).toBe("hours");
    expect(sudden!.source).toBe("DOCUMENT_EXTRACTED");
    expect(sudden!.verification).toBe("UNREVIEWED");
    // provenance anchor: raw text quoted from the document
    expect(sudden!.raw_text.toLowerCase()).toContain("loss of vision");
  });

  it("extracts the handoff §45 example: painful red right eye with photophobia for 2 days", () => {
    const rec = extractClinicalFromPages(
      [{ page: 1, text: "Patient complains of painful red right eye with photophobia for 2 days." }],
      DOC_CTX
    );
    const types = new Set(rec.symptoms.map((s) => s.type));
    expect(types.has("eye_pain")).toBe(true);
    expect(types.has("redness")).toBe(true);
    expect(types.has("light_sensitivity")).toBe(true);
    const pain = rec.symptoms.find((s) => s.type === "eye_pain")!;
    expect(pain.laterality).toBe("right");
    expect(pain.duration).toBe("days");
  });

  it("never fabricates severity when the document does not state it", () => {
    const rec = extractClinicalFromPages([{ page: 1, text: "The patient reports blurred vision." }], DOC_CTX);
    const blurred = rec.symptoms.find((s) => s.type === "blurred_vision");
    expect(blurred).toBeTruthy();
    expect(blurred!.severity).toBeUndefined();
    expect(blurred!.laterality).toBeUndefined();
    expect(blurred!.onset).toBeUndefined();
  });

  it("records documented negations as explicit negations, never as symptoms", () => {
    const rec = extractClinicalFromPages(
      [{ page: 1, text: "Denies floaters and flashes. No photophobia." }],
      DOC_CTX
    );
    expect(rec.symptoms.find((s) => s.type === "floaters")).toBeUndefined();
    expect(rec.symptoms.find((s) => s.type === "flashes")).toBeUndefined();
    expect(rec.symptoms.find((s) => s.type === "light_sensitivity")).toBeUndefined();
    const negatedTypes = rec.explicit_negations.filter((n) => n.kind === "SYMPTOM").map((n) => n.type);
    expect(negatedTypes).toContain("floaters");
    expect(negatedTypes).toContain("light_sensitivity");
  });

  it("keeps comma-separated negation lists negative and does not cross a contrast clause", () => {
    const rec = extractClinicalFromPages(
      [{ page: 1, text: "No eye pain, flashes, or floaters, but blurred vision is reported." }],
      DOC_CTX,
    );
    expect(rec.symptoms.some((s) => ["eye_pain", "flashes", "floaters", "new_floaters"].includes(s.type))).toBe(false);
    expect(rec.symptoms.some((s) => s.type === "blurred_vision")).toBe(true);
    const negated = rec.explicit_negations.filter((n) => n.kind === "SYMPTOM").map((n) => n.type);
    expect(negated).toEqual(expect.arrayContaining(["eye_pain", "flashes", "floaters"]));
  });

  it("uses the specialized new-floaters red-flag type and preserves explicit uncertainty", () => {
    const rec = extractClinicalFromPages(
      [{ page: 1, text: "Patient has new floaters; possible flashes cannot be excluded." }],
      DOC_CTX,
    );
    expect(rec.symptoms.some((s) => s.type === "floaters")).toBe(false);
    expect(rec.symptoms.find((s) => s.type === "new_floaters")).toBeTruthy();
    expect(rec.symptoms.find((s) => s.type === "flashes")?.certainty).toBe("UNCERTAIN");
  });

  it("does not form a combined severe-pain/nausea symptom when either component is negated", () => {
    const rec = extractClinicalFromPages(
      [{ page: 1, text: "Severe eye pain without nausea. Severe eye pain with nausea is possible." }],
      DOC_CTX,
    );
    expect(rec.symptoms.filter((s) => s.type === "severe_pain_with_nausea")).toHaveLength(1);
    expect(rec.symptoms.find((s) => s.type === "severe_pain_with_nausea")?.certainty).toBe("UNCERTAIN");
  });

  it("extracts medications with form/dose hints only when written, UNNORMALIZED", () => {
    const rec = extractClinicalFromPages(
      [{ page: 1, text: "The patient uses latanoprost 0.005% eye drops daily in the evening." }],
      DOC_CTX
    );
    const med = rec.medications.find((m) => m.name_raw.toLowerCase() === "latanoprost");
    expect(med).toBeTruthy();
    expect(med!.form_hint).toBe("eye_drops");
    expect(med!.dose_raw).toBe("0.005%");
    expect(med!.normalization_status).toBe("UNNORMALIZED");
    expect(med!.verification).toBe("UNREVIEWED");
  });

  it("extracts allergies with reaction only when stated; NKDA becomes a negation", () => {
    const rec = extractClinicalFromPages(
      [{ page: 1, text: "Allergic to penicillin with rash. NKDA otherwise." }],
      DOC_CTX
    );
    const allergy = rec.allergies.find((a) => a.allergen_raw.toLowerCase().includes("penicillin"));
    expect(allergy).toBeTruthy();
    expect(allergy!.reaction_raw?.toLowerCase()).toContain("rash");
    expect(rec.explicit_negations.some((n) => n.kind === "ALLERGY")).toBe(true);
  });

  it("keeps an explicitly labelled source diagnosis separate from VisionScan diagnoses", () => {
    const rec = extractClinicalFromPages(
      [{ page: 2, text: "Diagnosis: primary open-angle glaucoma. Further testing advised." }],
      DOC_CTX,
    );
    expect(rec.source_document_diagnoses).toHaveLength(1);
    expect(rec.source_document_diagnoses[0].diagnosis_raw.toLowerCase()).toContain("primary open-angle glaucoma");
    expect(rec.source_document_diagnoses[0].source).toBe("DOCUMENT_EXTRACTED");
    expect(rec.source_document_diagnoses[0].verification).toBe("UNREVIEWED");
  });

  it("keeps chief complaint, history, family history, and exam text as unreviewed source candidates", () => {
    const rec = extractClinicalFromPages(
      [{ page: 3, text: "Chief complaint: blurred vision. History of cataract surgery OD. Family history of glaucoma in mother. Fundus exam: suspicious disc appearance." }],
      DOC_CTX,
    );
    expect(rec.chief_complaint?.value_raw).toContain("blurred vision");
    expect(rec.ocular_history_candidates.some((h) => h.kind === "OCULAR_SURGERY")).toBe(true);
    expect(rec.family_history_candidates[0]?.value_raw.toLowerCase()).toContain("glaucoma");
    expect(rec.exam_findings[0]?.verification).toBe("UNREVIEWED");
    const evidence = evidenceFromExtractedHistory("study_test_1", rec);
    expect(evidence.some((e) => e.source_type === "HISTORY" && e.category === "family_history")).toBe(true);
    expect(evidence.some((e) => e.source_type === "CLINICIAN_OBSERVATION")).toBe(true);
    expect(evidence.every((e) => e.trust_level === "AUTO_EXTRACTED")).toBe(true);
  });

  it("extracts additional objective measurements without inventing units or clinical thresholds", () => {
    const artifact = {
      document_id: "doc_measurements",
      study_id: "study_measurements",
      status: "COMPLETE",
      document_level: "text",
      pages: [{ page: 1, method: "text_layer", char_count: 160, text: "Pachymetry OD 540 um. VF OS MD -2.4 dB, VFI 95%. Refraction OD sphere -1.25 D. OCT RNFL OS 82 um." , warnings: [] }],
      totals: { pages: 1, pages_text_layer: 1, pages_ocr: 0, pages_empty: 0, pages_failed: 0, char_count: 160 },
      limits_applied: { max_chars_per_doc: 1000, max_chars_per_page: 1000, max_time_ms: 1000, max_ocr_time_ms: 1000, max_render_dimension_px: 1000 },
      verification: { status: "UNREVIEWED" },
      extraction_version: "test",
      created_at: new Date().toISOString(),
      warnings: [],
    } as ExtractionArtifact;
    const results = buildTestResults(artifact);
    expect(results.some((r) => r.test_type === "PACHYMETRY" && r.value === 540 && r.unit_normalized === "um")).toBe(true);
    expect(results.some((r) => r.test_type === "VISUAL_FIELD" && r.value === -2.4 && r.unit_raw === "dB")).toBe(true);
    expect(results.some((r) => r.test_type === "REFRACTION" && r.value === -1.25)).toBe(true);
    expect(results.some((r) => r.test_type === "OCT_MEASUREMENT" && r.value === 82 && r.laterality === "OS")).toBe(true);
    expect(results.every((r) => r.ambiguity_flags.includes("missing_laterality") || r.laterality !== "UNKNOWN")).toBe(true);
  });

  it("vocabulary guard: text outside the controlled vocabulary never creates a symptom type", () => {
    const rec = extractClinicalFromPages(
      [{ page: 1, text: "The patient reports elbow pain and knee stiffness with tingling toes." }],
      DOC_CTX
    );
    expect(rec.symptoms).toHaveLength(0);
  });

  it("empty / no-text input yields an honest empty result, never fabricated content", () => {
    const rec = extractClinicalFromPages([{ page: 1, text: "" }], DOC_CTX);
    expect(rec.status).toBe("COMPLETE");
    expect(rec.error_code).toBe("NO_TEXT_EXTRACTED");
    expect(rec.symptoms).toHaveLength(0);
    expect(rec.medications).toHaveLength(0);
    expect(rec.allergies).toHaveLength(0);
  });

  it("every symptom type extracted is a key of the controlled vocabulary", () => {
    const rec = extractClinicalFromPages(
      [{
        page: 1,
        text: "Sudden loss of vision in the left eye. Floaters and flashes. Severe eye pain with nausea. Gradual blurred vision for months.",
      }],
      DOC_CTX
    );
    for (const s of rec.symptoms) {
      expect(Object.keys(SYMPTOM_MAP)).toContain(s.type);
    }
    expect(rec.symptoms.length).toBeGreaterThan(2);
  });

  it("labels extraction confidence as pattern-match quality, distinct per basis", () => {
    const rec = extractClinicalFromPages(
      [{ page: 1, text: "Headache with blurred vision. Blurred vision alone." }],
      DOC_CTX
    );
    const exact = rec.symptoms.find((s) => s.type === "blurred_vision" && s.confidence_basis === "EXACT_PHRASE");
    const combo = rec.symptoms.find((s) => s.type === "headache_with_visual_symptoms");
    expect(exact).toBeTruthy();
    expect(combo).toBeTruthy();
    expect(combo!.confidence_basis).toBe("SENTENCE_CO_OCCURRENCE");
    expect(combo!.extraction_confidence).toBeLessThan(exact!.extraction_confidence);
  });
});

// ---------------------------------------------------------------------------
// Extraction store + clinician annotations
// ---------------------------------------------------------------------------

describe("P7 - extraction store and clinician annotations", () => {
  it("persists an extraction and appends annotations without overwriting the original", async () => {
    const rec = extractClinicalFromPages(
      [{ page: 1, text: "Patient reports eye pain in the left eye for 3 days." }],
      { document_id: "doc_p7_store", study_id: "study_p7_store", patient_ref: "VS-P7-TEST" }
    );
    expect(rec.symptoms.length).toBeGreaterThan(0);
    const originalRaw = rec.symptoms[0].raw_text;
    await saveRecordExtraction(rec);
    const loaded = await getRecordExtraction("doc_p7_store");
    expect(loaded).toBeTruthy();

    const itemId = loaded!.symptoms[0].item_id;
    const updated = await annotateExtractionItem("doc_p7_store", {
      category: "symptoms",
      item_id: itemId,
      action: "VERIFY",
      by: "test_clinician",
    });
    expect(updated).toBeTruthy();
    const item = updated!.symptoms.find((s) => s.item_id === itemId)!;
    expect(item.verification).toBe("VERIFIED_BY_CLINICIAN");
    expect(item.raw_text).toBe(originalRaw); // original text intact
    expect(updated!.annotations[itemId][0].by).toBe("test_clinician");
  });

  it("CORRECT applies only mutable fields and records the correction provenance", async () => {
    const rec = extractClinicalFromPages(
      [{ page: 1, text: "Patient reports eye pain in the left eye for 3 days." }],
      { document_id: "doc_p7_store", study_id: "study_p7_store", patient_ref: "VS-P7-TEST" }
    );
    await saveRecordExtraction(rec);
    const stored = await getRecordExtraction("doc_p7_store");
    const itemId = stored!.symptoms[0].item_id;

    const updated = await annotateExtractionItem("doc_p7_store", {
      category: "symptoms",
      item_id: itemId,
      action: "CORRECT",
      by: "test_clinician",
      corrected_value: { type: "blurred_vision", laterality: "both", item_id: "HACK-ATTEMPT", raw_text: "HACK-ATTEMPT" },
    });
    const item = updated!.symptoms.find((s) => s.item_id === itemId)!;
    expect(item.type).toBe("blurred_vision");
    expect(item.laterality).toBe("both");
    expect(item.verification).toBe("CORRECTED_BY_CLINICIAN");
    expect(item.item_id).toBe(itemId); // immutable fields untouched
    expect(item.raw_text).not.toBe("HACK-ATTEMPT");
  });

  it("REJECT marks the item but keeps it for audit", async () => {
    const rec = extractClinicalFromPages(
      [{ page: 1, text: "Mild itching both eyes." }],
      { document_id: "doc_p7_reject", study_id: "study_p7_reject", patient_ref: "VS-P7-TEST" }
    );
    await saveRecordExtraction(rec);
    const stored = await getRecordExtraction("doc_p7_reject");
    const itemId = stored!.symptoms[0].item_id;
    const updated = await annotateExtractionItem("doc_p7_reject", {
      category: "symptoms",
      item_id: itemId,
      action: "REJECT",
      by: "test_clinician",
    });
    const item = updated!.symptoms.find((s) => s.item_id === itemId)!;
    expect(item.verification).toBe("REJECTED_BY_CLINICIAN");
    expect(updated!.symptoms).toHaveLength(1); // kept, not deleted
  });

  it("unknown document or item fails closed (null), never fabricates a write", async () => {
    expect(await annotateExtractionItem("doc_missing", { category: "symptoms", item_id: "x", action: "VERIFY", by: "t" })).toBeNull();
    expect(await annotateExtractionItem("doc_p7_reject", { category: "symptoms", item_id: "no_such_id", action: "VERIFY", by: "t" })).toBeNull();
  });

  it("rejects malformed clinician corrections instead of persisting unknown vocabulary or laterality", async () => {
    const rec = extractClinicalFromPages(
      [{ page: 1, text: "Patient reports eye pain in the left eye." }],
      { document_id: "doc_p7_invalid_correction", study_id: "study_p7_invalid_correction", patient_ref: "VS-P7-TEST" },
    );
    await saveRecordExtraction(rec);
    const stored = await getRecordExtraction("doc_p7_invalid_correction");
    const itemId = stored!.symptoms[0].item_id;
    const before = stored!.symptoms[0];
    expect(await annotateExtractionItem("doc_p7_invalid_correction", {
      category: "symptoms", item_id: itemId, action: "CORRECT", by: "test_clinician",
      corrected_value: { type: "not_a_symptom", laterality: "rightish" },
    })).toBeNull();
    const after = await getRecordExtraction("doc_p7_invalid_correction");
    expect(after!.symptoms[0]).toEqual(before);
    expect(after!.annotations[itemId]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Patient / encounter persistence + isolation
// ---------------------------------------------------------------------------

describe("P7 - patient and encounter persistence", () => {
  it("ensurePatient is idempotent per ref and never duplicates", async () => {
    const ref = "VS-P7-IDEM-" + Date.now().toString(36);
    patientRefs.push(ref);
    const p1 = await ensurePatient(ref, "tester", "CLINICIAN_CREATED");
    const p2 = await ensurePatient(ref, "tester", "PROVISIONED_FROM_STUDY");
    expect(p2.patient_id).toBe(p1.patient_id);
    const found = await findPatientByRef(ref.toLowerCase());
    expect(found?.patient_id).toBe(p1.patient_id);
  });

  it("createEncounter is fail-closed: missing patient, invalid provenance, and cross-patient study links are refused", async () => {
    const missing = await createEncounter({ patient_id: "pat_missing", created_by: "t" });
    expect(missing.ok).toBe(false);
    expect(missing.status).toBe(404);

    const refA = "VS-P7-A-" + Date.now().toString(36);
    patientRefs.push(refA);
    const patientA = await ensurePatient(refA, "tester", "CLINICIAN_CREATED");
    const study = await createStudy("p7-test.png", "image/png", await pngBytes(), META, refA + "-OTHER");
    createdStudyIds.push(study.study_id);

    const badProvenance = await createEncounter({
      patient_id: patientA.patient_id,
      medications: [{ value: { name: "latanoprost", ocular: true }, provenance: "MADE_UP_PROVENANCE" }],
      created_by: "tester",
    });
    expect(badProvenance.ok).toBe(false);
    expect(badProvenance.status).toBe(400);

    const mismatch = await createEncounter({
      patient_id: patientA.patient_id,
      linked_study_ids: [study.study_id],
      created_by: "tester",
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.status).toBe(409);
    expect(mismatch.error).toContain("PATIENT_MISMATCH");
  });

  it("encounter creation links same-ref studies; profiles are patient-scoped", async () => {
    const refB = "VS-P7-B-" + Date.now().toString(36);
    patientRefs.push(refB);
    const patientB = await ensurePatient(refB, "tester", "CLINICIAN_CREATED");
    const study = await createStudy("p7-b.png", "image/png", await pngBytes(), META, refB);
    createdStudyIds.push(study.study_id);

    const created = await createEncounter({
      patient_id: patientB.patient_id,
      chief_complaint: "gradual vision change",
      linked_study_ids: [study.study_id],
      created_by: "tester",
    });
    expect(created.ok).toBe(true);

    const profile = await getPatientProfile(patientB.patient_id);
    expect(profile).toBeTruthy();
    expect(profile!.encounters).toHaveLength(1);
    expect(profile!.encounters[0].linked_study_ids).toEqual([study.study_id]);

    // Patient A's profile must not contain patient B's encounter or studies
    const refA2 = "VS-P7-A2-" + Date.now().toString(36);
    patientRefs.push(refA2);
    const patientA2 = await ensurePatient(refA2, "tester", "CLINICIAN_CREATED");
    const profileA2 = await getPatientProfile(patientA2.patient_id);
    expect(profileA2!.encounters).toHaveLength(0);

    const all = await listPatients(refB.slice(0, 12));
    expect(all.some((p) => p.patient_id === patientB.patient_id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Record analysis pipeline
// ---------------------------------------------------------------------------

describe("P7 - record analysis pipeline", () => {
  it("returns not_found for an unknown study", async () => {
    expect("not_found" in (await analyzeRecord("study_missing_xyz"))).toBe(true);
  });

  it("produces an isolated-stage package for a study with no documents and no analysis", async () => {
    const refC = "VS-P7-C-" + Date.now().toString(36);
    patientRefs.push(refC);
    const study = await createStudy("p7-c.png", "image/png", await pngBytes(), META, refC);
    createdStudyIds.push(study.study_id);

    const pkg = await analyzeRecord(study.study_id);
    expect("not_found" in pkg).toBe(false);
    if ("not_found" in pkg) return;
    expect(pkg.patient_ref).toBe(refC);
    expect(pkg.stages.document_extractions.some((s) => s.status === "NO_DOCUMENTS")).toBe(true);
    expect(pkg.stages.image_analysis.status).toBe("NOT_RUN"); // honest: pipeline never runs models
    expect(pkg.stages.evidence_synthesis.status).toBe("OK");
    expect(pkg.stages.medication_safety.status).toBe("NOT_AVAILABLE");
    expect(pkg.stages.longitudinal.status).toBe("NO_COMPARABLE_EVIDENCE");
    expect(pkg.stages.urgency.status).toBe("OK");
    expect(pkg.requires_clinician_review).toBe(true);
    expect(pkg.limitations.length).toBeGreaterThan(0);
  });

  it("red-flag symptoms escalate urgency even with zero AI findings", async () => {
    const refD = "VS-P7-D-" + Date.now().toString(36);
    patientRefs.push(refD);
    const study = await createStudy("p7-d.png", "image/png", await pngBytes(), META, refD);
    createdStudyIds.push(study.study_id);
    const { setStudySymptoms } = await import("@/lib/studies/service");
    await setStudySymptoms(study.study_id, [
      { type: "curtain_shadow", onset: "sudden", duration: "hours", severity: "moderate", laterality: "right", progression: "stable", frequency: "constant" },
    ]);
    const pkg = await analyzeRecord(study.study_id);
    if ("not_found" in pkg) return;
    const urgency = pkg.stages.urgency.result as { priority?: string } | undefined;
    expect(urgency?.priority).toBe("emergency_evaluation");
  });

  it("preserves a document-extracted red flag as a distinct pre-review safety signal", () => {
    const outcome = runTriage({
      findings: [], qualityAcceptable: false, qualityScore: 0, uncertainty: 1,
      modality: "unknown", documentExtractedRedFlagSymptoms: ["sudden_vision_loss"],
    });
    expect(outcome.priority).toBe("emergency_evaluation");
    expect(outcome.triggered_rules).toContain("document_extracted_red_flag_pre_review_signal");
    expect(outcome.rationale).toContain("UNREVIEWED");
  });

  it("never lets a lower-priority document candidate mask a higher-priority structured red flag", () => {
    const outcome = runTriage({
      findings: [], qualityAcceptable: false, qualityScore: 0, uncertainty: 1,
      modality: "unknown",
      redFlagSymptoms: ["sudden_vision_loss"],
      documentExtractedRedFlagSymptoms: ["new_floaters"],
    });
    expect(outcome.priority).toBe("emergency_evaluation");
    expect(outcome.triggered_rules).toEqual(expect.arrayContaining([
      "red_flag_symptoms_override",
      "document_extracted_red_flag_pre_review_signal",
    ]));
  });
});

async function pngBytes(): Promise<Buffer> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(400, 400);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, 400, 400);
  return canvas.toBuffer("image/png");
}
