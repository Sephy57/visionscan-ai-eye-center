/**
 * Calibration record registry (Phase 6 infrastructure).
 *
 * `lib/models/calibration.ts` defines the CalibrationRecord shape and the
 * pure functions to validate/apply one, but - until now - nothing actually
 * stored or looked one up. This closes that gap: a real provider (Phase 6)
 * can register a calibration record once it has real evidence, and
 * `lib/models/outputConversion.ts` looks it up by model id/version when
 * converting raw model output into pipeline-native findings.
 *
 * HONESTY RULE (unchanged from the rest of the model-governance code): a
 * calibration record can never be registered without evidence -
 * `registerCalibration` refuses anything that fails
 * `validateCalibrationRecord()`. No calibration record exists for the DEMO
 * model, and none should ever be added for it.
 */

import { dbPut, dbGet, dbAll } from "../storage/db";
import { CalibrationRecord, validateCalibrationRecord } from "./calibration";
import { audit } from "../audit";

export async function registerCalibration(rec: CalibrationRecord): Promise<CalibrationRecord> {
  const v = validateCalibrationRecord(rec);
  if (!v.ok) throw new Error("Refusing to register calibration record without valid evidence: " + v.reasons.join("; "));
  await dbPut("calibration_records", rec.calibration_id, rec);
  await audit({ actor: "system", action: "calibration.register", outcome: "ok", detail: `${rec.calibration_id} for ${rec.model_id}@${rec.model_version} (${rec.method})` });
  return rec;
}

export async function getCalibration(calibrationId: string): Promise<CalibrationRecord | null> {
  return dbGet<CalibrationRecord>("calibration_records", calibrationId);
}

export async function listCalibrations(modelId?: string): Promise<CalibrationRecord[]> {
  const all = await dbAll<CalibrationRecord>("calibration_records");
  const sorted = all.sort((a, b) => b.calibration_date.localeCompare(a.calibration_date));
  return modelId ? sorted.filter((c) => c.model_id === modelId) : sorted;
}

/** Most recent valid calibration record for an exact model id + version, or null if none exists. */
export async function getActiveCalibrationForModel(modelId: string, modelVersion: string): Promise<CalibrationRecord | null> {
  const matches = (await listCalibrations(modelId)).filter((c) => c.model_version === modelVersion && validateCalibrationRecord(c).ok);
  return matches[0] ?? null;
}
