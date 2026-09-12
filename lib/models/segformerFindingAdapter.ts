/**
 * S10 - converts a real `RawModelOutput` from the S9 SegFormer research
 * provider into the existing `Finding` shape (lib/analysis/schema.ts),
 * reusing the controlled taxonomy (lib/analysis/taxonomy.ts) rather than
 * inventing a parallel finding representation.
 *
 * HARD RULES:
 *  - every finding is checked against `mayEmitFinding()` before being
 *    emitted - an unrecognized/unsupported type is dropped, never guessed
 *  - `synthetic: false` (this is REAL model output, unlike the DEMO
 *    generator) but `taxonomy_level` stays "observation" - never
 *    "diagnosis" - because this model's own dossier documents zero
 *    validation evidence
 *  - `region` is populated ONLY from a real `localization.coordinates`
 *    bounding box the model actually produced - never fabricated; a box
 *    containing NaN/Infinity is corrupt and the whole finding is dropped
 *    (S13 numeric-safety gate)
 *  - `confidence`/`confidence_calibrated` are never invented: this model
 *    exposes neither a raw per-finding score nor calibration evidence, so
 *    both stay undefined and the UI must show "NOT CALIBRATED", not a
 *    fabricated percentage
 */

import type { Finding } from "../analysis/schema";
import type { RawModelOutput } from "./outputContract";
import { mayEmitFinding } from "../analysis/taxonomy";
import { SEGFORMER_RESEARCH_MODEL_ID } from "./segformerResearchProvider";
import { validateSegformerAnatomyOutput, type SegformerAnatomyValidation } from "./anatomyValidation";

let counter = 0;
function findingId(): string {
  counter += 1;
  return `research_finding_${Date.now()}_${counter}`;
}

/**
 * Maps a completed RawModelOutput to Finding[]. Returns an empty array (not
 * an error) for a failed/empty inference - the caller decides how to
 * represent "no findings" honestly (see S10's "NO VALIDATED FINDING
 * AVAILABLE" wording requirement, never silently implying normal).
 */
export interface SegformerFindingAdapterResult {
  findings: Finding[];
  anatomy_validation: SegformerAnatomyValidation;
}

export function segformerOutputToFindingsWithValidation(output: RawModelOutput, modality: string): SegformerFindingAdapterResult {
  if (output.inference_status !== "completed" || !output.findings) {
    return {
      findings: [],
      anatomy_validation: { state: "INCOMPLETE", reasons: ["Completed SegFormer output did not contain findings."], disc_area_pixels: null, cup_area_pixels: null, cup_to_disc_area_ratio: null },
    };
  }

  const anatomyValidation = validateSegformerAnatomyOutput(output.findings);
  // An anatomically impossible segmentation is a model-output integrity
  // failure. Do not pass its individual boxes through as if they were useful
  // observations; the caller surfaces the failure state explicitly.
  if (anatomyValidation.state !== "VALID") {
    // The presentation boundary requires one complete disc/cup pair with
    // enough structured geometry to validate it. Partial anatomy output is
    // not negative evidence and is withheld just like impossible output.
    return { findings: [], anatomy_validation: anatomyValidation };
  }

  const findings: Finding[] = [];
  for (const rf of output.findings) {
    const gate = mayEmitFinding(rf.finding_type, modality, "RESEARCH_CANDIDATE_ONLY");
    if (!gate.ok) continue; // unrecognized/unsupported type - dropped, never guessed into existence

    const region = rf.localization?.kind === "bounding_box" && rf.localization.coordinates
      ? rf.localization.coordinates
      : null;

    // Numeric-safety gate (S13 audit follow-up): a bounding box containing
    // NaN/Infinity is corrupt model output - the finding is DROPPED, never
    // passed through to the UI where a NaN region poisons downstream
    // geometry (zoom, overlay, area math). Fail-safe: drop, don't repair.
    if (
      region &&
      (!Number.isFinite(region.x) || !Number.isFinite(region.y) ||
        !Number.isFinite(region.w) || !Number.isFinite(region.h))
    ) {
      continue;
    }

    findings.push({
      id: findingId(),
      type: rf.finding_type,
      location: rf.finding_type.includes("optic_disc") ? "optic_disc" : rf.finding_type.includes("optic_cup") ? "optic_cup" : "unspecified",
      severity: "indeterminate", // this model produces no severity grading of any kind - never invented
      confidence: 0,             // no raw score exists; 0 is the schema's "none provided" sentinel, never a real score
      confidence_category: "INDETERMINATE",
      confidence_raw: null,
      confidence_calibrated: null, // NOT CALIBRATED - no calibration evidence exists for this candidate
      structured_measurements: rf.measurement
        ? [{
            key: rf.measurement.key,
            value: rf.measurement.value,
            unit: rf.measurement.unit,
            anatomical_region: rf.finding_type.includes("cup") ? "optic_cup" : rf.finding_type.includes("disc") ? "optic_disc" : "unspecified",
            source_modality: modality,
            measurement_confidence: null,
            model_id: output.model_id ?? SEGFORMER_RESEARCH_MODEL_ID,
            model_version: output.model_version ?? "1",
          }]
        : undefined,
      taxonomy_level: "observation",
      region,
      explanation: `Segmentation-derived area (${rf.evidence ?? "extent not recorded"}). RESEARCH_INFERENCE only - not a clinically validated finding.`,
      synthetic: false, // real model output, not the DEMO generator
      model_id: SEGFORMER_RESEARCH_MODEL_ID,
      model_status: "CANDIDATE_ONLY",
    });
  }
  return { findings, anatomy_validation: anatomyValidation };
}

export function segformerOutputToFindings(output: RawModelOutput, modality: string): Finding[] {
  return segformerOutputToFindingsWithValidation(output, modality).findings;
}
