import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createStudy, analyzeStudy, deleteStudy } from "@/lib/studies/service";
import { dbDelete, dbGet, dbPut } from "@/lib/storage/db";
import { replayLegacyReport, LEGACY_REPLAY_NOT_POSSIBLE } from "@/lib/reports/replay";
import type { ClinicalReport } from "@/lib/reports/generator";
import type { DeviceMetadata } from "@/lib/devices/adapter";

const created: string[] = [];
const replayRows: string[] = [];
afterAll(async () => {
  for (const id of replayRows) await dbDelete("reports", id).catch(() => {});
  for (const id of created) await deleteStudy(id).catch(() => {});
});

describe("explicit legacy report replay", () => {
  it("creates a new sealed report and reasoning record without mutating the legacy source", async () => {
    const bytes = await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 30, g: 20, b: 10 } } }).png().toBuffer();
    const meta: DeviceMetadata = { scanType: "fundus", eye: "OD", providedBy: "user" };
    const study = await createStudy("legacy-replay.png", "image/png", bytes, meta);
    created.push(study.study_id);
    const generated = await analyzeStudy(study.study_id);
    const legacy = { ...generated.report } as Omit<ClinicalReport, "version_freeze"> & {
      version_freeze?: ClinicalReport["version_freeze"];
    };
    delete legacy.version_freeze;
    delete legacy.reasoning_snapshot;
    await dbPut("reports", legacy.report_id, legacy);

    const result = await replayLegacyReport(legacy.report_id, "synthetic-replay-operator");
    replayRows.push(result.new_report_id);
    expect(result.new_report_id).not.toBe(legacy.report_id);
    expect(result.report.source_legacy_report_id).toBe(legacy.report_id);
    expect(result.report.supersedes_report_id).toBe(legacy.report_id);
    expect(result.report.reasoning_snapshot?.reasoning_record_id).toBe(result.reasoning_record_id);
    expect(result.report.version_freeze?.source_analysis_sha256).toBe(result.source_analysis_sha256);
    const original = await dbGet<ClinicalReport>("reports", legacy.report_id);
    expect(original?.version_freeze).toBeUndefined();
    expect(original?.reasoning_snapshot).toBeUndefined();
  }, 60_000);

  it("fails closed with LEGACY_REPLAY_NOT_POSSIBLE when the source analysis is absent", async () => {
    const legacy = { report_id: "rep_missing-replay", study_id: "study_missing-replay", generated_at: new Date().toISOString(), report_version: "legacy", validation_banner: "legacy", demo_label: "legacy", patient: {}, study: { study_id: "study_missing-replay", modality: "unknown", eye: "unknown", source: "test", metadata_provenance: "none" }, analysis_mode: "NO_MODEL_EXECUTED", model_execution: { models_attempted: [], models_executed: [], models_failed: [], models_skipped: [], artifact_hashes: {}, model_versions: {}, runtime_status: "none" }, image_quality: { score: 0, acceptable: false, status: "unknown", artifacts: [], affected_regions: [], recommended_reacquisition: false }, overall_result: "legacy", findings: [], possible_associations_note: "legacy", uncertainty: { overall: 1, reasons: [] }, measurements_note: "legacy", limitations: [], recommended_next_step: "legacy", triage_priority: "routine_follow_up", coverage_snapshot: { registry_version: "legacy", production_targets: [], general_detector_state: "MODEL_UNAVAILABLE", candidate_targets_not_run: [], unsupported_targets: [], notice: "legacy" }, review: { status: "ai_only" }, provenance: { models: [], ruleset_version: "legacy", analyzed_at: new Date().toISOString(), input_dimensions: { width: 1, height: 1 }, pipeline_version: "legacy" }, safety: { quality_gate_enforced: false, disclaimers: [], blocked_claims: [] }, exports: { fhir_note: "legacy" } } as unknown as ClinicalReport;
    await dbPut("reports", legacy.report_id, legacy);
    await expect(replayLegacyReport(legacy.report_id, "operator")).rejects.toMatchObject({ code: LEGACY_REPLAY_NOT_POSSIBLE });
    await dbDelete("reports", legacy.report_id);
  });
});
