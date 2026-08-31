/**
 * Modality abstraction. A model must explicitly declare which modalities it
 * supports; the pipeline refuses modality/model mismatches.
 * Never run an OCT model on a fundus image or vice versa.
 */

export const SUPPORTED_MODALITIES = [
  "FUNDUS",
  "OCT",
  "OCTA",
  "FAF",
  "FA",
  "ICG",
  "SLIT_LAMP",
  "EXTERNAL_EYE",
  "DICOM_STUDY",
] as const;

export type Modality = (typeof SUPPORTED_MODALITIES)[number];

/** Maps the free-form modality strings accepted at upload to canonical modalities. */
const ALIASES: Record<string, Modality> = {
  fundus: "FUNDUS",
  retinal_photo: "FUNDUS",
  macula: "FUNDUS",
  optic_nerve: "FUNDUS",
  oct: "OCT",
  octa: "OCTA",
  faf: "FAF",
  ffa: "FA",
  fa: "FA",
  icg: "ICG",
  slit_lamp: "SLIT_LAMP",
  external_eye: "EXTERNAL_EYE",
  dicom_study: "DICOM_STUDY",
  unknown: "EXTERNAL_EYE", // heuristic default for unspecified uploads; OOD layer still applies
};

export function canonicalModality(raw: string): Modality {
  return ALIASES[raw.toLowerCase()] ?? "EXTERNAL_EYE";
}

export interface ModalityCheck {
  ok: boolean;
  canonical: Modality;
  reason?: string;
}

export function checkModalitySupported(model: { modalities: Modality[] }, raw: string): ModalityCheck {
  const canonical = canonicalModality(raw);
  if (!model.modalities.includes(canonical)) {
    return {
      ok: false,
      canonical,
      reason: `Modality mismatch: model supports [${model.modalities.join(", ")}] but input modality is ${canonical}.`,
    };
  }
  return { ok: true, canonical };
}
