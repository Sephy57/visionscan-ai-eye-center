import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { VALIDATION_REGISTRY, VALIDATION_REGISTRY_VERSION, validationEntryForModel } from "@/lib/models/validationRegistry";
import { getModel } from "@/lib/models/registry";
import { createSession, SESSION_COOKIE } from "@/lib/auth/sessions";

/**
 * Validation registry: machine-readable per-model evidence inventory.
 * Numbers must stay consistent with the model registry (id/version/hash/
 * status); the /models UI reads this registry instead of hard-coded text.
 */

describe("validation registry consistency", () => {
  it("covers every non-demo registered model with matching identity", () => {
    expect(VALIDATION_REGISTRY.length).toBeGreaterThan(0);
    for (const entry of VALIDATION_REGISTRY) {
      const model = getModel(entry.model_id);
      expect(model).toBeDefined();
      expect(entry.model_version).toBe(model!.version);
      expect(entry.artifact_sha256).toBe(model!.sha256);
      expect(entry.status).toBe(model!.status);
    }
  });

  it("never claims clinical validation and pins a review date per entry", () => {
    for (const entry of VALIDATION_REGISTRY) {
      expect(entry.status).not.toBe("CLINICALLY_VALIDATED");
      expect(entry.calibration).toBe("NOT_CALIBRATED");
      expect(entry.last_review_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.datasets.length).toBeGreaterThan(0);
      for (const d of entry.datasets) {
        expect(d.name.length).toBeGreaterThan(0);
        expect(d.evidence_doc.startsWith("docs/evaluations/")).toBe(true);
        expect(["VERIFIED_DISJOINT", "NOT_VERIFIABLE", "OVERLAP_DISCLOSED"]).toContain(d.patient_separation);
      }
      expect(entry.limitations.length).toBeGreaterThan(0);
      const text = JSON.stringify(entry).toLowerCase();
      expect(text).not.toContain("clinically validated");
    }
  });

  it("resolves entries by model id", () => {
    expect(validationEntryForModel("fundus-lesions-clementp-unet-seresnext50")?.model_id).toBe(
      "fundus-lesions-clementp-unet-seresnext50"
    );
    expect(validationEntryForModel("no-such-model")).toBeNull();
  });

  it("has a versioned registry version", () => {
    expect(VALIDATION_REGISTRY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

describe("GET /api/models/validation", () => {
  it("is ADMIN-only and returns the registry without executing models", async () => {
    const ROUTE = (await import("@/app/api/models/validation/route")) as typeof import("@/app/api/models/validation/route");
    const anon = await ROUTE.GET(new NextRequest("http://localhost:3000/api/models/validation"));
    expect(anon.status).toBe(401);
    const { token } = await createSession({ user_id: "val_admin", username: "val_admin", role: "ADMIN" });
    const res = await ROUTE.GET(
      new NextRequest("http://localhost:3000/api/models/validation", { headers: { cookie: `${SESSION_COOKIE}=${token}` } })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.registry_version).toBe(VALIDATION_REGISTRY_VERSION);
    expect(body.entries.length).toBe(VALIDATION_REGISTRY.length);
  });
});
