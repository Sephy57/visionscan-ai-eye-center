import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  candidateManifestFromBaseline,
  compareDrCompetitionResults,
  freezeRunManifest,
  measuredResultFromCases,
  validateRunManifest,
  validateRunResult,
  type CompetitionEvidenceRef,
  type DrCompetitionModelRef,
} from "@/lib/models/competitionContract";
import { CANDIDATE_MODEL_DOSSIERS } from "@/lib/models/candidateDossiers";
import { CandidateOnlyModelError, CandidateOnlyProvider } from "@/lib/models/candidateProvider";
import { getProviderForModel } from "@/lib/models/provider";
import { getModel } from "@/lib/models/registry";
import { requestStatusTransition } from "@/lib/models/transitions";
import { validateValidationCaseManifest } from "@/lib/validation/casePackage";
import { validateModelErrorRecord } from "@/lib/validation/modelErrorRegistry";
import { createSession, SESSION_COOKIE } from "@/lib/auth/sessions";
import { dbDelete, dbGet, dbPut } from "@/lib/storage/db";
import { makeJobProgress } from "@/lib/jobs/control";
import {
  claimJob,
  finalizeJobFailure,
  finalizeJobSuccess,
  heartbeatJob,
  type AnalysisJob,
} from "@/lib/jobs/queue";
import { createModelJobResourceGovernor } from "@/lib/runtime";
import { validationEntryForModel } from "@/lib/models/validationRegistry";
import * as validationErrorsRoute from "@/app/api/validation/errors/route";
import * as validationRegistryRoute from "@/app/api/models/validation/route";

const syntheticEvidence: CompetitionEvidenceRef[] = [
  {
    id: "synthetic-phase5-result-source",
    path: "synthetic-fixtures/phase5-competition-result.json",
    sha256: "a".repeat(64),
    role: "result_source",
  },
];

const baselineModel: DrCompetitionModelRef = {
  role: "BASELINE",
  model_id: "synthetic-baseline",
  model_version: "v1",
  artifact_path: "synthetic-fixtures/baseline.safetensors",
  artifact_sha256: "b".repeat(64),
  artifact_format: "safetensors",
};

const competitionCases = [
  { case_id: "synthetic-case-001", ground_truth_grade: 0 as const, predicted_grade: 0 as const, model_score: 0.1 },
  { case_id: "synthetic-case-002", ground_truth_grade: 2 as const, predicted_grade: 2 as const, model_score: 0.9 },
];

function competitionManifest(model: DrCompetitionModelRef, manifestId: string) {
  return freezeRunManifest({
    format: "visionscan-dr-competition-run-manifest/v1",
    manifest_id: manifestId,
    state: "FROZEN",
    frozen_at: "2026-09-13T00:00:00.000Z",
    task: {
      target: "ICDR_DR_GRADE",
      modality: "FUNDUS",
      label_space: ["0", "1", "2", "3", "4"],
      referable_threshold_grade: 2,
      grade_rule: "ROUND_CLAMP_0_4",
      score_semantics: "MODEL_SCORE_NOT_CALIBRATED",
      calibration: "NOT_MEASURED",
    },
    dataset: {
      name: "Synthetic fundus validation fixture",
      version: "phase5-v1",
      split: "regular-fundus-validation",
      case_count: competitionCases.length,
      patient_count: 2,
      patient_separation: "PATIENT_SEPARATED_CONFIRMED",
      case_id_source_fields: ["patient_id", "image"],
      result_case_id_policy: "SOURCE_KEYS_MUST_BE_HASHED_OR_STABLE_NON_PHI_IDS",
    },
    preprocessing: {
      version: "clementp-dr-source-pinned-512-v1",
      implementation_path: "synthetic-fixtures/preprocessing.ts",
      input_shape: "3x512x512",
      decode: "CV2_IMREAD_COLOR_BGR",
      crop: "CHANNEL_0_THRESHOLD_10_AUTOCROP_DEGENERATE_WHOLE_IMAGE",
      resize: "LONGEST_SIDE_512_INTER_LINEAR",
      pad: "CENTERED_ZERO_PAD_TO_512_SQUARE",
      scale: "DIVIDE_BY_255",
      normalization: "IMAGENET_MEAN_STD_IN_SAME_CHANNEL_ORDER",
      tensor_layout: "HWC_TO_CHW_FLOAT32",
      caveats: ["Synthetic fixture only."],
    },
    protocol: {
      ground_truth_field: "eye_grade",
      prediction_field: "dr_grade",
      score_field: "dr_logit",
      referable_truth_rule: "GROUND_TRUTH_GRADE_GE_2",
      referable_prediction_rule: "PREDICTED_GRADE_GE_2",
      row_policy: "ALL_ROWS_IN_DECLARED_SPLIT_NO_ADDITIONAL_FILTER",
      score_metrics_policy: "REQUIRE_FINITE_SCORE_ON_EVERY_ROW_OR_REPORT_UNMEASURED",
    },
    model,
    evidence: syntheticEvidence,
    limitations: ["Synthetic fixture only; no clinical validation is claimed."],
  });
}

