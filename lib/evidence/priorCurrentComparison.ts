/**
 * Same-eye prior-vs-current AI comparison (pure, deterministic).
 *
 * Compares finding types, DR grade estimates, and OCT class estimates
 * between two analyses of the SAME eye. States describe OBSERVED DETECTION
 * differences only. The closed vocabulary below is exhaustive: progression,
 * worsening, improvement, resolution, increase, and decrease language can
 * never be produced here (enforced by types + a fail-closed scan over the
 * serialized output).
 */

import type { AnalysisResult, Finding } from "../analysis/schema";

export type PriorFindingState =
  | "NEW"
  | "PERSISTENT"
  | "CHANGED"
  | "NOT_COMPARABLE"
  | "MODEL_CHANGED"
  | "DEVICE_CHANGED"
  | "MISSING_PRIOR_EVIDENCE";

export type TargetTransitionState =
  | "TARGET_CLASS_CHANGED"
  | "TARGET_CLASS_PERSISTED"
  | "NOT_COMPARABLE"
  | "MODEL_CHANGED"
  | "DEVICE_CHANGED"
  | "MISSING_PRIOR_EVIDENCE";

export interface FindingStateEntry {
  finding_type: string;
  eye: string;
  state: PriorFindingState;
  prior_finding_id: string | null;
  current_finding_id: string | null;
  note: string;
}

export interface DrTransition {
  state: TargetTransitionState;
  prior_grade: number | null;
  current_grade: number | null;
  grade_delta: number | null;
  prior_label: string | null;
  current_label: string | null;
  prior_referable: boolean | null;
  current_referable: boolean | null;
  note: string;
}

export interface OctTransition {
  state: TargetTransitionState;
  prior_class: string | null;
  current_class: string | null;
  prior_index: number | null;
  current_index: number | null;
  note: string;
}

export interface PriorCurrentComparison {
  eye: string;
  prior_study_id: string;
  current_study_id: string;
  prior_model: { model_id: string; model_version: string; model_status: string };
  current_model: { model_id: string; model_version: string; model_status: string };
  finding_states: FindingStateEntry[];
  dr_transition: DrTransition | null;
  oct_transition: OctTransition | null;
  limitations: string[];
  requires_clinician_review: true;
  engine_version: string;
  generated_at: string;
}

export const PRIOR_CURRENT_ENGINE_VERSION = "prior-current-1.0.0";

const BANNED = [/progression/i, /worsen/i, /improv/i, /\bresolved\b/i, /\bstable\b/i, /increased/i, /decreased/i];

/**
 * Fail-closed scan: any banned clinical-change language throws. The three
 * mandatory fixed disclaimers (reviewed copy, all negated) are stripped
 * first so the guard judges generated states/notes — mirroring how the
 * pipeline's safety scan exempts its own negated disclaimer.
 */
export function scanComparisonOutput(output: unknown): string[] {
  let text = JSON.stringify(output);
  for (const fixed of LIMITATIONS) text = text.replaceAll(fixed, "");
  return BANNED.filter((rx) => rx.test(text)).map((rx) => String(rx));
}

const LIMITATIONS = [
  "Observed detection differences do not establish disease progression.",
  "Absence of re-observation establishes nothing about the eye.",
  "Grade/class estimates are uncalibrated research outputs; a target-class change is not a diagnosis.",
];

export interface ComparisonInput {
  prior_study_id: string;
  current_study_id: string;
  prior_eye: string;
  current_eye: string;
  prior_analysis: AnalysisResult | null;
  current_analysis: AnalysisResult | null;
  prior_device: { manufacturer?: string; model?: string } | null;
  current_device: { manufacturer?: string; model?: string } | null;
}

function deviceKey(d: { manufacturer?: string; model?: string } | null): string {
  if (!d || (!d.manufacturer && !d.model)) return "unknown";
  return `${d.manufacturer ?? ""}::${d.model ?? ""}`;
}

function blockEntry(
  state: "NOT_COMPARABLE" | "MODEL_CHANGED" | "DEVICE_CHANGED" | "MISSING_PRIOR_EVIDENCE",
  eye: string,
  note: string
): FindingStateEntry {
  return { finding_type: "*", eye, state, prior_finding_id: null, current_finding_id: null, note };
}

function modelIdentity(a: AnalysisResult): { model_id: string; model_version: string; model_status: string } {
  return {
    model_id: a.model_registry?.model_id ?? "none",
    model_version: a.model_registry?.model_version ?? "none",
    model_status: a.model_registry?.model_status ?? "unknown",
  };
}

