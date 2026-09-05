import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { createStudy, analyzeStudy, deleteStudy } from "@/lib/studies/service";
import { clinicalInterpretationLabel } from "@/lib/reports/generator";
import type { DeviceMetadata } from "@/lib/devices/adapter";

/**
 * S12 - integration tests wiring the S11 presentation/safety primitives
 * (lib/models/diagnosisGate.ts, lib/analysis/qualityPresentation.ts,
 * lib/reports/terminology.ts) into the legacy DEMO analysis pipeline
 * (lib/analysis/pipeline.ts, lib/reports/generator.ts) and its
 * /result + /report presentation surfaces.
 *
 * Scenario (a) - the "all seven true" pure-function case for
 * canDisplayDiagnosis() is already exhaustively covered by
 * tests/s11-presentation-safety.test.ts ("allows a diagnosis only when
 * every one of the 7 conditions holds"). Not duplicated here.
 */

const DECLARED: DeviceMetadata = {
  scanType: "fundus",
  eye: "OD",
  providedBy: "none",
};

async function makeFundusLikeImage(): Promise<Buffer> {
  // Deterministic synthetic (NOT a medical) image, same style as
  // tests/selftest.ts's makeTestImage - large/bright/sharp enough to pass
  // the real quality gate so findings/conditions can actually be produced.
  const w = 1024, h = 768;
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#7a1f1f"/>
     <circle cx="512" cy="384" r="300" fill="#8e2626"/>
     <circle cx="640" cy="384" r="70" fill="#c96a2a"/>
     <circle cx="660" cy="384" r="28" fill="#e8d9b0"/>
     <path d="M 600 384 Q 500 300 380 260" stroke="#d94f2a" stroke-width="10" fill="none"/>
     <path d="M 600 384 Q 500 470 380 520" stroke="#d94f2a" stroke-width="8" fill="none"/></svg>`
  );
  return sharp(svg).png().toBuffer();
}

describe("S12 - diagnosis gate wired into the real DEMO pipeline", () => {
  const createdStudyIds: string[] = [];

  afterAll(async () => {
    for (const id of createdStudyIds) {
      await deleteStudy(id).catch(() => {});
    }
  });

  it(
    "a real end-to-end createStudy + analyzeStudy run (demo-fundus-synthetic-v0, the only " +
      "registered model, is never CLINICALLY_VALIDATED) always yields REQUIRES_CLINICAL_CORRELATION, never DIAGNOSIS",
    async () => {
      const bytes = await makeFundusLikeImage();
      const study = await createStudy("s12-integration.png", "image/png", bytes, DECLARED);
      createdStudyIds.push(study.study_id);

      const { analysis, report } = await analyzeStudy(study.study_id);

      // Real code, not a mock: the diagnosis gate is computed inside
      // lib/analysis/pipeline.ts's runPipeline() and carried through
      // lib/reports/generator.ts's generateReport() unmodified.
      expect(analysis.diagnosis_gate).toBeDefined();
      expect(analysis.diagnosis_gate!.allowed).toBe(false);
      expect(analysis.diagnosis_gate!.clinical_interpretation).toBe("REQUIRES_CLINICAL_CORRELATION");
      expect(analysis.diagnosis_gate!.reasons.length).toBeGreaterThan(0);
      // The reason must correctly reflect that the DEMO model itself is
      // the (at minimum) disqualifying condition - not some unrelated field.
      expect(analysis.diagnosis_gate!.reasons.join(" ")).toMatch(/NOT_VALIDATED/);

      expect(report.diagnosis_gate).toBeDefined();
      expect(report.diagnosis_gate!.clinical_interpretation).toBe("REQUIRES_CLINICAL_CORRELATION");

      // The fail-closed accessor other rendering code is meant to use.
      expect(clinicalInterpretationLabel(report)).toBe("REQUIRES_CLINICAL_CORRELATION");
      expect(clinicalInterpretationLabel(analysis)).toBe("REQUIRES_CLINICAL_CORRELATION");

      // Never a bare "diagnosis" claim in the overall result headline.
      expect(report.overall_result).not.toMatch(/\bDIAGNOS/i);
    },
    30000
  );

  it("a pre-S12 result missing diagnosis_gate entirely is treated as closed (fail-closed default), never open", () => {
    // Simulates a stored result created before this session's schema
    // addition - diagnosis_gate is optional precisely for this case.
    expect(clinicalInterpretationLabel({ diagnosis_gate: undefined })).toBe("REQUIRES_CLINICAL_CORRELATION");
  });
});

describe("S12 - app/report/page.tsx: ruleset/pipeline info is now collapsible, matching /result", () => {
  const reportSource = fs.readFileSync(
    path.resolve(__dirname, "../app/report/page.tsx"),
    "utf8"
  );

  it("no longer prints the ruleset/pipeline line directly in the exposed 'AI model information' card", () => {
    // The old, exposed (non-collapsed) line from the audit finding must be gone.
    expect(reportSource).not.toMatch(
      /<p className="tiny muted">Ruleset \{report\.provenance\.ruleset_version\}/
    );
  });

  it("prints the ruleset/pipeline version fields inside a <details>/<summary>Advanced technical information</summary> disclosure", () => {
    const detailsMatch = reportSource.match(
      /<details className="tech"[^]*?<summary>Advanced technical information<\/summary>[^]*?<\/details>/
    );
    expect(detailsMatch).not.toBeNull();
    const block = detailsMatch![0];
    expect(block).toContain("report.provenance.ruleset_version");
    expect(block).toContain("report.provenance.pipeline_version");
  });

  it("the uncertainty percentage is relabeled to make clear it is not calibrated confidence", () => {
    expect(reportSource).toMatch(/Heuristic uncertainty score \(not calibrated confidence\)/);
  });
});

describe("S12 - app/result/page.tsx: uncertainty relabeled, not shown as a bare percent badge", () => {
  const resultSource = fs.readFileSync(
    path.resolve(__dirname, "../app/result/page.tsx"),
    "utf8"
  );

  it("no longer renders the bare uncertainty percent as a Badge in the primary view", () => {
    expect(resultSource).not.toMatch(
      /<h3>Uncertainty<\/h3><Badge tone="warn">\{\(a\.uncertainty\.overall \* 100\)\.toFixed\(0\)\}%<\/Badge>/
    );
  });

  it("labels the heuristic uncertainty score as not calibrated confidence", () => {
    expect(resultSource).toMatch(/Heuristic uncertainty score \(not calibrated confidence\)/);
  });

  it("uses presentQuality() rather than a raw pass/borderline/fail-derived GOOD label", () => {
    expect(resultSource).toContain("presentQuality(");
    expect(resultSource).not.toMatch(
      /a\.quality\.status === "pass" \? "GOOD"/
    );
  });
});