function routeFilesUnder(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...routeFilesUnder(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function queueFixture(jobId: string): AnalysisJob {
  return {
    job_id: jobId,
    study_id: `synthetic-study-${jobId}`,
    kind: "analysis",
    status: "queued",
    state: "queued",
    attempts: 0,
    retry_count: 0,
    version: 0,
    claim_version: 0,
    cancellation_requested: false,
    retry_policy_version: "lease-retry-v1",
    created_at: "2026-09-13T00:00:00.000Z",
    progress: makeJobProgress({ stage: "queued", percent: 0, message: "synthetic queue fixture" }),
  };
}

const createdJobIds: string[] = [];
const createdStudyIds: string[] = [];

afterEach(async () => {
  for (const jobId of createdJobIds.splice(0)) await dbDelete("jobs", jobId);
  for (const studyId of createdStudyIds.splice(0)) await dbDelete("studies", studyId);
});

async function seedQueueFixture(jobId: string): Promise<void> {
  const job = queueFixture(jobId);
  await dbPut("studies", job.study_id, {
    study_id: job.study_id,
    created_at: job.created_at,
    modality: "fundus",
    eye: "OD",
    source: "synthetic-test",
    metadata: {},
    files: [],
    status: "uploaded",
    original_sha256: "synthetic-fixture",
  });
  await dbPut("jobs", job.job_id, job);
  createdStudyIds.push(job.study_id);
  createdJobIds.push(job.job_id);
}

const safeValidationManifest = {
  schema_version: "visionscan-validation-case-v1",
  package_id: "phase5-security-fixtures",
  data_classification: "SYNTHETIC_ONLY",
  cases: [
    {
      case_id: "synthetic-phase5-001",
      fixture_ref: "synthetic-fixtures/phase5-001",
      assertions: [{ kind: "model", assertion_id: "model-status", match: { validation_status: "RESEARCH_ONLY" } }],
    },
  ],
} as const;

const safeModelError = {
  schema_version: "visionscan-model-error-v1",
  error_id: "model-error-phase5-001",
  case_id: "synthetic-phase5-001",
  model_id: "research-model",
  model_version: "v1",
  category: "MODEL_TIMEOUT",
  target_id: "inference",
  status: "OPEN",
  lifecycle: "UNREVIEWED",
  observed_at: "2026-09-13T00:00:00.000Z",
  assertion_ids: ["synthetic-timeout"],
  adjudication: null,
  remediation: null,
} as const;

describe("Phase 5 competition result and lineage boundary", () => {
  it("records the explicit unavailable contract when no competition HTTP API exists", () => {
    const apiRoot = path.resolve(process.cwd(), "app", "api");
    const competitionRoutes = routeFilesUnder(apiRoot)
      .filter((file) => path.basename(file).startsWith("route."))
      .filter((file) => path.relative(apiRoot, file).toLowerCase().includes("competition"));
    expect(competitionRoutes).toEqual([]);
  });

  it("rejects tampered manifest, result, and result-lineage content at the available immutable contract seam", () => {
    const baseline = competitionManifest(baselineModel, "synthetic-baseline-manifest");
    const candidate = candidateManifestFromBaseline(
      baseline,
      {
        model_id: "synthetic-candidate",
        model_version: "v2",
        artifact_path: "synthetic-fixtures/candidate.safetensors",
        artifact_sha256: "c".repeat(64),
        artifact_format: "safetensors",
      },
      "synthetic-candidate-manifest",
      "2026-09-13T00:00:00.000Z",
    );
    const baselineResult = measuredResultFromCases({
      manifest: baseline,
      result_id: "synthetic-baseline-result",
      cases: competitionCases,
      evidence: syntheticEvidence,
    });
    const candidateResult = measuredResultFromCases({
      manifest: candidate,
      result_id: "synthetic-candidate-result",
      cases: competitionCases,
      evidence: syntheticEvidence,
    });

    const tamperedManifest = { ...baseline, dataset: { ...baseline.dataset, version: "attacker-edited" } };
    expect(validateRunManifest(tamperedManifest).valid).toBe(false);
    expect(validateRunManifest(tamperedManifest).errors).toContain("manifest_sha256 does not match canonical manifest content");

    const tamperedResult = {
      ...candidateResult,
      metrics: candidateResult.metrics
        ? { ...candidateResult.metrics, referable: { ...candidateResult.metrics.referable, sensitivity: 0 } }
        : null,
    };
    expect(validateRunResult(tamperedResult).valid).toBe(false);
    expect(validateRunResult(tamperedResult).errors).toContain("result_sha256 does not match canonical result content");

    const tamperedLineage = { ...candidateResult, manifest_sha256: "d".repeat(64) };
    expect(validateRunResult(tamperedLineage).valid).toBe(false);
    const comparison = compareDrCompetitionResults(baselineResult, tamperedResult);
    expect(comparison.status).toBe("BLOCKED");
    expect(comparison.reasons.join(" ")).toContain("Candidate result invalid");
  });
});

describe("Phase 5 candidate-only promotion boundary", () => {
  it("keeps every researched candidate outside the live registry and rejects promotion by candidate id", async () => {
    expect(CANDIDATE_MODEL_DOSSIERS.length).toBeGreaterThan(0);
    for (const dossier of CANDIDATE_MODEL_DOSSIERS) {
      expect(dossier.status).toBe("CANDIDATE_ONLY");
      expect(getModel(dossier.candidate_id)).toBeNull();
      expect(getProviderForModel(dossier.candidate_id)).toBeNull();
      await expect(requestStatusTransition({
        model_id: dossier.candidate_id,
        to_status: "RESEARCH",
        evidence_refs: [],
        requested_by: "synthetic-admin",
      })).rejects.toThrow(/Unknown model/);
    }
  });

  it("fails closed through the candidate provider even when a caller tries to load or analyze it", async () => {
    const provider = new CandidateOnlyProvider(CANDIDATE_MODEL_DOSSIERS[0].candidate_id);
    const validation = await provider.validateModel();
    expect(validation.trusted).toBe(false);
    expect(validation.gate.allowed).toBe(false);
    expect(validation.gate.reasons.join(" ")).toContain("CANDIDATE_ONLY");
    expect(await provider.getModelMetadata()).toBeNull();
    await expect(provider.loadModel()).rejects.toBeInstanceOf(CandidateOnlyModelError);
    await expect(provider.analyzeStudy({} as never, {} as never)).rejects.toBeInstanceOf(CandidateOnlyModelError);
  });
});

describe("Phase 5 validation artifact privacy boundary", () => {
  it("rejects PHI-shaped fields and identifiers from synthetic validation packages and model-error records", () => {
    const packageWithPatientField = {
      ...safeValidationManifest,
      cases: [{ ...safeValidationManifest.cases[0], patient_id: "synthetic-placeholder" }],
    };
    const packageWithClinicalCaption = {
      ...safeValidationManifest,
      cases: [{ ...safeValidationManifest.cases[0], description: "patient: synthetic placeholder" }],
    };
    expect(validateValidationCaseManifest(packageWithPatientField).valid).toBe(false);
    expect(validateValidationCaseManifest(packageWithPatientField).errors.join(" ")).toContain("unknown field");
    expect(validateValidationCaseManifest(packageWithClinicalCaption).valid).toBe(false);

    const errorWithRawOutput = { ...safeModelError, raw_model_output: "synthetic placeholder" };
    const errorWithPatientId = { ...safeModelError, patient_id: "synthetic-placeholder" };
    expect(validateModelErrorRecord(errorWithRawOutput).valid).toBe(false);
    expect(validateModelErrorRecord(errorWithPatientId).valid).toBe(false);
    expect(validateModelErrorRecord({ ...safeModelError, case_id: "patient-case-001" }).valid).toBe(false);
  });

  it("rejects a PHI-shaped model-error POST before persistence", async () => {
    const session = await createSession({ user_id: "phase5-researcher", username: "phase5-researcher", role: "RESEARCHER" });
    const request = new NextRequest("http://localhost:3000/api/validation/errors", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE}=${session.token}`,
        "x-csrf-token": session.csrf,
      },
      body: JSON.stringify({ ...safeModelError, clinical_note: "synthetic placeholder" }),
    });
    const response = await validationErrorsRoute.POST(request);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid synthetic model error record");
  });
});

describe("Phase 5 queue worker identity and ownership fencing", () => {
  it("rejects mismatched worker and attempt tokens for heartbeats and terminal publication", async () => {
    const jobId = "phase5-worker-fence";
    await seedQueueFixture(jobId);
    const claimed = await claimJob(jobId, "worker-alpha", { now: "2026-09-13T00:00:01.000Z", leaseMs: 10_000 });
    expect(claimed?.status).toBe("running");
    const attemptId = claimed!.attempt_id!;

    expect(await heartbeatJob(jobId, attemptId, "worker-forged", { now: "2026-09-13T00:00:02.000Z", leaseMs: 10_000 })).toBeNull();
    expect(await heartbeatJob(jobId, "attempt-forged", "worker-alpha", { now: "2026-09-13T00:00:02.000Z", leaseMs: 10_000 })).toBeNull();
    expect(await finalizeJobSuccess(jobId, attemptId, "worker-forged")).toBeNull();
    expect(await finalizeJobFailure(jobId, "attempt-forged", "worker-alpha", "synthetic late error")).toBeNull();
    expect((await dbGet<AnalysisJob>("jobs", jobId))?.status).toBe("running");

    expect((await finalizeJobSuccess(jobId, attemptId, "worker-alpha"))?.status).toBe("completed");
  });
});

describe("Phase 5 resource-governor token tampering", () => {
  it("does not release a reservation when its opaque token fields are forged", () => {
    const governor = createModelJobResourceGovernor({ memoryBytes: 100, threads: 4 });
    const admitted = governor.reserve({ memoryBytes: 40, threads: 2 });
    expect(admitted.admitted).toBe(true);
    if (!admitted.admitted) return;
    const before = governor.snapshot();

    expect(governor.release({ ...admitted.reservation, memoryBytes: 41 })).toMatchObject({ released: false });
    expect(governor.release({ ...admitted.reservation, reservationId: "reservation-999" })).toMatchObject({ released: false });
    expect(governor.snapshot()).toEqual(before);
    expect(governor.release(admitted.reservation).released).toBe(true);
    expect(governor.snapshot().activeReservations).toBe(0);
  });
});

describe("Phase 5 validation UI state boundary", () => {
  it("keeps validation evidence read-only and does not let forged UI data change model state", async () => {
    const session = await createSession({ user_id: "phase5-admin", username: "phase5-admin", role: "ADMIN" });
    const response = await validationRegistryRoute.GET(new NextRequest("http://localhost:3000/api/models/validation", {
      headers: { cookie: `${SESSION_COOKIE}=${session.token}` },
    }));
    expect(response.status).toBe(200);
    expect(Object.keys(validationRegistryRoute)).toContain("GET");
    expect(Object.keys(validationRegistryRoute)).not.toContain("POST");
    expect(Object.keys(validationRegistryRoute)).not.toContain("PUT");
    expect(Object.keys(validationRegistryRoute)).not.toContain("PATCH");
    expect(Object.keys(validationRegistryRoute)).not.toContain("DELETE");

    const body = await response.json() as { entries: Array<{ model_id: string; status: string }> };
    const drModel = getModel("fundus-dr-grading-effb0")!;
    const statusBefore = drModel.status;
    const forgedUiState = {
      ...body,
      entries: body.entries.map((entry) => entry.model_id === drModel.model_id
        ? { ...entry, status: "CLINICALLY_VALIDATED" }
        : entry),
    };
    expect(forgedUiState.entries.find((entry) => entry.model_id === drModel.model_id)?.status).toBe("CLINICALLY_VALIDATED");
    expect(getModel(drModel.model_id)?.status).toBe(statusBefore);
    expect(validationEntryForModel(drModel.model_id)?.status).toBe("RESEARCH");

    const clientSource = fs.readFileSync(path.resolve(process.cwd(), "app", "validation-center", "ValidationCenterClient.tsx"), "utf8");
    expect(clientSource).toContain('fetch(path, { cache: "no-store" })');
    expect(clientSource).not.toMatch(/method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    expect(clientSource).not.toContain("/transitions");
  });
});
