import { describe, it, expect } from "vitest";
import {
  computeValidationMetrics,
  computeAUROC,
  computeAUPRC,
  checkPatientLevelSeparation,
  computeSubgroupBreakdown,
  computeECE,
  computeBrierScore,
  assessReadinessForStatusTransition,
  LabeledPrediction,
} from "../lib/models/validationHarness";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function mkCase(
  id: string,
  patient: string,
  predicted: boolean,
  actual: boolean,
  extra: Partial<LabeledPrediction> = {}
): LabeledPrediction {
  return { case_id: id, patient_id: patient, predicted, actual, ...extra };
}

// tp=8, fp=2, tn=15, fn=5 (n=30)
function buildConfusionFixture(): LabeledPrediction[] {
  const cases: LabeledPrediction[] = [];
  for (let i = 0; i < 8; i++) cases.push(mkCase(`tp${i}`, `p_tp${i}`, true, true));
  for (let i = 0; i < 2; i++) cases.push(mkCase(`fp${i}`, `p_fp${i}`, true, false));
  for (let i = 0; i < 15; i++) cases.push(mkCase(`tn${i}`, `p_tn${i}`, false, false));
  for (let i = 0; i < 5; i++) cases.push(mkCase(`fn${i}`, `p_fn${i}`, false, true));
  return cases;
}

describe("computeValidationMetrics — hand-computed confusion matrix", () => {
  it("computes exact sensitivity/specificity/ppv/npv for tp=8,fp=2,tn=15,fn=5", () => {
    const metrics = computeValidationMetrics(buildConfusionFixture());
    expect(metrics.n).toBe(30);
    expect(metrics.tp).toBe(8);
    expect(metrics.fp).toBe(2);
    expect(metrics.tn).toBe(15);
    expect(metrics.fn).toBe(5);
    // sensitivity = tp/(tp+fn) = 8/13
    expect(metrics.sensitivity).toBeCloseTo(8 / 13, 12);
    // specificity = tn/(tn+fp) = 15/17
    expect(metrics.specificity).toBeCloseTo(15 / 17, 12);
    // ppv = tp/(tp+fp) = 8/10 = 0.8
    expect(metrics.ppv).toBeCloseTo(0.8, 12);
    // npv = tn/(tn+fn) = 15/20 = 0.75
    expect(metrics.npv).toBeCloseTo(0.75, 12);
  });

  it("returns null (not NaN, not 0) for a metric whose denominator is 0", () => {
    // All cases actual=false => tp+fn = 0 => sensitivity is undefined.
    const cases: LabeledPrediction[] = [
      mkCase("c1", "p1", true, false),
      mkCase("c2", "p2", false, false),
      mkCase("c3", "p3", true, false),
      mkCase("c4", "p4", false, false),
    ];
    const metrics = computeValidationMetrics(cases);
    expect(metrics.tp).toBe(0);
    expect(metrics.fn).toBe(0);
    expect(metrics.sensitivity).toBeNull();
    expect(Number.isNaN(metrics.sensitivity)).toBe(false);
    // specificity is well-defined here (tn+fp > 0)
    expect(metrics.specificity).toBeCloseTo(2 / 4, 12);
    // ppv: tp+fp = 2 > 0, but tp = 0 => ppv = 0 (well-defined, not null)
    expect(metrics.ppv).toBe(0);
    // npv: tn+fn = 2 > 0, tn=2 => npv = 1 (well-defined)
    expect(metrics.npv).toBe(1);
  });

  it("returns null for ppv when there are zero predicted positives", () => {
    const cases: LabeledPrediction[] = [
      mkCase("c1", "p1", false, true),
      mkCase("c2", "p2", false, false),
    ];
    const metrics = computeValidationMetrics(cases);
    expect(metrics.tp).toBe(0);
    expect(metrics.fp).toBe(0);
    expect(metrics.ppv).toBeNull();
  });
});

