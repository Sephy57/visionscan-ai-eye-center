import { describe, it, expect } from "vitest";
import { segformerOutputToFindings, segformerOutputToFindingsWithValidation } from "@/lib/models/segformerFindingAdapter";
import { OPTIC_CUP_FINDING, OPTIC_DISC_FINDING } from "@/lib/models/anatomyValidation";
import type { RawModelOutput } from "@/lib/models/outputContract";

/**
 * S13/Phase 4 - localization and anatomy admission tests. A SegFormer
 * result is presentation-eligible only when it contains exactly one complete
 * disc/cup pair, finite bounded boxes, structured mask areas, and a cup that
 * is geometrically contained by a disc no smaller than it. Incomplete or
 * impossible output is withheld; it is never converted into negative
 * evidence or a fabricated region.
 */

function baseOutput(findings: RawModelOutput["findings"]): RawModelOutput {
  return { inference_status: "completed", modality: "FUNDUS", laterality: "unknown", findings };
}

function finding(
  finding_type: string,
  area: number,
  coordinates: { x: number; y: number; w: number; h: number },
) {
  return {
    finding_type,
    localization: { kind: "bounding_box" as const, coordinates },
    measurement: { key: "mask_area_pixels", value: area, unit: "pixel" },
  };
}

function validOutput(): RawModelOutput {
  return baseOutput([
    finding(OPTIC_DISC_FINDING, 1000, { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }),
    finding(OPTIC_CUP_FINDING, 250, { x: 0.3, y: 0.3, w: 0.2, h: 0.2 }),
  ]);
}

describe("S13 - incomplete anatomy output", () => {
  it("withholds a single channel with no localization or area", () => {
    const result = segformerOutputToFindingsWithValidation(baseOutput([
      { finding_type: OPTIC_DISC_FINDING },
    ]), "FUNDUS");
    expect(result.anatomy_validation.state).toBe("INCOMPLETE");
    expect(result.findings).toEqual([]);
    expect(segformerOutputToFindings(baseOutput([{ finding_type: OPTIC_DISC_FINDING }]), "FUNDUS")).toEqual([]);
  });

  it("withholds a pair when either structured mask area is missing", () => {
    const output = validOutput();
    delete (output.findings![1] as { measurement?: unknown }).measurement;
    const result = segformerOutputToFindingsWithValidation(output, "FUNDUS");
    expect(result.anatomy_validation.state).toBe("INCOMPLETE");
    expect(result.findings).toEqual([]);
  });
});

describe("S13 - bounded anatomy geometry", () => {
  it("rejects cup area greater than disc area", () => {
    const output = validOutput();
    output.findings![1].measurement!.value = 1001;
    const result = segformerOutputToFindingsWithValidation(output, "FUNDUS");
    expect(result.anatomy_validation.state).toBe("INVALID");
    expect(result.findings).toEqual([]);
  });

  it("rejects a cup box outside the disc and normalized boxes outside the image", () => {
    const outsideDisc = validOutput();
    outsideDisc.findings![1].localization!.coordinates = { x: 0.7, y: 0.7, w: 0.2, h: 0.2 };
    expect(segformerOutputToFindingsWithValidation(outsideDisc, "FUNDUS").findings).toEqual([]);

    const outOfImage = validOutput();
    outOfImage.findings![0].localization!.coordinates = { x: -0.1, y: 0.2, w: 0.4, h: 0.4 };
    const result = segformerOutputToFindingsWithValidation(outOfImage, "FUNDUS");
    expect(result.anatomy_validation.state).toBe("INVALID");
    expect(result.findings).toEqual([]);
  });

  it("rejects duplicate channels and non-finite coordinates", () => {
    const duplicate = validOutput();
    duplicate.findings!.push(finding(OPTIC_DISC_FINDING, 900, { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }));
    expect(segformerOutputToFindingsWithValidation(duplicate, "FUNDUS").findings).toEqual([]);

    const nan = validOutput();
    nan.findings![0].localization!.coordinates!.x = Number.NaN;
    expect(segformerOutputToFindingsWithValidation(nan, "FUNDUS").findings).toEqual([]);
  });
});

describe("S13 - complete valid anatomy pair", () => {
  it("preserves each real box and structured measurement without a clinical CDR claim", () => {
    const result = segformerOutputToFindingsWithValidation(validOutput(), "FUNDUS");
    expect(result.anatomy_validation.state).toBe("VALID");
    expect(result.findings).toHaveLength(2);
    const disc = result.findings.find((f) => f.type === OPTIC_DISC_FINDING)!;
    const cup = result.findings.find((f) => f.type === OPTIC_CUP_FINDING)!;
    expect(disc.region).toEqual({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 });
    expect(cup.region).toEqual({ x: 0.3, y: 0.3, w: 0.2, h: 0.2 });
    expect(disc.structured_measurements?.[0].value).toBe(1000);
    expect(cup.structured_measurements?.[0].value).toBe(250);
    expect(result.anatomy_validation.reasons.join(" ")).toMatch(/does not establish glaucoma|clinical cup-to-disc ratio/i);
  });
});
