import { describe, it, expect } from "vitest";
import { segformerOutputToFindings } from "@/lib/models/segformerFindingAdapter";
import type { RawModelOutput } from "@/lib/models/outputContract";

/**
 * S13 - localization audit follow-up tests for `segformerOutputToFindings()`
 * (lib/models/segformerFindingAdapter.ts). Pure-JS unit tests against
 * hand-built RawModelOutput objects - no Python/GPU/real inference involved.
 *
 * These exist to pin down and document the ACTUAL (not assumed) behavior of
 * the adapter around missing, out-of-range, negative, and NaN localization
 * data, per the read-only audit of the S9/S10 real-inference path. The
 * adapter (lib/models/segformerFindingAdapter.ts:47-49) does exactly this
 * and nothing else with `region`:
 *
 *   const region = rf.localization?.kind === "bounding_box" && rf.localization.coordinates
 *     ? rf.localization.coordinates
 *     : null;
 *
 * i.e. it is a pure pass-through / presence check - it never fabricates a
 * default box, and it also never clips, rejects, or otherwise validates the
 * numeric coordinate values themselves.
 */

function baseOutput(findings: RawModelOutput["findings"]): RawModelOutput {
  return {
    inference_status: "completed",
    modality: "FUNDUS",
    laterality: "unknown",
    findings,
    confidence: null,
    calibrated_confidence: null,
  };
}

describe("S13 - segformerOutputToFindings: missing localization", () => {
  it("a finding with no localization field at all yields region === null, never a fabricated default box", () => {
    const output = baseOutput([
      { finding_type: "research_segmented_optic_disc_area", evidence: "1000 px / 100000 px (1.00%)" },
    ]);
    const findings = segformerOutputToFindings(output, "FUNDUS");
    expect(findings).toHaveLength(1);
    expect(findings[0].region).toBeNull();
    // explicitly rule out the fabrication shapes this audit was asked to guard against
    expect(findings[0].region).not.toEqual({ x: 0.5, y: 0.5, w: 0, h: 0 }); // no center-point/center-box default
    expect(findings[0].region).not.toEqual({ x: 0, y: 0, w: 0, h: 0 });     // no all-zero default box
    expect(findings[0].region).not.toEqual({ x: 0, y: 0, w: 1, h: 1 });     // no full-image default box
  });

  it("a localization object present but with kind other than bounding_box (and no coordinates) also yields region === null", () => {
    const output = baseOutput([
      {
        finding_type: "research_segmented_optic_cup_area",
        localization: { kind: "mask", data_ref: "some/ref.png" },
      },
    ]);
    const findings = segformerOutputToFindings(output, "FUNDUS");
    expect(findings[0].region).toBeNull();
  });

  it("localization.kind is bounding_box but coordinates is absent (data_ref only) yields region === null, not a fabricated box", () => {
    const output = baseOutput([
      {
        finding_type: "research_segmented_optic_disc_area",
        localization: { kind: "bounding_box", data_ref: "some/ref" },
      },
    ]);
    const findings = segformerOutputToFindings(output, "FUNDUS");
    expect(findings[0].region).toBeNull();
  });
});

describe("S13 - segformerOutputToFindings: out-of-range coordinates pass through unvalidated (documents real, not ideal, behavior)", () => {
  it("a region with x + w > 1 is passed through verbatim - the adapter does NOT clip or reject it", () => {
    const output = baseOutput([
      {
        finding_type: "research_segmented_optic_disc_area",
        localization: { kind: "bounding_box", coordinates: { x: 0.8, y: 0.1, w: 0.5, h: 0.2 } }, // x+w = 1.3
      },
    ]);
    const findings = segformerOutputToFindings(output, "FUNDUS");
    expect(findings).toHaveLength(1);
    // Real behavior: no clamping/rejection happens in this function - flagged
    // as CONCERNING in the audit report since nothing downstream of this
    // point in the adapter enforces the [0,1] normalized-coordinate contract.
    expect(findings[0].region).toEqual({ x: 0.8, y: 0.1, w: 0.5, h: 0.2 });
    expect(findings[0].region!.x + findings[0].region!.w).toBeGreaterThan(1);
  });

  it("a region with y + h > 1 is likewise passed through verbatim, unclipped", () => {
    const output = baseOutput([
      {
        finding_type: "research_segmented_optic_cup_area",
        localization: { kind: "bounding_box", coordinates: { x: 0.1, y: 0.9, w: 0.1, h: 0.5 } }, // y+h = 1.4
      },
    ]);
    const findings = segformerOutputToFindings(output, "FUNDUS");
    expect(findings[0].region).toEqual({ x: 0.1, y: 0.9, w: 0.1, h: 0.5 });
    expect(findings[0].region!.y + findings[0].region!.h).toBeGreaterThan(1);
  });
});

