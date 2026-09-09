import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import { dbDelete, dbGet, dbPut } from "@/lib/storage/db";
import { UPLOAD_ROOT, REPORT_ROOT } from "@/lib/config";
import { prepareRecoveryJournal, recoverPendingReconciliations, scanReconciliation } from "@/lib/storage/reconciliation";
import { sha256 } from "@/lib/storage/files";

const studyId = "reconcile-study";

afterEach(async () => {
  await dbDelete("studies", studyId);
  await dbDelete("reports", "reconcile-report");
  await dbDelete("reconciliation_journal", "reconcile-journal");
  await fs.rm(`${UPLOAD_ROOT}/${studyId}`, { recursive: true, force: true });
  await fs.rm(`${REPORT_ROOT}/reconcile-report.json`, { force: true });
  await fs.rm(`${UPLOAD_ROOT}/orphan.bin`, { force: true });
});

describe("file/database recovery journal and orphan scanner", () => {
  it("marks an incomplete multi-resource operation for explicit reconciliation on restart", async () => {
    const journal = await prepareRecoveryJournal({ operation: "test-write", resources: [{ kind: "study", id: studyId }] });
    expect(journal.state).toBe("PREPARED");
    const recovered = await recoverPendingReconciliations();
    expect(recovered.map((entry) => entry.journal_id)).toContain(journal.journal_id);
    expect((await dbGet<{ state: string }>("reconciliation_journal", journal.journal_id))?.state).toBe("FAILED_RECONCILIATION");
  });

  it("produces a non-destructive plan for missing exports, hash mismatches, and orphan files", async () => {
    const bytes = Buffer.from("immutable synthetic bytes");
    const relativePath = `${studyId}/original.bin`;
    await fs.mkdir(`${UPLOAD_ROOT}/${studyId}`, { recursive: true });
    await fs.writeFile(`${UPLOAD_ROOT}/${relativePath}`, bytes);
    await fs.writeFile(`${UPLOAD_ROOT}/orphan.bin`, Buffer.from("orphan"));
    await dbPut("studies", studyId, { study_id: studyId, files: [{ relativePath, sha256: sha256(Buffer.from("different")) }], created_at: new Date().toISOString() });
    await dbPut("reports", "reconcile-report", { report_id: "reconcile-report", study_id: studyId, generated_at: new Date().toISOString() });
    const plan = await scanReconciliation();
    expect(plan.auto_repair).toBe(false);
    expect(plan.issues.some((issue) => issue.kind === "HASH_MISMATCH")).toBe(true);
    expect(plan.issues.some((issue) => issue.kind === "FILE_WITHOUT_DB_ROW")).toBe(true);
    expect(plan.issues.some((issue) => issue.kind === "MISSING_REPORT_EXPORT")).toBe(true);
  });
});

