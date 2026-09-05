/**
 * S10 - isolated research-analysis orchestrator. Runs the real S9 SegFormer
 * provider on a study's original fundus image and merges its output into
 * the existing S5 evidence workspace, WITHOUT ever touching
 * `analyzeStudy()`, the model registry, or Gate A.
 *
 * PIPELINE (fail-closed at every stage):
 *   study lookup -> modality check (must resolve FUNDUS) -> real quality
 *   gate (assessQuality) -> temp file write -> SegFormer inference ->
 *   RawModelOutput -> controlled-taxonomy-checked Finding[] -> merge into
 *   the S5 evidence workspace (evidenceFromFindings + re-run conflict/
 *   condition assessment on the combined evidence set) -> temp file cleanup
 *
 * This module NEVER writes to the `analyses` DB collection, NEVER inserts a
 * model into `MODELS`, and is NEVER imported by lib/analysis/pipeline.ts.
 * Its output is explicitly RESEARCH_INFERENCE / NOT CLINICALLY VALIDATED at
 * every layer - see docs/S9_REAL_MODEL_INTEGRATION.md and
 * docs/CLINICAL_AI_ARCHITECTURE.md.
 */

import fs from "fs/promises";
import { dbGet } from "../storage/db";
import type { StudyRecord } from "../studies/service";
import { readOriginalScan } from "../storage/files";
import { tmpPath } from "../config";
import { assessQuality } from "../imaging/quality";
import { canonicalModality } from "../models/modalities";
import { assessOod, OOD_MESSAGE } from "../analysis/ood";
import { classifyImageSuitability } from "../analysis/imageSuitability";
import { runSegformerResearchInference, ArtifactNotFoundError } from "../models/segformerResearchProvider";
import { segformerOutputToFindings } from "../models/segformerFindingAdapter";
import { buildEvidenceWorkspace } from "./synthesize";
import { evidenceFromFindings } from "./adapters";
import { detectConflicts, attachConflictIds } from "./conflicts";
import { assessConditions } from "./synthesize";
import type { EvidenceWorkspace } from "./types";
import type { Finding } from "../analysis/schema";
import type { QualityResult } from "../imaging/quality";

export type ResearchAnalysisState =
  | "NOT_A_STUDY"
  | "UNSUPPORTED_MODALITY"
  | "IMAGE_QUALITY_INSUFFICIENT"
  | "OUT_OF_DISTRIBUTION"
  | "INFERENCE_UNAVAILABLE"
  | "COMPLETED";

export interface ResearchAnalysisResult {
  state: ResearchAnalysisState;
  reason?: string;
  modality: string;
  quality_status?: string;
  quality?: QualityResult;
  findings: Finding[];
  evidence_workspace: EvidenceWorkspace | null;
  safety_banner: string;
  generated_at: string;
}

const SAFETY_BANNER =
  "AI RESEARCH INFERENCE — NOT A DIAGNOSIS. NOT CLINICALLY VALIDATED. " +
  "Segmentation-derived areas are objective, unvalidated image measurements only. " +
  "Human clinical review is required before any of this information is acted on.";

/**
 * Runs the full research-analysis pipeline for one study. Every non-COMPLETED
 * state is a fail-closed outcome, never a fabricated "normal" result.
 */
