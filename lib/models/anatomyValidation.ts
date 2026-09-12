/**
 * Research anatomy-output validation.
 *
 * This is a technical plausibility gate for the isolated optic-disc/cup
 * segmentation candidate. It does not identify glaucoma, estimate risk, or
 * turn a geometric ratio into a clinical measurement. Its only job is to
 * reject an internally impossible segmentation before it can become a
 * presentation-facing observation.
 */

import type { RawFinding } from "./outputContract";

export const OPTIC_DISC_FINDING = "research_segmented_optic_disc_area";
export const OPTIC_CUP_FINDING = "research_segmented_optic_cup_area";

export type SegformerAnatomyValidationState = "VALID" | "INCOMPLETE" | "INVALID";

export interface SegformerAnatomyValidation {
  state: SegformerAnatomyValidationState;
  reasons: string[];
  disc_area_pixels: number | null;
  cup_area_pixels: number | null;
  cup_to_disc_area_ratio: number | null;
}

function boxIsFiniteAndPositive(box: NonNullable<RawFinding["localization"]>["coordinates"] | null): boolean {
  return !!box && [box.x, box.y, box.w, box.h].every((value) => Number.isFinite(value)) &&
    box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0 &&
    box.x <= 1 && box.y <= 1 && box.w <= 1 && box.h <= 1 &&
    box.x + box.w <= 1.0001 && box.y + box.h <= 1.0001;
}

function boxIsContained(
  inner: NonNullable<RawFinding["localization"]>["coordinates"] | null,
  outer: NonNullable<RawFinding["localization"]>["coordinates"] | null,
): boolean {
  if (!inner || !outer) return false;
  // A small tolerance absorbs normalized rounding at the raster boundary. It
  // is not a clinical tolerance and must never be used to repair a box.
  const tolerance = 1e-6;
  return inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.w <= outer.x + outer.w + tolerance &&
    inner.y + inner.h <= outer.y + outer.h + tolerance;
}

function areaFromFinding(finding: RawFinding | undefined): number | null {
  const measurement = finding?.measurement;
  if (!measurement || measurement.key !== "mask_area_pixels") return null;
  return typeof measurement.value === "number" && Number.isFinite(measurement.value) && measurement.value >= 0
    ? measurement.value
    : null;
}

function findingBox(finding: RawFinding | undefined): NonNullable<RawFinding["localization"]>["coordinates"] | null {
  const coordinates = finding?.localization?.kind === "bounding_box" ? finding.localization.coordinates : undefined;
  return coordinates ?? null;
}

/**
 * Validate the two anatomy channels emitted by the SegFormer candidate.
 *
 * Missing channels are INCOMPLETE rather than negative evidence. When both
 * channels exist, a cup area larger than the disc area or a cup box outside
 * the disc box is INVALID and must be blocked. No value is synthesized when
 * a model omits its structured area measurement.
 */
export function validateSegformerAnatomyOutput(findings: readonly RawFinding[]): SegformerAnatomyValidation {
  const discFindings = findings.filter((finding) => finding.finding_type === OPTIC_DISC_FINDING);
  const cupFindings = findings.filter((finding) => finding.finding_type === OPTIC_CUP_FINDING);
  const reasons: string[] = [];

  if (discFindings.length > 1) reasons.push("Multiple optic-disc segmentation channels were emitted.");
  if (cupFindings.length > 1) reasons.push("Multiple optic-cup segmentation channels were emitted.");
  if (reasons.length > 0) {
    return { state: "INVALID", reasons, disc_area_pixels: null, cup_area_pixels: null, cup_to_disc_area_ratio: null };
  }

  const disc = discFindings[0];
  const cup = cupFindings[0];
  if (!disc || !cup) {
    if (!disc) reasons.push("Optic-disc segmentation channel is absent.");
    if (!cup) reasons.push("Optic-cup segmentation channel is absent.");
    return { state: "INCOMPLETE", reasons, disc_area_pixels: areaFromFinding(disc), cup_area_pixels: areaFromFinding(cup), cup_to_disc_area_ratio: null };
  }

  const discArea = areaFromFinding(disc);
  const cupArea = areaFromFinding(cup);
  const discBox = findingBox(disc);
  const cupBox = findingBox(cup);

  if (disc.measurement && discArea === null) reasons.push("Optic-disc mask-area measurement is malformed or negative.");
  if (cup.measurement && cupArea === null) reasons.push("Optic-cup mask-area measurement is malformed or negative.");
  if (!boxIsFiniteAndPositive(discBox)) reasons.push("Optic-disc localization box is missing or degenerate.");
  if (!boxIsFiniteAndPositive(cupBox)) reasons.push("Optic-cup localization box is missing or degenerate.");
  if (discBox && cupBox && boxIsFiniteAndPositive(discBox) && boxIsFiniteAndPositive(cupBox) && !boxIsContained(cupBox, discBox)) {
    reasons.push("Optic-cup localization box is not contained within the optic-disc box.");
  }
  if (discArea !== null && cupArea !== null) {
    if (discArea <= 0) reasons.push("Optic-disc mask area is zero.");
    if (cupArea > discArea) reasons.push(`Optic-cup mask area (${cupArea}) exceeds optic-disc mask area (${discArea}).`);
  }

  const ratio = discArea !== null && discArea > 0 && cupArea !== null ? cupArea / discArea : null;
  if (ratio !== null && ratio > 1) reasons.push(`Optic-cup to optic-disc area ratio (${ratio.toFixed(4)}) exceeds 1.0.`);

  if (reasons.length > 0) {
    return { state: "INVALID", reasons, disc_area_pixels: discArea, cup_area_pixels: cupArea, cup_to_disc_area_ratio: ratio };
  }
  if (discArea === null || cupArea === null) {
    reasons.push("Structured mask-area measurements are incomplete; no ratio was derived.");
    return { state: "INCOMPLETE", reasons, disc_area_pixels: discArea, cup_area_pixels: cupArea, cup_to_disc_area_ratio: null };
  }
  return { state: "VALID", reasons: ["Optic-disc/cup output passed technical geometry checks; this does not establish glaucoma or a clinical cup-to-disc ratio."], disc_area_pixels: discArea, cup_area_pixels: cupArea, cup_to_disc_area_ratio: ratio };
}
