import { afterEach, describe, expect, it } from "vitest";
import { dbDelete, dbGet, dbPut } from "@/lib/storage/db";
import { putDocument } from "@/lib/documents/repository";

const ids = {
  patient: "rel-patient-a", study: "rel-study-a", doc: "rel-doc-a",
  foreignPatient: "rel-patient-b", foreignStudy: "rel-study-b", foreignAnalysis: "rel-analysis-b", foreignReport: "rel-report-b",
  badStudy: "rel-bad-study", badDocument: "rel-bad-document", badAnalysis: "rel-bad-analysis", badReport: "rel-bad-report", badJob: "rel-bad-job", badReview: "rel-bad-review",
};

afterEach(async () => {
  for (const [collection, id] of [
    ["documents", ids.doc], ["studies", ids.study], ["patients", ids.patient], ["patients", ids.foreignPatient], ["studies", ids.foreignStudy],
    ["analyses", ids.foreignAnalysis], ["reports", ids.foreignReport], ["studies", ids.badStudy], ["documents", ids.badDocument], ["analyses", ids.badAnalysis],
    ["reports", ids.badReport], ["jobs", ids.badJob], ["clinician_reviews", ids.badReview],
  ] as const) await dbDelete(collection, id);
});

describe("explicit relational metadata and tenant boundaries", () => {
  it("rejects a cross-tenant typed study reference before persistence", async () => {
    await dbPut("patients", ids.patient, { patient_id: ids.patient, patient_ref: "SYNTH-REL-A", tenant_id: "tenant-a", created_at: new Date().toISOString() });
    await expect(dbPut("studies", ids.study, { study_id: ids.study, patient_id: ids.patient, tenant_id: "tenant-b", created_at: new Date().toISOString() })).rejects.toThrow("CROSS_TENANT_REFERENCE");
    expect(await dbGet("studies", ids.study)).toBeNull();
  });

  it("stores an explicit same-tenant link and refuses an unknown document study", async () => {
    await dbPut("patients", ids.patient, { patient_id: ids.patient, patient_ref: "SYNTH-REL-A", tenant_id: "tenant-a", created_at: new Date().toISOString() });
    await dbPut("studies", ids.study, { study_id: ids.study, patient_id: ids.patient, tenant_id: "tenant-a", created_at: new Date().toISOString() });
    await expect(putDocument({
      document_id: ids.doc, study_id: "missing-study", filename_display: "synthetic.pdf", mime_type: "application/pdf",
      size_bytes: 1, sha256: "0".repeat(64), page_count: 0, status: "REJECTED", document_type: "UNKNOWN", storage_path: "",
      uploaded_by: "test", uploaded_at: new Date().toISOString(), parser_version: "test", validation: { outcome: "REJECTED", validated_at: new Date().toISOString() }, warnings: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })).rejects.toThrow("MISSING_TYPED_REFERENCE");
    expect(await dbGet("documents", ids.doc)).toBeNull();
  });

  it("keeps lifecycle metadata inspectable without rewriting payload history", async () => {
    const at = new Date().toISOString();
    await dbPut("patients", ids.patient, { patient_id: ids.patient, patient_ref: "SYNTH-REL-A", tenant_id: "tenant-a", lifecycle: "ARCHIVED", created_at: at });
    const stored = await dbGet<Record<string, unknown>>("patients", ids.patient);
    expect(stored).toMatchObject({ patient_id: ids.patient, tenant_id: "tenant-a", lifecycle: "ARCHIVED" });
  });

  it("rejects every required cross-tenant typed relationship atomically", async () => {
    const at = new Date().toISOString();
    await dbPut("patients", ids.foreignPatient, { patient_id: ids.foreignPatient, patient_ref: "SYNTH-REL-B", tenant_id: "tenant-b", created_at: at });
    await dbPut("studies", ids.foreignStudy, { study_id: ids.foreignStudy, patient_id: ids.foreignPatient, tenant_id: "tenant-b", created_at: at });
    await dbPut("analyses", ids.foreignAnalysis, { analysis_id: ids.foreignAnalysis, study_id: ids.foreignStudy, tenant_id: "tenant-b", created_at: at });
    await dbPut("reports", ids.foreignReport, { report_id: ids.foreignReport, analysis_id: ids.foreignAnalysis, study_id: ids.foreignStudy, tenant_id: "tenant-b", created_at: at });
    const attempts: Array<[string, string, Record<string, unknown>]> = [
      ["studies", ids.badStudy, { study_id: ids.badStudy, patient_id: ids.foreignPatient, tenant_id: "tenant-a", created_at: at }],
      ["documents", ids.badDocument, { document_id: ids.badDocument, study_id: ids.foreignStudy, tenant_id: "tenant-a", created_at: at }],
      ["analyses", ids.badAnalysis, { analysis_id: ids.badAnalysis, study_id: ids.foreignStudy, tenant_id: "tenant-a", created_at: at }],
      ["reports", ids.badReport, { report_id: ids.badReport, analysis_id: ids.foreignAnalysis, study_id: ids.foreignStudy, tenant_id: "tenant-a", created_at: at }],
      ["jobs", ids.badJob, { job_id: ids.badJob, study_id: ids.foreignStudy, tenant_id: "tenant-a", created_at: at }],
      ["clinician_reviews", ids.badReview, { review_id: ids.badReview, report_id: ids.foreignReport, tenant_id: "tenant-a", created_at: at }],
    ];
    for (const [collection, id, payload] of attempts) {
      await expect(dbPut(collection as Parameters<typeof dbPut>[0], id, payload)).rejects.toThrow("CROSS_TENANT_REFERENCE");
      expect(await dbGet(collection as Parameters<typeof dbGet>[0], id)).toBeNull();
    }
  });
});
