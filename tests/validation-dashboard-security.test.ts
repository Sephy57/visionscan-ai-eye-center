import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createSession, SESSION_COOKIE } from "@/lib/auth/sessions";
import { createEvaluationRun, getEvaluationRun } from "@/lib/research/evaluationRuns";
import { safeValidationRun } from "@/lib/research/validationDashboard";
import { dbDelete, dbPut } from "@/lib/storage/db";
import { listStudiesWithStatus } from "@/lib/studies/service";

function request(url: string, token?: string): NextRequest {
  return new NextRequest(url, token ? { headers: { cookie: SESSION_COOKIE + "=" + token } } : undefined);
}

describe("validation dashboard privacy and RBAC", () => {
  const createdRunIds: string[] = [];
  const createdStudyIds: string[] = [];

  afterEach(async () => {
    for (const runId of createdRunIds.splice(0)) await dbDelete("evaluation_runs", runId);
    for (const studyId of createdStudyIds.splice(0)) {
      await dbDelete("analyses", "anl_" + studyId);
      await dbDelete("studies", studyId);
    }
  });

  it("requires authentication and permits ADMIN/RESEARCHER only", async () => {
    const route = await import("@/app/api/validation/dashboard/route");
    expect((await route.GET(request("http://localhost:3000/api/validation/dashboard"))).status).toBe(401);

    const clinician = await createSession({ user_id: "validation-clinician", username: "validation-clinician", role: "CLINICIAN" });
    expect((await route.GET(request("http://localhost:3000/api/validation/dashboard", clinician.token))).status).toBe(403);

    const researcher = await createSession({ user_id: "validation-researcher", username: "validation-researcher", role: "RESEARCHER" });
    expect((await route.GET(request("http://localhost:3000/api/validation/dashboard", researcher.token))).status).toBe(200);
  });

  it("projects evaluation output to aggregates and withholds case IDs, dataset refs, notes, and free text", async () => {
    const run = await createEvaluationRun({
      model_id: "research-model",
      model_version: "v1",
      dataset_ref: "patient-Jane-Doe-dataset",
      split: "locked_test",
      notes: "Jane Doe clinical note must not be reflected",
      modality: "patient-device-and-location",
      cases: [
        { case_id: "patient-Jane-Doe-001", y_true: 1, y_pred: 0, score: 0.1, subgroup: "Jane Doe", symptom_category: "private symptom", urgent_presentation: true, quality_failed: true },
        { case_id: "synthetic-safe-002", y_true: 0, y_pred: 1, score: 0.9, subgroup: "device-A" },
      ],
    });
    createdRunIds.push(run.run_id);

    const safe = safeValidationRun((await getEvaluationRun(run.run_id))!);
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain("Jane Doe");
    expect(serialized).not.toContain("patient-");
    expect(serialized).not.toContain("private symptom");
    expect(serialized).not.toContain("dataset");
    expect(safe.errors).toEqual(expect.objectContaining({ false_negatives: 1, false_positives: 1, missed_urgent_cases: 1, quality_blocked: 1 }));

    const researcher = await createSession({ user_id: "validation-researcher-2", username: "validation-researcher-2", role: "RESEARCHER" });
    const route = await import("@/app/api/evaluations/route");
    const response = await route.GET(request("http://localhost:3000/api/evaluations", researcher.token));
    expect(response.status).toBe(200);
    const body = await response.json();
    const apiRun = body.runs.find((entry: { run_id: string }) => entry.run_id === run.run_id);
    expect(apiRun).toBeDefined();
    expect(JSON.stringify(apiRun)).not.toContain("patient-Jane-Doe");
    expect(apiRun.failure_analysis).toBeUndefined();
    expect(apiRun.dataset_ref).toBeUndefined();
    expect(apiRun.notes).toBeUndefined();
    expect(apiRun.errors.missed_urgent_cases).toBe(1);
  });

  it("keeps the validation page visibly aggregate-only", async () => {
    const fs = await import("fs/promises");
    const source = await fs.readFile(new URL("../app/validation/page.tsx", import.meta.url), "utf8");
    expect(source).toContain("/api/validation/dashboard");
    expect(source).toContain("Aggregate-only privacy boundary");
    expect(source).toContain("No case identifiers shown");
    expect(source).not.toContain("case_id");
    expect(source).not.toContain("dataset_ref");
  });

  it("keeps model failure, unsupported input, and quality blocks distinct in study status", async () => {
    const suffix = String(Date.now());
    const rows = [
      { id: "validation-failed-" + suffix, status: "analyzed", mode: "MODEL_FAILED", ledger: [{ execution_status: "FAILED" }] },
      { id: "validation-unsupported-" + suffix, status: "rejected", mode: "NO_MODEL_EXECUTED", ledger: [{ execution_status: "UNSUPPORTED_MODALITY" }] },
      { id: "validation-quality-" + suffix, status: "rejected", mode: "NO_MODEL_EXECUTED", ledger: [{ execution_status: "BLOCKED_QUALITY" }] },
    ] as const;
    for (const fixture of rows) {
      createdStudyIds.push(fixture.id);
      await dbPut("studies", fixture.id, {
        study_id: fixture.id, created_at: new Date().toISOString(), modality: "fundus", eye: "OD",
        source: "file_upload", metadata: {}, files: [], status: fixture.status, original_sha256: "fixture",
      });
      await dbPut("analyses", "anl_" + fixture.id, {
        analysis_id: "anl_" + fixture.id, study_id: fixture.id, created_at: new Date().toISOString(),
        result: {
          analysis_mode: fixture.mode, model_execution_ledger: fixture.ledger,
          recommendation: { priority: "routine_follow_up" }, findings: [], possible_conditions: { conditions: [] },
          diagnosis_gate: { allowed: false },
        },
      });
    }
    const result = await listStudiesWithStatus();
    expect(result.find((row) => row.study_id === rows[0].id)?.dashboard_status).toBe("MODEL_FAILED");
    expect(result.find((row) => row.study_id === rows[1].id)?.dashboard_status).toBe("UNSUPPORTED_MODALITY");
    expect(result.find((row) => row.study_id === rows[2].id)?.dashboard_status).toBe("IMAGE_NOT_SUITABLE");
  });
});
