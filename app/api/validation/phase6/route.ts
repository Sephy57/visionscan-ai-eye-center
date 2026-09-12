import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { PROJECT_ROOT } from "@/lib/config";
import { ensureRegistryHydrated } from "@/lib/models/registryPersistence";
import { gateModelUse, listModels } from "@/lib/models/registry";
import { verifyModelIntegrity } from "@/lib/models/integrity";
import { getHostModelJobResourceGovernor, inspectResourceLeases } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, any>;

const CANDIDATE_MANIFEST = "docs/model-manifests/retguard-dr-v1.0.0-candidate.json";
const COMPETITION_BUNDLE = "docs/generated/model-competition/phase6-retguard-20260913";
const LESION_RESULT = "docs/generated/phase6-lesion-safety-net.json";
const BENCHMARK_RESULT = "docs/generated/phase6-model-benchmark.json";

function readJson(relativePath: string): JsonRecord | null {
  const absolute = path.join(PROJECT_ROOT, relativePath);
  try {
    return JSON.parse(fs.readFileSync(absolute, "utf8")) as JsonRecord;
  } catch {
    return null;
  }
}

function maskHash(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? `${value.slice(0, 12)}…${value.slice(-8)}` : null;
}

function safeModelRecord(model: ReturnType<typeof listModels>[number]): JsonRecord {
  const integrity = verifyModelIntegrity(model.model_id);
  const gate = gateModelUse(model);
  return {
    model_id: model.model_id,
    model_name: model.model_name,
    version: model.version,
    status: model.status,
    format: model.format,
    modalities: model.modalities,
    input_schema: model.input_schema,
    intended_use: model.intended_use,
    limitations: model.limitations,
    sha256_masked: maskHash(model.sha256),
    regulatory_status: model.regulatory_status,
    gate: { allowed: gate.allowed, label: gate.label, findings_use: gate.findings_use, reasons: gate.reasons },
    integrity: { trusted: integrity.trusted, checks: integrity.checks },
  };
}

function candidateSummary(manifest: JsonRecord | null): JsonRecord {
  const model = manifest?.model ?? {
    model_id: manifest?.model_id,
    model_version: manifest?.version,
    artifact_format: manifest?.artifact?.format,
    artifact_sha256: manifest?.artifact?.sha256,
  };
  return {
    model_id: model.model_id ?? "retguard-dr-v1.0.0",
    model_version: model.model_version ?? "v1.0.0",
    lifecycle_status: "CANDIDATE_ONLY",
    rights_state: "RIGHTS_RESTRICTED",
    validation_state: "NOT_BENCHMARK_READY",
    runtime_state: "GRAPH_LOAD_ONLY",
    artifact: {
      format: model.artifact_format ?? "onnx",
      size_bytes: 212474298,
      sha256_masked: maskHash(model.artifact_sha256),
      integrity_state: "VERIFIED_AT_ACQUISITION",
    },
    source_revision: manifest?.source?.revision ?? "v1.0.0",
    input_shape: manifest?.input?.shape ?? manifest?.preprocessing?.input_shape ?? "3x480x480 publisher input; no accepted 3x512x512 conversion",
    parity: {
      state: "FAILED",
      max_logit_difference: 0.002526,
      declared_tolerance: 0.001,
      samples: 6,
    },
    promotion: "BLOCKED",
  };
}

function competitionSummary(bundle: JsonRecord | null): JsonRecord {
  const baseline = bundle?.frozen_baseline_manifest;
  const baselineResult = readJson(`${COMPETITION_BUNDLE}/baseline.json`);
  const candidate = readJson(`${COMPETITION_BUNDLE}/candidate.json`);
  const paired = readJson(`${COMPETITION_BUNDLE}/paired-errors.json`);
  const metrics = readJson(`${COMPETITION_BUNDLE}/metrics.json`);
  return {
    run_id: bundle?.run_id ?? "phase6-retguard-20260913",
    state: "BLOCKED",
    comparison_status: "NOT_COMPARABLE",
    baseline: {
      cases: baseline?.dataset?.case_count ?? 400,
      patients: baseline?.dataset?.patient_count ?? 100,
      referable: baselineResult?.metrics?.referable ?? null,
      grade_3_sensitivity: 0.0441,
      grade_4_sensitivity: 0,
    },
    candidate: {
      measurement_state: candidate?.measurement_state ?? "NOT_MEASURED",
      metrics: candidate?.metrics ?? null,
    },
    paired: paired?.paired ?? paired ?? null,
    threshold_experiments: metrics?.threshold_experiments ?? "NOT_MEASURED",
    reasons: [
      "RetGuard publisher ONNX logit-parity gate failed before candidate inference.",
      "No candidate prediction was admitted into the frozen head-to-head denominator.",
      "No FN recovery, FP burden, high-grade, threshold, or ensemble result is established.",
    ],
  };
}

