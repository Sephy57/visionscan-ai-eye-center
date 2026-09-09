import { afterEach, describe, expect, it } from "vitest";
import { dbDelete, dbGet, dbPut } from "@/lib/storage/db";
import { putDocument } from "@/lib/documents/repository";

const ids = { patient: "rel-patient-a", study: "rel-study-a", doc: "rel-doc-a" };

afterEach(async () => {
  await dbDelete("documents", ids.doc);
  await dbDelete("studies", ids.study);
  await dbDelete("patients", ids.patient);
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
});