describe("S13 - segformerOutputToFindings: numeric-safety gate (S13 audit fix)", () => {
  it("negative x/y coordinates pass through verbatim (documented research-out-of-range behavior; only non-finite values are rejected)", () => {
    const output = baseOutput([
      {
        finding_type: "research_segmented_optic_disc_area",
        localization: { kind: "bounding_box", coordinates: { x: -0.2, y: -0.05, w: 0.3, h: 0.3 } },
      },
    ]);
    const findings = segformerOutputToFindings(output, "FUNDUS");
    expect(findings[0].region).toEqual({ x: -0.2, y: -0.05, w: 0.3, h: 0.3 });
    expect(findings[0].region!.x).toBeLessThan(0);
  });

  it("NaN coordinate values are passed through verbatim - the adapter performs no NaN check", () => {
    const output = baseOutput([
      {
        finding_type: "research_segmented_optic_disc_area",
        localization: { kind: "bounding_box", coordinates: { x: NaN, y: 0.1, w: 0.2, h: 0.2 } },
      },
    ]);
    const findings = segformerOutputToFindings(output, "FUNDUS");
    // FIXED (S13 numeric-safety gate): a corrupt NaN box drops the whole
    // finding - no NaN geometry may ever reach the UI or downstream math.
    expect(findings).toHaveLength(0);
  });

  it("Infinity coordinates are also rejected - the numeric gate is not NaN-only", () => {
    const output = baseOutput([
      {
        finding_type: "research_segmented_optic_disc_area",
        localization: { kind: "bounding_box", coordinates: { x: Infinity, y: 0.1, w: 0.2, h: 0.2 } },
      },
    ]);
    const findings = segformerOutputToFindings(output, "FUNDUS");
    expect(findings).toHaveLength(0);
  });

  it("a valid finding survives alongside a corrupt NaN finding - corruption drops only its own finding", () => {
    const output = baseOutput([
      {
        finding_type: "research_segmented_optic_disc_area",
        localization: { kind: "bounding_box", coordinates: { x: NaN, y: 0.1, w: 0.2, h: 0.2 } },
      },
      {
        finding_type: "research_segmented_optic_cup_area",
        localization: { kind: "bounding_box", coordinates: { x: 0.3, y: 0.3, w: 0.1, h: 0.1 } },
      },
    ]);
    const findings = segformerOutputToFindings(output, "FUNDUS");
    expect(findings).toHaveLength(1);
    expect(Number.isFinite(findings[0].region!.x)).toBe(true);
  });
});

describe("S13 - segformerOutputToFindings: multiple valid findings survive independently", () => {
  it("two findings with distinct, in-range, valid coordinates each keep their own correct region - no cross-contamination", () => {
    const output = baseOutput([
      {
        finding_type: "research_segmented_optic_disc_area",
        evidence: "2000 px / 100000 px (2.00%)",
        localization: { kind: "bounding_box", coordinates: { x: 0.3, y: 0.35, w: 0.2, h: 0.18 } },
      },
      {
        finding_type: "research_segmented_optic_cup_area",
        evidence: "500 px / 100000 px (0.50%)",
        localization: { kind: "bounding_box", coordinates: { x: 0.36, y: 0.4, w: 0.08, h: 0.07 } },
      },
    ]);
    const findings = segformerOutputToFindings(output, "FUNDUS");
    expect(findings).toHaveLength(2);

    const disc = findings.find((f) => f.type === "research_segmented_optic_disc_area");
    const cup = findings.find((f) => f.type === "research_segmented_optic_cup_area");
    expect(disc).toBeDefined();
    expect(cup).toBeDefined();

    expect(disc!.region).toEqual({ x: 0.3, y: 0.35, w: 0.2, h: 0.18 });
    expect(cup!.region).toEqual({ x: 0.36, y: 0.4, w: 0.08, h: 0.07 });

    // independent identities - no shared/mutated object, no id collision
    expect(disc!.region).not.toBe(cup!.region);
    expect(disc!.id).not.toBe(cup!.id);

    // sanity: both are within [0,1] and this in-range case is unaffected by
    // the out-of-range pass-through behavior documented above
    for (const f of findings) {
      expect(f.region!.x).toBeGreaterThanOrEqual(0);
      expect(f.region!.y).toBeGreaterThanOrEqual(0);
      expect(f.region!.x + f.region!.w).toBeLessThanOrEqual(1);
      expect(f.region!.y + f.region!.h).toBeLessThanOrEqual(1);
    }
  });

  it("an unrecognized finding_type in the same batch is dropped without affecting the valid sibling finding", () => {
    const output = baseOutput([
      {
        finding_type: "research_segmented_optic_disc_area",
        localization: { kind: "bounding_box", coordinates: { x: 0.25, y: 0.25, w: 0.15, h: 0.15 } },
      },
      {
        finding_type: "not_a_real_taxonomy_type",
        localization: { kind: "bounding_box", coordinates: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } },
      },
    ]);
    const findings = segformerOutputToFindings(output, "FUNDUS");
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe("research_segmented_optic_disc_area");
    expect(findings[0].region).toEqual({ x: 0.25, y: 0.25, w: 0.15, h: 0.15 });
  });
});
