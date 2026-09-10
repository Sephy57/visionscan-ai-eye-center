import { afterEach, describe, expect, it } from "vitest";
import { dbDelete, dbGet, dbPut } from "@/lib/storage/db";
import { analyzeStudy } from "@/lib/studies/service";

const ids = {
  study: "future-integrity-study",
  document: "future-integrity-document",
  analysis: "future-integrity-analysis",
  job: "future-integrity-job",
};

afterEach(async () => {
  for (const [collection, id] of [
    ["jobs", ids.job],
    ["analyses", ids.analysis],
    ["documents", ids.document],
    ["studies", ids.study],
  ] as const) await dbDelete(collection, id);
});
describe("future-write relationship invariants", () => {
  it("rejects a new document, analysis, or job whose study is missing", async () => {
    await expect(dbPut("documents", ids.document, {
      document_id: ids.document,
      study_id: "missing-study-for-document",
    })).rejects.toThrow("MISSING_TYPED_REFERENCE");
    await expect(dbPut("analyses", ids.analysis, {
      analysis_id: ids.analysis,
      study_id: "missing-study-for-analysis",
    })).rejects.toThrow("MISSING_TYPED_REFERENCE");
    await expect(dbPut("jobs", ids.job, {
      job_id: ids.job,
      study_id: "missing-study-for-job",
    })).rejects.toThrow("MISSING_TYPED_REFERENCE");

    expect(await dbGet("documents", ids.document)).toBeNull();
    expect(await dbGet("analyses", ids.analysis)).toBeNull();
    expect(await dbGet("jobs", ids.job)).toBeNull();
  });

  it("fails closed before replay when an active study source is unavailable", async () => {
    await dbPut("studies", ids.study, {
      study_id: ids.study,
      created_at: new Date().toISOString(),
      modality: "fundus",
      eye: "OD",
      source: "file_upload",
      metadata: {},
      files: [{ relativePath: `${ids.study}/original.png`, sha256: "a".repeat(64) }],
      status: "analyzed",
      original_sha256: "a".repeat(64),
    });

    await expect(analyzeStudy(ids.study)).rejects.toThrow("SOURCE_PERMANENTLY_UNAVAILABLE");
  });
});
