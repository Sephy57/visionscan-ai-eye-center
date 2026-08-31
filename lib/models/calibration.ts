/**
 * Calibration infrastructure.
 *
 * HARD RULE: a raw model score is never labeled "confidence", "probability of
 * disease", or "diagnostic certainty" unless calibration evidence exists.
 * This module stores calibration records and converts raw scores using the
 * recorded method â€” while keeping raw_score and calibrated_probability
 * strictly separate in every structure it produces.
 */

export interface CalibrationRecord {
  calibration_id: string;
  model_id: string;
  model_version: string;
  method: "platt_scaling" | "isotonic_regression" | "temperature_scaling" | "lookup_table";
  // Method parameters (semantics depend on method; stored verbatim for provenance)
  parameters: Record<string, number | number[]>;
  calibration_dataset: string;        // dataset id / version used to fit the calibration
  calibration_date: string;           // ISO date
  ece_after: number | null;           // expected calibration error after calibration
  evidence_ref: string;               // evaluation-run / document reference (required)
}

export interface CalibratedScore {
  raw_score: number;                  // untouched model output
  calibrated_probability: number;     // derived via the recorded method
  calibration_method: string;
  calibration_dataset: string;
  calibration_date: string;
  calibration_id: string;
}

export function validateCalibrationRecord(rec: CalibrationRecord): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!rec.calibration_id) reasons.push("calibration_id required");
  if (!rec.model_id || !rec.model_version) reasons.push("model_id/model_version required");
  if (!["platt_scaling", "isotonic_regression", "temperature_scaling", "lookup_table"].includes(rec.method)) {
    reasons.push("unknown calibration method");
  }
  if (!rec.parameters || Object.keys(rec.parameters).length === 0) reasons.push("calibration parameters required");
  if (!rec.calibration_dataset) reasons.push("calibration_dataset required");
  if (!rec.calibration_date) reasons.push("calibration_date required");
  if (!rec.evidence_ref) reasons.push("calibration requires an evidence reference");
  return { ok: reasons.length === 0, reasons };
}

/**
 * Apply a calibration record to a raw score.
 * Only records that passed validateCalibrationRecord may be used.
 */
export function applyCalibration(rec: CalibrationRecord, rawScore: number): CalibratedScore {
  const v = validateCalibrationRecord(rec);
  if (!v.ok) throw new Error("Refusing to calibrate without valid calibration evidence: " + v.reasons.join("; "));
  let p: number;
  switch (rec.method) {
    case "platt_scaling": {
      const a = Number(rec.parameters.a ?? 1);
      const b = Number(rec.parameters.b ?? 0);
      p = 1 / (1 + Math.exp(-(a * rawScore + b)));
      break;
    }
    case "temperature_scaling": {
      const t = Number(rec.parameters.temperature ?? 1);
      p = 1 / (1 + Math.exp(-(rawScore / t)));
      break;
    }
    case "lookup_table": {
      const table = rec.parameters.table;
      if (!Array.isArray(table) || table.length === 0) throw new Error("lookup_table calibration requires a table parameter");
      // table entries: [raw_upper_bound, calibrated_probability], ascending by bound
      const last = (table[table.length - 1] as unknown as number[])[1];
      const hitRaw = table.find((e) => rawScore <= (e as unknown as number[])[0]) as unknown as number[] | undefined;
      const hit = hitRaw?.[1];
      p = hit !== undefined ? hit : last;
      break;
    }
    case "isotonic_regression": {
      const table = rec.parameters.table;
      if (!Array.isArray(table) || table.length === 0) throw new Error("isotonic_regression calibration requires a table parameter");
      const last = (table[table.length - 1] as unknown as number[])[1];
      const hitRaw = table.find((e) => rawScore <= (e as unknown as number[])[0]) as unknown as number[] | undefined;
      const hit = hitRaw?.[1];
      p = hit !== undefined ? hit : last;
      break;
    }
  }
  return {
    raw_score: rawScore,
    calibrated_probability: Math.min(1, Math.max(0, Math.round(p * 10000) / 10000)),
    calibration_method: rec.method,
    calibration_dataset: rec.calibration_dataset,
    calibration_date: rec.calibration_date,
    calibration_id: rec.calibration_id,
  };
}

/** Guard used by presentation code: may a calibrated number be displayed? */
export function mayDisplayCalibrated(rec: CalibrationRecord | null | undefined): boolean {
  if (!rec) return false;
  return validateCalibrationRecord(rec).ok;
}