export async function runResearchAnalysis(studyId: string): Promise<ResearchAnalysisResult> {
  const now = () => new Date().toISOString();
  const base = { findings: [] as Finding[], evidence_workspace: null, safety_banner: SAFETY_BANNER, generated_at: now() };

  const study = await dbGet<StudyRecord>("studies", studyId);
  if (!study) return { ...base, state: "NOT_A_STUDY", modality: "unknown" };

  const canonical = canonicalModality(study.modality);
  if (canonical !== "FUNDUS") {
    return {
      ...base,
      state: "UNSUPPORTED_MODALITY",
      reason: `The research model supports FUNDUS photography only; this study's modality resolves to ${canonical}.`,
      modality: canonical,
    };
  }

  const bytes = await readOriginalScan(studyId);
  if (!bytes) return { ...base, state: "NOT_A_STUDY", modality: canonical, reason: "Original scan file is missing." };

  const quality = await assessQuality(bytes);
  if (quality.quality_status !== "pass") {
    // Matches lib/analysis/pipeline.ts's stricter standard (pass-only) - a
    // "borderline" image must not reach real inference here either, even
    // though it isn't an outright "fail".
    return {
      ...base,
      state: "IMAGE_QUALITY_INSUFFICIENT",
      reason: `Image quality gate did not pass (status: ${quality.quality_status}, score ${quality.quality_score.toFixed(2)}): ${quality.detected_artifacts.join(", ") || "below threshold"}.`,
      modality: canonical,
      quality_status: quality.quality_status,
      quality,
    };
  }

  // S13 - image suitability consolidation: this path previously ran no OOD
  // check at all (a real gap found by the S12 red-team audit). SegFormer has
  // no registry entry (deliberate clinical isolation, see
  // docs/S9_REAL_MODEL_INTEGRATION.md) so it is described here as a minimal
  // { modalities } descriptor, not a full ModelRecord, and has no declared
  // device-compatibility allowlist (device: null is honest - none exists).
  const ood = assessOod({
    modality: canonical,
    quality,
    model: null,
    device: null,
    metadataProvided: study.metadata.providedBy !== "none",
  });
  const suitability = classifyImageSuitability({
    modality: canonical,
    quality,
    ood,
    model: { modalities: ["FUNDUS"] },
    device: null,
  });
  if (suitability.state === "OUT_OF_DISTRIBUTION" || suitability.state === "DEVICE_UNSUPPORTED") {
    return {
      ...base,
      state: "OUT_OF_DISTRIBUTION",
      reason: suitability.reasons.join(" ") || OOD_MESSAGE,
      modality: canonical,
      quality_status: quality.quality_status,
      quality,
    };
  }

  const tmpFile = tmpPath(`research-${studyId}-${Date.now()}.bin`);
  await fs.writeFile(tmpFile, bytes);
  let rawOutput;
  try {
    rawOutput = await runSegformerResearchInference(tmpFile);
  } catch (err) {
    if (err instanceof ArtifactNotFoundError) {
      return { ...base, state: "INFERENCE_UNAVAILABLE", reason: err.message, modality: canonical, quality_status: quality.quality_status, quality };
    }
    throw err;
  } finally {
    await fs.unlink(tmpFile).catch(() => {}); // never leave a PHI-bearing temp copy behind
  }

  if (rawOutput.inference_status !== "completed") {
    return {
      ...base,
      state: "INFERENCE_UNAVAILABLE",
      reason: rawOutput.inference_error ?? "Inference did not complete.",
      modality: canonical,
      quality_status: quality.quality_status,
      quality,
    };
  }

  const findings = segformerOutputToFindings(rawOutput, canonical);

  const workspace = await buildEvidenceWorkspace(studyId);
  if ("not_found" in workspace) {
    return { ...base, state: "NOT_A_STUDY", modality: canonical, quality_status: quality.quality_status, quality };
  }

  const newEvidence = evidenceFromFindings(studyId, study.eye, findings).filter((e) => e.study_id === studyId);
  const mergedEvidence = [...workspace.evidence, ...newEvidence];
  const conflicts = detectConflicts(mergedEvidence);
  attachConflictIds(mergedEvidence, conflicts);
  const possibleConditions = assessConditions(mergedEvidence);

  const mergedWorkspace: EvidenceWorkspace = {
    ...workspace,
    evidence: mergedEvidence,
    conflicts,
    possible_conditions: possibleConditions,
    generated_at: now(),
  };

  return {
    state: "COMPLETED",
    modality: canonical,
    quality_status: quality.quality_status,
    quality,
    findings,
    evidence_workspace: mergedWorkspace,
    safety_banner: SAFETY_BANNER,
    generated_at: now(),
  };
}