function blockedTransition(
  state: "NOT_COMPARABLE" | "MODEL_CHANGED" | "DEVICE_CHANGED" | "MISSING_PRIOR_EVIDENCE",
  note: string
): { dr: DrTransition; oct: OctTransition } {
  const dr: DrTransition = {
    state, prior_grade: null, current_grade: null, grade_delta: null,
    prior_label: null, current_label: null, prior_referable: null, current_referable: null, note,
  };
  const oct: OctTransition = {
    state, prior_class: null, current_class: null, prior_index: null, current_index: null, note,
  };
  return { dr, oct };
}

export function comparePriorCurrent(input: ComparisonInput): PriorCurrentComparison {
  const generated_at = new Date().toISOString();
  const finish = (partial: Omit<PriorCurrentComparison, "generated_at" | "engine_version" | "requires_clinician_review" | "limitations"> & { limitations?: string[] }): PriorCurrentComparison => {
    const out: PriorCurrentComparison = {
      ...partial,
      limitations: [...LIMITATIONS, ...(partial.limitations ?? [])],
      requires_clinician_review: true,
      engine_version: PRIOR_CURRENT_ENGINE_VERSION,
      generated_at,
    };
    const hits = scanComparisonOutput(out);
    if (hits.length > 0) {
      throw new Error(`Comparison output failed language guard: ${hits.join(", ")}`);
    }
    return out;
  };

  const eye = input.current_eye;
  // 1. Same eye required (exact, declared values only).
  if (!input.prior_analysis || !input.current_analysis) {
    const blocked = blockedTransition("MISSING_PRIOR_EVIDENCE", "A stored analysis is missing on at least one side; comparison is refused.");
    return finish({
      eye, prior_study_id: input.prior_study_id, current_study_id: input.current_study_id,
      prior_model: { model_id: "none", model_version: "none", model_status: "unknown" },
      current_model: { model_id: "none", model_version: "none", model_status: "unknown" },
      finding_states: [blockEntry("MISSING_PRIOR_EVIDENCE", eye, "A stored analysis is missing on at least one side; comparison is refused.")],
      dr_transition: blocked.dr, oct_transition: blocked.oct,
    });
  }
  const prior = input.prior_analysis;
  const current = input.current_analysis;
  const priorModel = modelIdentity(prior);
  const currentModel = modelIdentity(current);

  const eyes = [input.prior_eye, input.current_eye, prior.study.eye, current.study.eye].map((e) => (e ?? "").toUpperCase());
  const eyeOk = eyes.every((e) => e === "OD") || eyes.every((e) => e === "OS");
  if (!eyeOk) {
    const blocked = blockedTransition("NOT_COMPARABLE", `Declared eyes are not identically OD/OD or OS/OS (saw ${eyes.join("/")}); cross-eye comparison is refused.`);
    return finish({
      eye, prior_study_id: input.prior_study_id, current_study_id: input.current_study_id,
      prior_model: priorModel, current_model: currentModel,
      finding_states: [blockEntry("NOT_COMPARABLE", eye, "Cross-eye or unknown-eye comparison is refused.")],
      dr_transition: blocked.dr, oct_transition: blocked.oct,
    });
  }

  // 2. Missing prior evidence (quality-failed or empty prior with no estimated layers).
  const priorEmpty =
    (prior.findings ?? []).length === 0 &&
    prior.dr_assessment?.state !== "GRADE_ESTIMATED" &&
    prior.oct_assessment?.state !== "CLASS_ESTIMATED";
  if (!prior.quality.acceptable || priorEmpty) {
    const blocked = blockedTransition(
      "MISSING_PRIOR_EVIDENCE",
      "The prior visit carries no usable AI evidence (quality-blocked or empty with no estimated grade/class); current findings are listed with this flag, not as standalone novelty."
    );
    const currentStates: FindingStateEntry[] = (current.findings ?? []).map((f) => ({
      finding_type: f.type,
      eye,
      state: "MISSING_PRIOR_EVIDENCE" as const,
      prior_finding_id: null,
      current_finding_id: f.id,
      note: "No usable prior AI evidence exists for this eye; observed without a prior baseline.",
    }));
    return finish({
      eye, prior_study_id: input.prior_study_id, current_study_id: input.current_study_id,
      prior_model: priorModel, current_model: currentModel,
      finding_states: currentStates.length ? currentStates : [blockEntry("MISSING_PRIOR_EVIDENCE", eye, "Neither visit carries usable AI evidence.")],
      dr_transition: blocked.dr, oct_transition: blocked.oct,
    });
  }
  if (!current.quality.acceptable) {
    const blocked = blockedTransition("NOT_COMPARABLE", "The current image is not suitable; comparison is refused.");
    return finish({
      eye, prior_study_id: input.prior_study_id, current_study_id: input.current_study_id,
      prior_model: priorModel, current_model: currentModel,
      finding_states: [blockEntry("NOT_COMPARABLE", eye, "The current image is not suitable; comparison is refused.")],
      dr_transition: blocked.dr, oct_transition: blocked.oct,
    });
  }

  // 3. Same model id+version+status required.
  const modelSame =
    priorModel.model_id === currentModel.model_id &&
    priorModel.model_version === currentModel.model_version &&
    priorModel.model_status === currentModel.model_status &&
    priorModel.model_id !== "none";
  if (!modelSame) {
    const blocked = blockedTransition(
      "MODEL_CHANGED",
      `Producing model differs (prior ${priorModel.model_id}@${priorModel.model_version}/${priorModel.model_status} vs current ${currentModel.model_id}@${currentModel.model_version}/${currentModel.model_status}); direct comparison is limited.`
    );
    return finish({
      eye, prior_study_id: input.prior_study_id, current_study_id: input.current_study_id,
      prior_model: priorModel, current_model: currentModel,
      finding_states: [blockEntry("MODEL_CHANGED", eye, "Producing model identity differs; direct comparison is limited.")],
      dr_transition: blocked.dr, oct_transition: blocked.oct,
    });
  }

  // 4. Same device required.
  if (deviceKey(input.prior_device) !== deviceKey(input.current_device)) {
    const blocked = blockedTransition(
      "DEVICE_CHANGED",
      "Declared acquisition device differs (or is known on only one side); comparability is limited because no device is validated."
    );
    return finish({
      eye, prior_study_id: input.prior_study_id, current_study_id: input.current_study_id,
      prior_model: priorModel, current_model: currentModel,
      finding_states: [blockEntry("DEVICE_CHANGED", eye, "Declared acquisition device differs; comparability is limited.")],
      dr_transition: blocked.dr, oct_transition: blocked.oct,
    });
  }

  // 5. Modality gate.
  if (prior.study.modality !== current.study.modality) {
    const blocked = blockedTransition("NOT_COMPARABLE", "Visits differ in modality; comparison is refused.");
    return finish({
      eye, prior_study_id: input.prior_study_id, current_study_id: input.current_study_id,
      prior_model: priorModel, current_model: currentModel,
      finding_states: [blockEntry("NOT_COMPARABLE", eye, "Visits differ in modality; comparison is refused.")],
      dr_transition: blocked.dr, oct_transition: blocked.oct,
    });
  }

  // 6. Per-finding states by exact type.
  const byType = (list: Finding[]) => {
    const m = new Map<string, Finding[]>();
    for (const f of list) m.set(f.type, [...(m.get(f.type) ?? []), f]);
    return m;
  };
  const pm = byType(prior.findings ?? []);
  const cm = byType(current.findings ?? []);
  const types = [...new Set([...pm.keys(), ...cm.keys()])].sort();
  const finding_states: FindingStateEntry[] = [];
  for (const t of types) {
    const p = (pm.get(t) ?? [])[0] ?? null;
    const c = (cm.get(t) ?? [])[0] ?? null;
    if (p && c) {
      const diffs: string[] = [];
      if (p.severity !== c.severity) diffs.push("severity");
      if (p.confidence_category !== c.confidence_category) diffs.push("confidence_category");
      if (p.location !== c.location) diffs.push("location");
      if (diffs.length === 0) {
        finding_states.push({ finding_type: t, eye, state: "PERSISTENT", prior_finding_id: p.id, current_finding_id: c.id, note: "Observed in both visits under same model/device/eye." });
      } else {
        finding_states.push({ finding_type: t, eye, state: "CHANGED", prior_finding_id: p.id, current_finding_id: c.id, note: `Observed in both visits with observed attribute difference (${diffs.join(", ")}); this is an observed detection difference under same model/device/eye, not a clinical change judgment.` });
      }
    } else if (c && !p) {
      finding_states.push({ finding_type: t, eye, state: "NEW", prior_finding_id: null, current_finding_id: c.id, note: "Observed in the current visit only, under same model/device/eye." });
    } else {
      finding_states.push({ finding_type: t, eye, state: "CHANGED", prior_finding_id: p!.id, current_finding_id: null, note: "Observed in the prior visit and not observed now under same model/device/eye; absence of re-observation establishes nothing about the eye." });
    }
  }
  if (types.length === 0) {
    finding_states.push({ finding_type: "*", eye, state: "PERSISTENT", prior_finding_id: null, current_finding_id: null, note: "No finding types in either visit under comparable conditions." });
  }

  // 7. Grade/class transitions (layer-model match required).
  const drPriorOk = prior.dr_assessment?.state === "GRADE_ESTIMATED" && Number.isInteger(prior.dr_assessment.grade);
  const drCurrentOk = current.dr_assessment?.state === "GRADE_ESTIMATED" && Number.isInteger(current.dr_assessment.grade);
  const drModelSame =
    (prior.dr_assessment?.model_id ?? null) === (current.dr_assessment?.model_id ?? null) &&
    (prior.dr_assessment?.model_version ?? null) === (current.dr_assessment?.model_version ?? null) &&
    prior.dr_assessment?.model_id != null;
  let dr_transition: DrTransition;
  if (!drPriorOk || !drCurrentOk) {
    dr_transition = { ...blockedTransition("NOT_COMPARABLE", "DR grade estimate unavailable on at least one side.").dr };
  } else if (!drModelSame) {
    dr_transition = { ...blockedTransition("MODEL_CHANGED", "DR grader identity differs between visits.").dr };
  } else {
    const pg = prior.dr_assessment!.grade!;
    const cg = current.dr_assessment!.grade!;
    dr_transition = {
      state: pg === cg ? "TARGET_CLASS_PERSISTED" : "TARGET_CLASS_CHANGED",
      prior_grade: pg, current_grade: cg, grade_delta: cg - pg,
      prior_label: prior.dr_assessment!.grade_label, current_label: current.dr_assessment!.grade_label,
      prior_referable: prior.dr_assessment!.referable_dr, current_referable: current.dr_assessment!.referable_dr,
      note: pg === cg
        ? `DR grade estimate ${pg} (${prior.dr_assessment!.grade_label}) in both visits; research estimates only.`
        : `DR grade estimate ${pg} (${prior.dr_assessment!.grade_label}) -> ${cg} (${current.dr_assessment!.grade_label}), delta ${cg - pg}; research estimates only.`,
    };
  }

  const octPriorOk = prior.oct_assessment?.state === "CLASS_ESTIMATED" && prior.oct_assessment.predicted_class != null;
  const octCurrentOk = current.oct_assessment?.state === "CLASS_ESTIMATED" && current.oct_assessment.predicted_class != null;
  const octModelSame =
    (prior.oct_assessment?.model_id ?? null) === (current.oct_assessment?.model_id ?? null) &&
    (prior.oct_assessment?.model_version ?? null) === (current.oct_assessment?.model_version ?? null) &&
    prior.oct_assessment?.model_id != null;
  let oct_transition: OctTransition;
  if (!octPriorOk || !octCurrentOk) {
    oct_transition = { ...blockedTransition("NOT_COMPARABLE", "OCT class estimate unavailable on at least one side.").oct };
  } else if (!octModelSame) {
    oct_transition = { ...blockedTransition("MODEL_CHANGED", "OCT classifier identity differs between visits.").oct };
  } else if (prior.oct_assessment!.predicted_class === current.oct_assessment!.predicted_class) {
    oct_transition = {
      state: "TARGET_CLASS_PERSISTED",
      prior_class: prior.oct_assessment!.predicted_class, current_class: current.oct_assessment!.predicted_class,
      prior_index: prior.oct_assessment!.predicted_index, current_index: current.oct_assessment!.predicted_index,
      note: `OCT class estimate ${prior.oct_assessment!.predicted_class} in both visits; research estimates only.`,
    };
  } else {
    oct_transition = {
      state: "TARGET_CLASS_CHANGED",
      prior_class: prior.oct_assessment!.predicted_class, current_class: current.oct_assessment!.predicted_class,
      prior_index: prior.oct_assessment!.predicted_index, current_index: current.oct_assessment!.predicted_index,
      note: `OCT class estimate ${prior.oct_assessment!.predicted_class} -> ${current.oct_assessment!.predicted_class}; research estimates only.`,
    };
  }

  return finish({
    eye, prior_study_id: input.prior_study_id, current_study_id: input.current_study_id,
    prior_model: priorModel, current_model: currentModel,
    finding_states, dr_transition, oct_transition,
  });
}
