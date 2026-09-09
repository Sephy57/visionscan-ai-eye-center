import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase, dbAll, dbCount, dbPage, dbTransaction } from "@/lib/storage/db";

describe("bounded keyset pagination and large collection behavior", () => {
  it("walks a 5,000-row collection without duplicates or OFFSET", async () => {
    const total = 5_000;
    await dbTransaction((tx) => {
      for (let index = 0; index < total; index += 1) {
        const id = `scale-study-${String(index).padStart(5, "0")}`;
        tx.put("studies", id, { study_id: id, created_at: "2026-09-10T00:00:00.000Z", status: "uploaded" });
      }
    });
    expect(await dbCount("studies")).toBe(total);

    const seen = new Set<string>();
    const first = await dbPage<{ study_id: string }>("studies", { limit: 37 });
    expect(first.items).toHaveLength(37);
    expect(first.limit).toBe(37);
    expect(first.has_more).toBe(true);
    let page = first;
    let pages = 1;
    while (page.has_more) {
      page.items.forEach((row) => seen.add(row.study_id));
      expect(page.items.length).toBeLessThanOrEqual(37);
      if (!page.next_cursor) throw new Error("page reported has_more without a cursor");
      page = await dbPage<{ study_id: string }>("studies", { limit: 37, cursor: page.next_cursor });
      pages += 1;
      if (pages > 200) throw new Error("pagination did not converge");
    }
    page.items.forEach((row) => seen.add(row.study_id));
    expect(seen).toHaveLength(total);
    expect(pages).toBe(Math.ceil(total / 37));
    expect(page.next_cursor).toBeNull();
  });

  it("keeps filtered pages complete while bounding the response", async () => {
    const total = 503;
    await dbTransaction((tx) => {
      for (let index = 0; index < total; index += 1) {
        const id = `scale-job-${String(index).padStart(4, "0")}`;
        tx.put("jobs", id, { job_id: id, status: index % 7 === 0 ? "failed" : "completed", attempts: 1, created_at: "2026-09-10T00:00:00.000Z" });
      }
    });
    const expected = new Set(Array.from({ length: total }, (_, index) => index % 7 === 0 ? `scale-job-${String(index).padStart(4, "0")}` : null).filter(Boolean));
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const page = await dbPage<{ job_id: string; status: string }>("jobs", {
        limit: 19,
        cursor,
        predicate: (job) => job.status === "failed",
        max_scan: total + 1,
      });
      expect(page.items.length).toBeLessThanOrEqual(19);
      page.items.forEach((job) => seen.add(job.job_id));
      if (!page.has_more) {
        expect(page.next_cursor).toBeNull();
        break;
      }
      cursor = page.next_cursor ?? undefined;
      if (!cursor) throw new Error("filtered page reported has_more without a cursor");
    }
    expect(seen).toEqual(expected);
  });

  it("rejects forged cursors and clamps oversized pages", async () => {
    await expect(dbPage("studies", { cursor: "not-a-cursor" })).rejects.toThrow("Invalid pagination cursor");
    const page = await dbPage("studies", { limit: 10_000 });
    expect(page.limit).toBe(100);
    expect(page.items.length).toBeLessThanOrEqual(100);
  });

  it("supports a 100-patient / 500-study synthetic workspace walk", async () => {
    await dbTransaction((tx) => {
      for (let patient = 0; patient < 100; patient += 1) {
        const patientId = `stress-patient-${patient}`;
        tx.put("patients", patientId, { patient_id: patientId, patient_ref: `SYNTH-${patient}`, created_at: "2026-09-10T00:00:00.000Z" });
      }
      for (let study = 0; study < 500; study += 1) {
        const studyId = `stress-study-${study}`;
        tx.put("studies", studyId, { study_id: studyId, patient_id: `stress-patient-${study % 100}`, status: "uploaded", created_at: "2026-09-10T00:00:00.000Z" });
      }
    });
    const patients = await dbAll<{ patient_id: string }>("patients");
    const studies = await dbAll<{ study_id: string; patient_id: string }>("studies");
    expect(patients.filter((row) => row.patient_id.startsWith("stress-")).length).toBe(100);
    expect(studies.filter((row) => row.study_id.startsWith("stress-")).length).toBe(500);
    const page = await dbPage<{ study_id: string; patient_id: string }>("studies", {
      limit: 50,
      predicate: (study) => study.patient_id === "stress-patient-42",
    });
    expect(page.items.every((study) => study.patient_id === "stress-patient-42")).toBe(true);
    expect(page.items.length).toBe(5);
    expect(page.has_more).toBe(false);
  });
});

afterAll(async () => {
  await closeDatabase();
});
