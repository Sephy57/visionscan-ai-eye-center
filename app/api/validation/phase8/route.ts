import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { PROJECT_ROOT } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, any>;

function readJson(relativePath: string): JsonRecord | null {
  try { return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8")) as JsonRecord; } catch { return null; }
}

function aggregateRegistry(value: JsonRecord | null): JsonRecord {
  if (!value) return { status: "NOT_MEASURED" };
  return {
    status: value.registry_state ?? "NOT_MEASURED",
    execution_source: value.execution_source ?? "NOT_MEASURED",
    fresh_phase8_inference: value.fresh_phase8_inference ?? false,
    cohort: value.cohort ?? null,
    aggregate: value.aggregate ?? null,
    combined: value.combined ?? null,
    frozen_rule_id: value.frozen_rule?.rule_id ?? null,
  };
}

export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN", "REVIEWER", "RESEARCHER"]);
  if (denied) return denied;
  const registry = readJson("docs/generated/phase8-high-grade-miss-registry.json");
  const ruleFreeze = readJson("docs/generated/phase8-lesion-rule-freeze.json");
  const external = readJson("docs/generated/phase8-external-lesion-validation.json");
  const phase7Load = readJson("docs/generated/phase7-real-load.json");
  const phase7Race = readJson("docs/generated/phase7-resource-race.json");
  const phase7Crash = readJson("docs/generated/phase7-provider-crash-matrix.json");
  const phase7Resident = readJson("docs/generated/phase7-resident-experiment.json");
  return NextResponse.json({
    schema_version: "visionscan-phase8-validation-v1",
    generated_at: new Date().toISOString(),
    scope: "aggregate_internal_research_review",
    phi_included: false,
    notice: "Phase 8 evidence is research-only. High-grade entries use hashed case keys; no raw patient/image identifiers are returned. No negative, unavailable, OOD, or OCT NORMAL output establishes a normal eye.",
    classifications: {
      retinal_intelligence: external?.decision === "EXTERNAL LESION ESCALATION VALIDATION NOT ESTABLISHED." ? "RETINAL REVIEW INTELLIGENCE PARTIAL — INTERNAL HELD-OUT EVIDENCE ONLY" : "NOT MEASURED",
      runtime: phase7Load?.points?.find((point: JsonRecord) => point.requested === 25)?.completed_jobs === 25 ? "LOCAL RUNTIME VALIDATED — BOUNDED CONFIGURATION" : "LOCAL RUNTIME PARTIAL",
      software: "ENGINEERING PARTIAL — BLOCKERS REMAIN",
      data: "DATA RELEASE BLOCKED",
      clinical: ["NOT CLINICALLY VALIDATED", "NOT A MEDICAL DEVICE", "NOT FOR AUTONOMOUS DIAGNOSIS"],
    },
    high_grade_miss_registry: aggregateRegistry(registry),
    lesion_rule_freeze: ruleFreeze ? {
      rule_id: ruleFreeze.rule_id,
      rule: ruleFreeze.rule,
      model: ruleFreeze.model,
      selection: ruleFreeze.selection,
      measured_evidence: ruleFreeze.measured_evidence,
    } : { status: "NOT_MEASURED" },
    external_validation: external ? {
      decision: external.decision,
      attempts: external.attempts?.map((attempt: JsonRecord) => ({ dataset: attempt.dataset, local_state: attempt.local_state, decision: attempt.decision, inference_run: attempt.inference_run, reason: attempt.reason })),
      required_next_evidence: external.required_next_evidence,
    } : { decision: "EXTERNAL LESION ESCALATION VALIDATION NOT ESTABLISHED." },
    runtime: {
      real_load: phase7Load ? { status: phase7Load.status, points: phase7Load.points, two_worker_decision: phase7Load.two_worker_decision } : { status: "NOT_MEASURED" },
      resource_race: phase7Race ? { status: phase7Race.status, admission: phase7Race.admission, stale_recovery: phase7Race.stale_recovery, ownership_fencing: phase7Race.ownership_fencing } : { status: "NOT_MEASURED" },
      crash_matrix: phase7Crash ? { status: phase7Crash.status, recovery_scope: phase7Crash.recovery_scope, unmeasured_stages: phase7Crash.unmeasured_stages } : { status: "NOT_MEASURED" },
      resident_lesion: phase7Resident ? { status: phase7Resident.status, cases: phase7Resident.cases, resident_decision: phase7Resident.resident_decision, peak_resources: phase7Resident.peak_resources, state_isolation: phase7Resident.state_isolation } : { status: "NOT_MEASURED" },
      persistence: { exactly_once: "NOT_MEASURED", crash_before_persistence: "PARTIAL_DIRECT_PROVIDER_EVIDENCE", crash_after_persistence: "NOT_MEASURED", graceful_shutdown: "NOT_MEASURED", restart_recovery: "NOT_MEASURED" },
    },
    fusion: {
      engine: "RetinalEvidenceFusionEngine",
      schema_version: "phase8-retinal-evidence-fusion-1.0.0",
      diagnostic_ensemble: false,
      score_averaging: false,
      normality_claim_allowed: false,
      urgent_symptoms_independent: true,
    },
    promotion: { state: "BLOCKED", allowed_states: ["CANDIDATE_ONLY", "RESEARCH_ONLY"], clinical_state: "NOT_ALLOWED", formal_review_signoffs: 0 },
  });
}
