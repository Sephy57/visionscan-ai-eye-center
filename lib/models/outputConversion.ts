/**
 * Raw model output -> pipeline-native Finding[] conversion (Phase 6 infrastructure).
 *
 * This is the literal "connect the plumbing" work flagged by the Phase 4/5
 * audits: `outputContract.ts` (schema for what a real model may return) and
 * `calibration.ts` (raw-vs-calibrated separation) existed but nothing ever
 * called them from the live analysis path, because the only installed
 * provider (PlaceholderDemoProvider) emits pipeline-native Finding[]
 * directly and never produces a RawModelOutput at all.
 *
 * A future real EyeModelProvider should call this function inside its own
 * analyzeStudy(): take whatever raw structure the underlying runtime
 * (ONNX, a remote inference service, etc.) produced, and convert it through
 * this single, tested chokepoint - never construct a Finding by hand
 * elsewhere for a non-DEMO model.
 *
 * Order enforced here, matching the documented pipeline contract:
 *   RAW OUTPUT -> validateRawModelOutput() (fail closed) -> calibration
 *   (only if a real, evidence-backed CalibrationRecord exists) -> Finding[]
 */

import { RawModelOutput, validateRawModelOutput } from "./outputContract";
import { CalibrationRecord, applyCalibration, mayDisplayCalibrated } from "./calibration";
import { capCategory } from "../analysis/ensemble";
import { Finding } from "../analysis/schema";
import { ModelRecord } from "./registry";

export interface RawOutputConversionResult {
  ok: boolean;
  findings: Finding[];
  errors: Array<{ path: string; message: string }>;
  notes: string[];
}

export function convertRawModelOutputToFindings(params: {
  raw: unknown;
  study_id: string;
  model: ModelRecord;
  /** Pass null explicitly when no calibration record exists - never fabricate one. */
  calibration: CalibrationRecord | null;
}): RawOutputConversionResult {
  const validation = validateRawModelOutput(params.raw);
  if (!validation.valid || !validation.output) {
    // Fail closed: an output that doesn't pass the contract produces NO
    // findings, never a best-effort partial parse.
    return {
      ok: false,
      findings: [],
      errors: validation.errors,
      notes: ["Raw model output failed contract validation - no findings produced (fail closed)."],
    };
  }

  const raw: RawModelOutput = validation.output;
  if (raw.inference_status === "failed") {
    return { ok: true, findings: [], errors: [], notes: [raw.inference_error ?? "Model inference failed; no findings produced."] };
  }

  // DEMO models must never reach this path with a real calibration record -
  // calibration only ever applies to a genuinely non-DEMO, evidence-backed model.
  const trustCalibration = params.model.status !== "DEMO" && mayDisplayCalibrated(params.calibration);
  const notes: string[] = [];
  if (params.calibration && !trustCalibration) {
    notes.push("A calibration record was supplied but is not trusted for this model/status - calibrated confidence was withheld.");
  }

  const findings: Finding[] = (raw.findings ?? []).map((f, i) => {
    const rawConfidence = typeof f.confidence === "number" ? f.confidence : 0;
    let calibratedConfidence: number | null = null;
    if (trustCalibration && params.calibration && typeof f.confidence === "number") {
      calibratedConfidence = applyCalibration(params.calibration, f.confidence).calibrated_probability;
    }
    // A provider-supplied calibrated_confidence with no trusted calibration
    // record backing it is never honored - fail closed rather than trust an
    // unverified claim (mirrors the schema's own calibration_honesty rule).

    const displayConfidence = calibratedConfidence ?? rawConfidence;
    return {
      id: `rf_${params.study_id}_${i}`,
      type: f.finding_type,
      location: f.location ?? "unspecified",
      severity: f.severity ?? "indeterminate",
      confidence: displayConfidence,
      confidence_category: typeof f.confidence === "number" ? capCategory(displayConfidence) : "INDETERMINATE",
      confidence_raw: typeof f.confidence === "number" ? f.confidence : null,
      confidence_calibrated: calibratedConfidence,
      taxonomy_level: "observation",
      region: f.localization?.coordinates ?? null,
      explanation: f.evidence ?? "Model-detected finding. Automated analysis; requires clinician review.",
      synthetic: false,
      model_id: params.model.model_id,
      model_version: params.model.version,
      model_status: params.model.status,
      source_modality: raw.modality ?? params.model.modalities[0] ?? undefined,
      laterality: f.laterality === "both" ? "OU" : f.laterality ?? (raw.laterality === "both" ? "OU" : raw.laterality ?? "unknown"),
    };
  });

  return { ok: true, findings, errors: [], notes };
}
