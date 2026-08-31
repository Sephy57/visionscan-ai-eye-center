import { AnalysisResult } from "../analysis/schema";
import { dbGet, dbPut } from "../storage/db";
import { writeJson } from "../storage/files";
import { DEMO_LABEL, VALIDATION_STATUS_BANNER } from "../config";

/**
 * Report Generator.
 *
 * Builds a clinical report from the structured analysis result ONLY.
 * The report generator cannot add, alter, or delete findings (safety rule:
 * the explanation layer never modifies underlying structured findings).
 * No clinician names or signatures are generated.
 */

export interface ClinicalReport {
  report_id: string;
  study_id: string;
  generated_at: string;
  report_version: string;
  validation_banner: string;
  demo_label: string;
  patient: {
    // Only what the user chose to provide; system invents nothing.
    identifier?: string | null;
    age_band?: string | null;      // e.g. "60-69" - optional, coarse
    notes?: string | null;
  };
  study: AnalysisResult["study"];
  image_quality: AnalysisResult["quality"];
  overall_result: string;
  findings: AnalysisResult["findings"];
  possible_associations_note: string;
  uncertainty: AnalysisResult["uncertainty"];
  measurements_note: string;
  limitations: string[];
  recommended_next_step: string;
  triage_priority: string;
  review: {
    status: "ai_only" | "clinician_reviewed" | "clinician_finalized";
    reviewer_id?: string;
    finalized_at?: string;
    clinician_changes?: Array<{ field: string; action: string; note?: string; at: string }>;
  };
  provenance: AnalysisResult["provenance"];
  safety: AnalysisResult["safety"];
  exports: {
    json_path?: string;
    fhir_note: string;
  };
}

export const POSSIBLE_ASSOCIATIONS_NOTE =
  "Where the report mentions possible clinical associations, wording is used deliberately: a finding can be " +
  "ASSOCIATED with a condition; this does not establish a diagnosis. OBSERVED FINDING, POSSIBLE ASSOCIATIONS, " +
  "and CONFIRMED DIAGNOSIS are distinct categories. Only a qualified clinician can establish a final diagnosis.";

export const MEASUREMENTS_NOTE =
  "Measurements are reported only when actually computed by an implemented, calibrated component. No component " +
  "currently produces validated quantitative measurements; any numeric values in findings are demo placeholders " +
  "and must not be used clinically.";

export function buildOverallResult(r: AnalysisResult): string {
  if (r.quality.acceptable === false) {
    return "IMAGE QUALITY INSUFFICIENT FOR RELIABLE AUTOMATED ANALYSIS";
  }
  if (r.findings.length === 0) {
    return "NO SIGNIFICANT ABNORMALITY DETECTED BY AUTOMATED SCREENING";
  }
  return "POTENTIAL ABNORMAL FINDING DETECTED";
}

export function buildLimitations(r: AnalysisResult): string[] {
  const l: string[] = [
    VALIDATION_STATUS_BANNER,
    "All detection and segmentation components in this deployment are unvalidated placeholders or heuristics.",
    "Findings are synthetic demo outputs generated to exercise the pipeline; they do not derive from a validated medical model.",
    "No validated reference databases are installed; measurements are not compared against population references.",
    "Device-specific calibration and per-device validation have not been performed.",
    "This system is not a medical device and is not authorized for clinical use.",
  ];
  if (r.quality.acceptable === false) {
    l.push("The quality gate failed; no clinical interpretation was attempted.");
  }
  return l;
}

export async function generateReport(
  analysis: AnalysisResult,
  patient?: ClinicalReport["patient"]
): Promise<ClinicalReport> {
  const report: ClinicalReport = {
    report_id: `rep_${analysis.study.study_id}`,
    study_id: analysis.study.study_id,
    generated_at: new Date().toISOString(),
    report_version: "1.0.0",
    validation_banner: VALIDATION_STATUS_BANNER,
    demo_label: DEMO_LABEL,
    patient: patient ?? { identifier: null, age_band: null, notes: null },
    study: analysis.study,
    image_quality: analysis.quality,
    overall_result: buildOverallResult(analysis),
    findings: analysis.findings,
    possible_associations_note: POSSIBLE_ASSOCIATIONS_NOTE,
    uncertainty: analysis.uncertainty,
    measurements_note: MEASUREMENTS_NOTE,
    limitations: buildLimitations(analysis),
    recommended_next_step: analysis.recommendation.action,
    triage_priority: analysis.recommendation.priority,
    review: { status: "ai_only" },
    provenance: analysis.provenance,
    safety: analysis.safety,
    exports: {
      fhir_note:
        "FHIR-compatible export is architecturally planned (Observation/DiagnosticReport resources). " +
        "Not yet implemented - no FHIR payload is produced by this version.",
    },
  };

  await dbPut("reports", report.report_id, report);
  report.exports.json_path = await writeJson("reports", report.report_id, report);
  return report;
}

export async function getReport(reportId: string): Promise<ClinicalReport | null> {
  return dbGet<ClinicalReport>("reports", reportId);
}
