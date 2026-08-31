import { newId } from "../storage/files";
import { Finding } from "./schema";

/**
 * Demo / synthetic finding generator.
 *
 * THIS IS NOT A MEDICAL MODEL. There is no lesion detector installed.
 * This module produces one or more clearly-flagged SYNTHETIC findings so the
 * full downstream pipeline (ensemble, triage, reporting, review UI) can be
 * exercised end-to-end. Every generated finding has synthetic: true and the
 * whole result is labeled "DEMO / SYNTHETIC RESULT - NOT FOR CLINICAL USE".
 *
 * Design constraints honored:
 *  - No finding is fabricated as if real.
 *  - Wording avoids diagnostic claims ("possible", "cannot be established").
 *  - Ambiguous bright/dark structures are NEVER auto-labeled "blood clot";
 *    the vocabulary distinguishes hemorrhage / vascular abnormality /
 *    artifact / indeterminate finding.
 */

export interface DemoFindingChoice {
  scenario: "no_finding" | "vascular_indeterminate" | "retinal_hemorrhage" | "macula_deposit";
  seed: number;
}

function hashSeed(buf: Buffer): number {
  let h = 2166136261;
  for (const b of buf) {
    h ^= b;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic scenario selection from image content hash (reproducible). */
export function pickDemoScenario(buf: Buffer): DemoFindingChoice {
  const seed = hashSeed(buf);
  return scenarioFromSeed(seed);
}

export function scenarioFromSeed(seed: number): DemoFindingChoice {
  const bucket = seed % 100;
  let scenario: DemoFindingChoice["scenario"];
  if (bucket < 45) scenario = "no_finding";
  else if (bucket < 70) scenario = "vascular_indeterminate";
  else if (bucket < 90) scenario = "retinal_hemorrhage";
  else scenario = "macula_deposit";
  return { scenario, seed };
}

const LOCATIONS = [
  "superior_temporal_retina",
  "inferior_temporal_retina",
  "superior_nasal_retina",
  "inferior_nasal_retina",
  "peripapillary_region",
  "macular_region",
];

export function buildDemoFindings(choice: DemoFindingChoice, qualityScore: number): Finding[] {
  switch (choice.scenario) {
    case "no_finding":
      return [];

    case "vascular_indeterminate":
      return [
        {
          id: newId("find"),
          type: "indeterminate_focal_hyperreflective_region",
          location: pick(choice.seed, LOCATIONS),
          severity: "indeterminate",
          confidence: 0.55,
          confidence_category: "LOW CONFIDENCE",
          region: pseudoRegion(choice.seed),
          explanation:
            "Focal hyperreflective region detected near a retinal vascular structure. The available image does not allow " +
            "reliable determination of whether this represents hemorrhage, artifact, or another abnormality. " +
            "Specialist review is recommended.",
          synthetic: true,
          model_id: "fundus-lesion-detector",
        },
      ];

    case "retinal_hemorrhage":
      return [
        {
          id: newId("find"),
          type: "possible_retinal_hemorrhage",
          location: pick(choice.seed >> 3, LOCATIONS),
          severity: "moderate",
          confidence: 0.71,
          confidence_category: "MODERATE CONFIDENCE",
          region: pseudoRegion(choice.seed >> 5),
          explanation:
            "Automated analysis identified a focal abnormal region consistent with a possible hemorrhagic or vascular " +
            "abnormality. The underlying cause cannot be established from this automated analysis alone.",
          synthetic: true,
          model_id: "fundus-lesion-detector",
        },
      ];

    case "macula_deposit":
      return [
        {
          id: newId("find"),
          type: "possible_drusen_like_deposit",
          location: "macular_region",
          severity: "mild",
          confidence: 0.58,
          confidence_category: "LOW CONFIDENCE",
          region: pseudoRegion(choice.seed >> 7),
          explanation:
            "Possible drusen-like deposit pattern in the macular region. Drusen-like changes can have multiple causes " +
            "and age-related variation; interpretation requires professional examination.",
          synthetic: true,
          model_id: "fundus-lesion-detector",
        },
      ];
  }
}

function pick(seed: number, arr: string[]): string {
  return arr[seed % arr.length];
}

function pseudoRegion(seed: number): Finding["region"] {
  // Deterministic pseudo-random normalized bbox (demo overlay only).
  const x = ((seed % 60) + 15) / 100;
  const y = (((seed >> 4) % 55) + 15) / 100;
  return { x, y, w: 0.12 + ((seed >> 8) % 8) / 100, h: 0.10 + ((seed >> 12) % 8) / 100 };
}