describe("AUROC", () => {
  it("is 1.0 for perfectly separated scores (all positives score higher than all negatives)", () => {
    const cases: LabeledPrediction[] = [
      mkCase("p1", "pt1", true, true, { predicted_score: 0.9 }),
      mkCase("p2", "pt2", true, true, { predicted_score: 0.8 }),
      mkCase("n1", "pt3", false, false, { predicted_score: 0.3 }),
      mkCase("n2", "pt4", false, false, { predicted_score: 0.2 }),
    ];
    expect(computeAUROC(cases)).toBeCloseTo(1.0, 12);
  });

  it("is 0.0 for perfectly inverted scores (all positives score lower than all negatives)", () => {
    const cases: LabeledPrediction[] = [
      mkCase("p1", "pt1", false, true, { predicted_score: 0.1 }),
      mkCase("p2", "pt2", false, true, { predicted_score: 0.2 }),
      mkCase("n1", "pt3", true, false, { predicted_score: 0.8 }),
      mkCase("n2", "pt4", true, false, { predicted_score: 0.9 }),
    ];
    expect(computeAUROC(cases)).toBeCloseTo(0.0, 12);
  });

  it("matches a hand-computed non-trivial AUROC for an 8-point example", () => {
    // Positives: 0.9, 0.7, 0.3, 0.2   Negatives: 0.8, 0.6, 0.5, 0.1
    //
    // By-hand pairwise-concordance computation (AUROC = fraction of
    // pos/neg pairs where pos score > neg score, +0.5 per tie; no ties here):
    //   0.9 beats 0.8,0.6,0.5,0.1            -> 4
    //   0.7 beats 0.6,0.5,0.1 (not 0.8)      -> 3
    //   0.3 beats 0.1 only                   -> 1
    //   0.2 beats 0.1 only                   -> 1
    //   total concordant pairs = 4+3+1+1 = 9 ; total pairs = 4*4 = 16
    //   AUROC = 9/16 = 0.5625
    //
    // Cross-check via rank-sum: sorted ascending 0.1(N,r1) 0.2(P,r2) 0.3(P,r3)
    // 0.5(N,r4) 0.6(N,r5) 0.7(P,r6) 0.8(N,r7) 0.9(P,r8)
    //   sum of positive ranks = 2+3+6+8 = 19
    //   AUROC = (19 - 4*5/2) / (4*4) = (19-10)/16 = 9/16 = 0.5625
    const cases: LabeledPrediction[] = [
      mkCase("p1", "pt1", true, true, { predicted_score: 0.9 }),
      mkCase("p2", "pt2", true, true, { predicted_score: 0.7 }),
      mkCase("p3", "pt3", false, true, { predicted_score: 0.3 }),
      mkCase("p4", "pt4", false, true, { predicted_score: 0.2 }),
      mkCase("n1", "pt5", true, false, { predicted_score: 0.8 }),
      mkCase("n2", "pt6", false, false, { predicted_score: 0.6 }),
      mkCase("n3", "pt7", false, false, { predicted_score: 0.5 }),
      mkCase("n4", "pt8", false, false, { predicted_score: 0.1 }),
    ];
    expect(computeAUROC(cases)).toBeCloseTo(9 / 16, 12);
  });

  it("returns null when no positives or no negatives exist", () => {
    const allPos: LabeledPrediction[] = [
      mkCase("p1", "pt1", true, true, { predicted_score: 0.9 }),
      mkCase("p2", "pt2", true, true, { predicted_score: 0.5 }),
    ];
    expect(computeAUROC(allPos)).toBeNull();
  });

  it("returns null (via computeValidationMetrics) when not every case has a predicted_score", () => {
    const cases: LabeledPrediction[] = [
      mkCase("p1", "pt1", true, true, { predicted_score: 0.9 }),
      mkCase("n1", "pt2", false, false), // no score
    ];
    const metrics = computeValidationMetrics(cases);
    expect(metrics.auroc).toBeNull();
    expect(metrics.auprc).toBeNull();
  });
});

describe("AUPRC", () => {
  it("is 1.0 for perfectly separated scores (precision stays 1 across full recall range)", () => {
    const cases: LabeledPrediction[] = [
      mkCase("p1", "pt1", true, true, { predicted_score: 0.9 }),
      mkCase("p2", "pt2", true, true, { predicted_score: 0.8 }),
      mkCase("n1", "pt3", false, false, { predicted_score: 0.3 }),
      mkCase("n2", "pt4", false, false, { predicted_score: 0.2 }),
    ];
    expect(computeAUPRC(cases)).toBeCloseTo(1.0, 12);
  });
});

describe("calibration metrics", () => {
  it("computes ECE and Brier score from probability scores", () => {
    const cases: LabeledPrediction[] = [
      mkCase("p1", "p1", true, true, { predicted_score: 0.9 }),
      mkCase("p2", "p2", false, true, { predicted_score: 0.6 }),
      mkCase("n1", "n1", false, false, { predicted_score: 0.2 }),
      mkCase("n2", "n2", true, false, { predicted_score: 0.4 }),
    ];
    // Brier = ((.9-1)^2 + (.6-1)^2 + (.2-0)^2 + (.4-0)^2) / 4
    expect(computeBrierScore(cases)).toBeCloseTo((0.01 + 0.16 + 0.04 + 0.16) / 4, 4);
    // Each score occupies its own decile; ECE is the mean absolute error.
    expect(computeECE(cases)).toBeCloseTo((0.1 + 0.4 + 0.2 + 0.4) / 4, 4);
  });

  it("returns null rather than treating arbitrary scores as probabilities", () => {
    const cases = [mkCase("c", "p", true, true, { predicted_score: 2 })];
    expect(computeECE(cases)).toBeNull();
    expect(computeBrierScore(cases)).toBeNull();
    expect(computeValidationMetrics(cases).ece).toBeNull();
    expect(computeValidationMetrics(cases).brier_score).toBeNull();
  });
});