function lesionSummary(result: JsonRecord | null): JsonRecord {
  return {
    measurement_state: result?.measurement_state ?? "NOT_MEASURED",
    scope: result?.scope ?? null,
    aggregate: result?.aggregate ?? null,
    baseline_fn: result?.baseline_fn ?? null,
    nonreferable: result?.nonreferable ?? null,
    gate_definition: result?.gate_definition ?? null,
    phi_included: false,
    limitations: result?.limitations ?? ["No gate-qualified lesion safety-net result is available."],
  };
}

function benchmarkSummary(result: JsonRecord | null): JsonRecord {
  const models = Array.isArray(result?.models) ? result.models : [];
  return {
    status: result?.status ?? "NOT_MEASURED",
    platform: result?.platform ?? null,
    runs_per_phase: result?.runs_per_phase ?? null,
    timeout_ms: result?.timeout_ms ?? null,
    models: models.map((model: JsonRecord) => ({
      model_id: model.model_id,
      status: model.status,
      runs_per_phase: model.runs_per_phase,
      cold: model.cold,
      warm: model.warm,
    })),
    limitations: [
      "Fresh isolated subprocess observations only; warm is not a resident cache.",
      "One sample per phase is a bounded engineering observation, not a capacity SLO.",
    ],
  };
}

export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN", "REVIEWER", "RESEARCHER"]);
  if (denied) return denied;
  await ensureRegistryHydrated();

  const modelRecords = listModels().map(safeModelRecord);
  let leaseSnapshot: JsonRecord | null = null;
  try {
    const [local, durable] = await Promise.all([
      Promise.resolve(getHostModelJobResourceGovernor().snapshot()),
      inspectResourceLeases(),
    ]);
    leaseSnapshot = {
      process_local: local,
      host_wide: durable,
      enforcement: "SQLite lease admission is durable; host memory is observational and not OS enforcement.",
    };
  } catch {
    leaseSnapshot = { state: "UNAVAILABLE", enforcement: "No resource state is inferred when the operational store cannot be read." };
  }

  const candidateManifest = readJson(CANDIDATE_MANIFEST);
  const competitionManifest = readJson(`${COMPETITION_BUNDLE}/manifest.json`);
  return NextResponse.json({
    schema_version: "visionscan-phase6-validation-v1",
    generated_at: new Date().toISOString(),
    scope: "aggregate_process_local_research_review",
    phi_included: false,
    notice: "Phase 6 evidence is aggregate research evidence. Candidate-only status, failed gates, missing denominators, and clinical limitations are preserved; no normality, diagnosis, safety, or promotion claim is inferred.",
    classifications: {
      software: "ENGINEERING PARTIAL — BLOCKERS REMAIN",
      model: "DR CANDIDATE EVALUATED — IMPROVEMENT NOT ESTABLISHED",
      performance: "LOCAL RUNTIME PARTIAL",
      data: "DATA RELEASE BLOCKED",
      demo: "DEMO / SYNTHETIC RESULT - NOT FOR CLINICAL USE",
      clinical: ["NOT CLINICALLY VALIDATED", "NOT A MEDICAL DEVICE", "NOT FOR AUTONOMOUS DIAGNOSIS"],
    },
    models: modelRecords,
    candidate: candidateSummary(candidateManifest),
    competition: competitionSummary(competitionManifest),
    lesion_safety_net: lesionSummary(readJson(LESION_RESULT)),
    runtime: {
      resource_leases: leaseSnapshot,
      model_benchmark: benchmarkSummary(readJson(BENCHMARK_RESULT)),
      load_points: { "1": "BOUNDED_MEASURED_SUBPROCESS", "5": "NOT_RUN_UNSAFE_WITH_HEAVY_MODELS", "10": "NOT_RUN_UNSAFE_WITH_HEAVY_MODELS", "25": "NOT_RUN_UNSAFE_WITH_HEAVY_MODELS" },
      resident_worker: "NOT_MEASURED",
      crash_matrix: "PARTIAL_SYNTHETIC_AND_FAIL-CLOSED_PROVIDER CHECKS",
    },
    promotion: {
      state: "BLOCKED",
      required_reviews: ["Implementation Reviewer", "Validation/Statistics Reviewer", "Safety/Governance Reviewer"],
      reviewers_signed: 0,
    },
  });
}
