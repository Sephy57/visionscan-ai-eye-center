import { describe, it, expect } from "vitest";
import { evaluate, BinaryCase, basicMetrics, auroc, auprc, calibration } from "@/lib/research/metrics";
import {
  deidentifyPatientKey, createDataset, addSample, setReferenceLabel,
  recordAnnotations, adjudicate, DatasetRecord,
} from "@/lib/research/datasets";

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

describe("performance metrics", () => {
  const cases: BinaryCase[] = [
    { case_id: "a", y_true: 1, y_pred: 1, score: 0.9 },
    { case_id: "b", y_true: 1, y_pred: 1, score: 0.8 },
    { case_id: "c", y_true: 1, y_pred: 0, score: 0.3 },
    { case_id: "d", y_true: 0, y_pred: 0, score: 0.2 },
    { case_id: "e", y_true: 0, y_pred: 0, score: 0.1 },
    { case_id: "f", y_true: 0, y_pred: 1, score: 0.6 },
  ];

  it("computes a correct confusion matrix", () => {
    const cm = basicMetrics(cases).confusion;
    expect(cm).toEqual({ tp: 2, fp: 1, tn: 2, fn: 1 });
  });

  it("computes sensitivity/specificity/PPV/NPV/FPR/FNR correctly", () => {
    const m = basicMetrics(cases);
    expect(m.sensitivity).toBeCloseTo(2 / 3);
    expect(m.specificity).toBeCloseTo(2 / 3);
    expect(m.ppv).toBeCloseTo(2 / 3);
    expect(m.npv).toBeCloseTo(2 / 3);
    expect(m.fpr).toBeCloseTo(1 / 3);
    expect(m.fnr).toBeCloseTo(1 / 3);
  });

  it("computes AUROC with a perfect classifier = 1.0", () => {
    const perfect: BinaryCase[] = [
      { case_id: "p1", y_true: 1, y_pred: 1, score: 0.9 },
      { case_id: "p2", y_true: 0, y_pred: 0, score: 0.1 },
    ];
    expect(auroc(perfect)).toBe(1);
  });

  it("handles ties via midranks (0.5)", () => {
    const tied: BinaryCase[] = [
      { case_id: "t1", y_true: 1, y_pred: 1, score: 0.5 },
      { case_id: "t2", y_true: 0, y_pred: 0, score: 0.5 },
    ];
    expect(auroc(tied)).toBe(0.5);
  });

  it("computes AUPRC for a known example", () => {
    const cs: BinaryCase[] = [
      { case_id: "1", y_true: 1, y_pred: 1, score: 0.9 },
      { case_id: "2", y_true: 0, y_pred: 1, score: 0.8 },
      { case_id: "3", y_true: 1, y_pred: 1, score: 0.7 },
      { case_id: "4", y_true: 0, y_pred: 0, score: 0.1 },
    ];
    // Path: (p=1, r=0.5), (p=0.5, r=0.5), (p=0.667, r=1) => AP = 1*0.5 + 0*0 + 0.667*0.5
    expect(auprc(cs)).toBeCloseTo(0.5 * 1 + (2 / 3) * 0.5, 3);
  });

  it("computes calibration ECE and bins", () => {
    const cs: BinaryCase[] = Array.from({ length: 100 }, (_, i) => ({
      case_id: `c${i}`,
      y_true: (i % 2) as 0 | 1,
      y_pred: (i % 2) as 0 | 1,
      score: i % 2 ? 0.85 : 0.15,
    }));
    const cal = calibration(cs);
    expect(cal.ece).not.toBeNull();
    expect(cal.bins!.length).toBeGreaterThan(0);
    // Positive class scores 0.85 (observed 1.0), negative class 0.15 (observed 0.0)
    // => ECE = 0.5*0.15 + 0.5*0.15 = 0.15
    expect(cal.ece!).toBeGreaterThan(0.1);
  });

  it("reports subgroups", () => {
    const withGroups = cases.map((c, i) => ({ ...c, subgroup: i < 3 ? "deviceA" : "deviceB" }));
    const report = evaluate(withGroups);
    expect(report.subgroups.map((s) => s.group).sort()).toEqual(["deviceA", "deviceB"]);
    expect(report.notes.some((n) => n.includes("NOT report"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dataset management / locked test set / patient-level splits
// ---------------------------------------------------------------------------

describe("dataset management", () => {
  it("deidentifies patient keys deterministically", () => {
    const k1 = deidentifyPatientKey("patient-123", "salt");
    const k2 = deidentifyPatientKey("patient-123", "salt");
    const k3 = deidentifyPatientKey("other", "salt");
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k1).not.toContain("patient");
  });

  it("rejects the same patient across different splits (leakage guard)", async () => {
    const train = await createDataset({ name: "T", version: "1", purpose: "train", modality: "FUNDUS", provenance_note: "test" });
    const locked = await createDataset({ name: "L", version: "1", purpose: "locked_test", modality: "FUNDUS", provenance_note: "test" });

    // Note: train is not locked, so the sample goes in; but locked rejects first on lock check.
    const patient = deidentifyPatientKey("p-leak", "s1");
    const inLocked = await addSample({ dataset_id: locked.dataset_id, study_id: "s1", patient_key: patient, modality: "FUNDUS" });
    expect(inLocked.ok).toBe(false); // locked sets are read-only

    // Exemption path allows it (audited)...
    const exempt = await addSample({ dataset_id: locked.dataset_id, study_id: "s1", patient_key: patient, modality: "FUNDUS", documented_exemption: "single-split evaluation corpus, documented in protocol v1" });
    expect(exempt.ok).toBe(true);

    // ...but the same patient cannot then silently enter train.
    const leak = await addSample({ dataset_id: train.dataset_id, study_id: "s2", patient_key: patient, modality: "FUNDUS" });
    expect(leak.ok).toBe(false);
    expect(leak.reason).toContain("Patient-level leakage rejected");

    const train2 = await createDataset({ name: "T2", version: "1", purpose: "validation", modality: "FUNDUS", provenance_note: "test" });
    const leak2 = await addSample({ dataset_id: train2.dataset_id, study_id: "s3", patient_key: patient, modality: "FUNDUS" });
    expect(leak2.ok).toBe(false);
  });

  it("keeps locked test sets read-only for labels too", async () => {
    const ds = await createDataset({ name: "L2", version: "1", purpose: "locked_test", modality: "OCT", provenance_note: "test" });
    const r = await addSample({ dataset_id: ds.dataset_id, study_id: "lx", patient_key: "k", modality: "OCT", documented_exemption: "protocol" });
    expect(r.ok).toBe(true);
    const label = await setReferenceLabel(r.sample!.sample_id, "retinal_hemorrhage", "no-adjudication");
    expect(label.ok).toBe(false);
    expect(label.reason).toContain("immutable");
  });

  it("requires multi-grader adjudication provenance for reference labels", async () => {
    const ds = await createDataset({ name: "D", version: "1", purpose: "train", modality: "FUNDUS", provenance_note: "test" });
    const s = await addSample({ dataset_id: ds.dataset_id, study_id: "st1", patient_key: deidentifyPatientKey("p1", "s2"), modality: "FUNDUS" });
    expect(s.ok).toBe(true);

    // Label without adjudication -> rejected.
    expect((await setReferenceLabel(s.sample!.sample_id, "retinal_hemorrhage", "bogus")).ok).toBe(false);

    // Two graders disagree -> adjudication required.
    const rec = await recordAnnotations(s.sample!.sample_id, [
      { grader_id: "expert-1", annotation: "retinal_hemorrhage" },
      { grader_id: "expert-2", annotation: "no_finding" },
    ]);
    expect(rec.agreement).toBe("disagreement");
    expect(rec.final_label).toBeNull();

    // Adjudicator must pick a recorded annotation, not invent one.
    await expect(adjudicate(rec.adjudication_id, "chief", "something_new", "because")).rejects.toThrow();

    const resolved = await adjudicate(rec.adjudication_id, "chief", "retinal_hemorrhage", "lesion visible on review");
    expect(resolved?.final_label).toBe("retinal_hemorrhage");

    // Now the label can be set with provenance.
    const ok = await setReferenceLabel(s.sample!.sample_id, "retinal_hemorrhage", rec.adjudication_id);
    expect(ok.ok).toBe(true);
    expect(ok.sample!.reference_label).toBe("retinal_hemorrhage");
  });

  it("unanimous agreement resolves without adjudicator", async () => {
    const ds = await createDataset({ name: "D2", version: "1", purpose: "train", modality: "FUNDUS", provenance_note: "test" });
    const s = await addSample({ dataset_id: ds.dataset_id, study_id: "st2", patient_key: deidentifyPatientKey("p2", "s2"), modality: "FUNDUS" });
    const rec = await recordAnnotations(s.sample!.sample_id, [
      { grader_id: "expert-1", annotation: "no_finding" },
      { grader_id: "expert-2", annotation: "no_finding" },
      { grader_id: "expert-3", annotation: "no_finding" },
    ]);
    expect(rec.agreement).toBe("unanimous");
    expect(rec.final_label).toBe("no_finding");
  });
});
