import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { PROJECT_ROOT } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, any>;

const FILES = {
  candidates: "docs/generated/phase7-candidate-search.json",
  parity: "docs/generated/phase7-retguard-parity-investigation.json",
  lesion: "docs/generated/model-competition/phase7-lesion-calibration-20260913/calibration.json",
  race: "docs/generated/phase7-resource-race.json",
  load: "docs/generated/phase7-real-load.json",
  resident: "docs/generated/phase7-resident-experiment.json",
  crash: "docs/generated/phase7-provider-crash-matrix.json",
};

function readJson(relativePath: string): JsonRecord | null {
  try { return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8")) as JsonRecord; } catch { return null; }
}

function candidateProjection(value: JsonRecord | null): JsonRecord {
  const candidates = Array.isArray(value?.candidates) ? value.candidates : [];
  return {
    decision: value?.decision ?? "NOT_MEASURED",
    candidates: candidates.map((candidate: JsonRecord) => ({
      candidate_id: candidate.candidate_id,
      task: candidate.task,
      artifact_format: candidate.artifact_format,
      artifact_sha256: candidate.artifact_sha256,
      artifact_state: candidate.artifact_state,
      rights_state: candidate.rights_state,
      decision: candidate.decision,
      blockers: Array.isArray(candidate.blockers) ? candidate.blockers : [],
    })),
  };
}

function parityProjection(value: JsonRecord | null): JsonRecord {
  return {
    status: value?.status ?? "NOT_MEASURED",
    candidate_id: value?.candidate_id ?? "retguard-dr-v1.0.0",
    artifact_sha256: value?.artifact?.sha256 ?? null,
    publisher_observation: value?.publisher_observation ?? null,
    graph: value?.graph ? { graph_load: value.graph.graph_load, inference: value.graph.inference, input_shape: value.graph.input_shape, outputs: value.graph.outputs } : null,
    comparison: value?.comparison ? { publisher_framework_logits_available: value.comparison.publisher_framework_logits !== null, absolute_differences_available: value.comparison.absolute_differences !== null, reason: value.comparison.reason } : null,
    final_decision: value?.final_decision ?? "CANDIDATE_ONLY / RIGHTS_RESTRICTED / NOT_BENCHMARK_READY",
  };
}

function lesionProjection(value: JsonRecord | null): JsonRecord {
  const selection = value?.selection ?? {};
  return {
    measurement_state: value?.measurement_state ?? "NOT_MEASURED",
    dataset: value?.dataset ?? null,
    selection: {
      selected_rule_id: selection.selected_rule_id ?? null,
      selection_state: selection.selection_state ?? "NOT_MEASURED",
      calibration_selected_measurement: selection.calibration_selected_measurement ?? null,
      held_out_evaluation_measurement: selection.held_out_evaluation_measurement ?? null,
    },
    question_two_answer: value?.question_two_answer ?? null,
    pareto_frontier: value?.pareto_frontier ?? null,
    label: "REVIEW ESCALATION COVERAGE",
    forbidden_label: "DISEASE RECOVERY",
  };
}

function runtimeProjection(value: JsonRecord | null, label: string): JsonRecord {
  if (!value) return { status: "NOT_MEASURED", label };
  return {
    status: value.status ?? "NOT_MEASURED",
    worker_mode: value.worker_mode ?? null,
    config: value.config ?? null,
    points: value.points ?? null,
    admission: value.admission ?? null,
    heartbeat: value.heartbeat ?? null,
    stale_recovery: value.stale_recovery ?? null,
    ownership_fencing: value.ownership_fencing ?? null,
    two_worker_decision: value.two_worker_decision ?? null,
    resident_decision: value.resident_decision ?? null,
    peak_resources: value.peak_resources ?? null,
  };
}

export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN", "REVIEWER", "RESEARCHER"]);
  if (denied) return denied;
  const candidates = readJson(FILES.candidates);
  const parity = readJson(FILES.parity);
  const lesion = readJson(FILES.lesion);
  const race = readJson(FILES.race);
  const load = readJson(FILES.load);
  const resident = readJson(FILES.resident);
  const crash = readJson(FILES.crash);
  return NextResponse.json({
    schema_version: "visionscan-phase7-validation-v1",
    generated_at: new Date().toISOString(),
    scope: "aggregate_internal_research_review",
    phi_included: false,
    notice: "Phase 7 evidence is internal research evidence. Candidate promotion, clinical use, diagnosis, normality, and disease-recovery claims remain blocked.",
    classifications: {
      software: "ENGINEERING PARTIAL — BLOCKERS REMAIN",
      dr: "B. DR CANDIDATE EVALUATED — IMPROVEMENT NOT ESTABLISHED",
      lesion: lesion?.selection?.selected_rule_id ? "LESION ESCALATION CALIBRATED — HELD-OUT RESEARCH EVIDENCE" : "LESION ESCALATION RESEARCH PARTIAL",
      performance: load?.status === "MEASURED_BOUNDED_SINGLE_WORKER_LOAD" ? "LOCAL RUNTIME VALIDATED — BOUNDED SINGLE-WORKER LOAD" : "LOCAL RUNTIME PARTIAL",
      data: "DATA RELEASE BLOCKED",
      clinical: ["NOT CLINICALLY VALIDATED", "NOT A MEDICAL DEVICE", "NOT FOR AUTONOMOUS DIAGNOSIS"],
    },
    candidate_search: candidateProjection(candidates),
    retguard_parity: parityProjection(parity),
    lesion_calibration: lesionProjection(lesion),
    runtime: {
      resource_race: runtimeProjection(race, "resource race"),
      real_load: runtimeProjection(load, "real model load"),
      resident: runtimeProjection(resident, "resident model experiment"),
      crash_matrix: runtimeProjection(crash, "provider crash matrix"),
    },
    promotion: { state: "BLOCKED", allowed_states: ["CANDIDATE_ONLY", "RESEARCH_ONLY"], clinical_state: "NOT_ALLOWED", formal_review_signoffs: 0 },
  });
}