describe("checkPatientLevelSeparation", () => {
  it("detects an overlapping patient_id across train/test", () => {
    const train: LabeledPrediction[] = [
      mkCase("t1", "patientA", true, true),
      mkCase("t2", "patientB", false, false),
    ];
    const test: LabeledPrediction[] = [
      mkCase("s1", "patientB", true, true), // same patient as train t2 — leakage
      mkCase("s2", "patientC", false, false),
    ];
    const result = checkPatientLevelSeparation(train, test);
    expect(result.separated).toBe(false);
    expect(result.overlapping_patient_ids).toEqual(["patientB"]);
  });

  it("reports separated: true with an empty list when there is no overlap", () => {
    const train: LabeledPrediction[] = [mkCase("t1", "patientA", true, true)];
    const test: LabeledPrediction[] = [mkCase("s1", "patientZ", false, false)];
    const result = checkPatientLevelSeparation(train, test);
    expect(result.separated).toBe(true);
    expect(result.overlapping_patient_ids).toEqual([]);
  });
});

describe("computeSubgroupBreakdown", () => {
  it("produces one metrics object per distinct subgroup value, including an 'unknown' bucket, dropping no case", () => {
    const cases: LabeledPrediction[] = [
      mkCase("c1", "p1", true, true, { subgroup: { device: "DeviceA" } }),
      mkCase("c2", "p2", false, false, { subgroup: { device: "DeviceA" } }),
      mkCase("c3", "p3", true, true, { subgroup: { device: "DeviceB" } }),
      mkCase("c4", "p4", false, true, {}), // no subgroup key at all
      mkCase("c5", "p5", false, false, { subgroup: { laterality: "OD" } }), // has subgroup, but not the "device" key
    ];
    const breakdown = computeSubgroupBreakdown(cases, "device");
    expect(Object.keys(breakdown).sort()).toEqual(["DeviceA", "DeviceB", "unknown"]);
    expect(breakdown["DeviceA"].n).toBe(2);
    expect(breakdown["DeviceB"].n).toBe(1);
    expect(breakdown["unknown"].n).toBe(2);
    const totalCasesCounted = Object.values(breakdown).reduce((sum, m) => sum + m.n, 0);
    expect(totalCasesCounted).toBe(cases.length);
  });
});

describe("assessReadinessForStatusTransition", () => {
  const goodMetrics = computeValidationMetrics(buildConfusionFixture()); // n=30, valid sens/spec

  it("is not ready with n=0", () => {
    const emptyMetrics = computeValidationMetrics([]);
    const result = assessReadinessForStatusTransition(emptyMetrics, {
      hasPatientLevelSplit: true,
      hasExternalValidation: true,
      sampleSize: 0,
    });
    expect(result.ready).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("is not ready without a patient-level split", () => {
    const result = assessReadinessForStatusTransition(goodMetrics, {
      hasPatientLevelSplit: false,
      hasExternalValidation: true,
      sampleSize: 30,
    });
    expect(result.ready).toBe(false);
    expect(result.blockers.some((b) => b.toLowerCase().includes("patient-level"))).toBe(true);
  });

  it("is not ready without external validation", () => {
    const result = assessReadinessForStatusTransition(goodMetrics, {
      hasPatientLevelSplit: true,
      hasExternalValidation: false,
      sampleSize: 30,
    });
    expect(result.ready).toBe(false);
    expect(result.blockers.some((b) => b.toLowerCase().includes("external validation"))).toBe(true);
  });

  it("is not ready for a degenerate all-one-label input (sensitivity/specificity undefined)", () => {
    const degenerate: LabeledPrediction[] = [];
    for (let i = 0; i < 40; i++) degenerate.push(mkCase(`d${i}`, `pd${i}`, false, false));
    const metrics = computeValidationMetrics(degenerate);
    expect(metrics.sensitivity).toBeNull();
    const result = assessReadinessForStatusTransition(metrics, {
      hasPatientLevelSplit: true,
      hasExternalValidation: true,
      sampleSize: 40,
    });
    expect(result.ready).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("is only plausibly ready when sample size adequate AND patient-level split AND external validation all hold", () => {
    const result = assessReadinessForStatusTransition(goodMetrics, {
      hasPatientLevelSplit: true,
      hasExternalValidation: true,
      sampleSize: 30,
    });
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("is not ready when sample size is below the minimum even with split+external validation", () => {
    const smallCases = buildConfusionFixture().slice(0, 10);
    const smallMetrics = computeValidationMetrics(smallCases);
    const result = assessReadinessForStatusTransition(smallMetrics, {
      hasPatientLevelSplit: true,
      hasExternalValidation: true,
      sampleSize: 10,
    });
    expect(result.ready).toBe(false);
    expect(result.blockers.some((b) => b.toLowerCase().includes("sample size"))).toBe(true);
  });
});
