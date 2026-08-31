/**
 * DICOM support - DETECTION ONLY.
 *
 * The platform architecture supports DICOM via device adapters, but no DICOM
 * parser is implemented or validated. We detect the DICOM Part 10 magic
 * ("DICM" at offset 128) so such files can be identified, stored, and
 * clearly reported as "integration placeholder" instead of being silently
 * mis-analyzed (safety rule: never silently analyze a corrupted/unsupported scan).
 */

export interface DicomDetection {
  isDicom: boolean;
  hasPreamble: boolean;
  note: string;
}

export function detectDicom(buf: Buffer): DicomDetection {
  if (buf.length < 132) {
    return { isDicom: false, hasPreamble: false, note: "File too small to be DICOM Part 10." };
  }
  const magic = buf.toString("ascii", 128, 132);
  if (magic === "DICM") {
    return {
      isDicom: true,
      hasPreamble: true,
      note:
        "DICOM Part 10 file detected. DICOM ingestion is an integration placeholder: metadata parsing, " +
        "pixel-data decoding, and analysis of DICOM ophthalmic images are NOT yet implemented or validated. " +
        "The file has been preserved unchanged; no interpretation was generated.",
    };
  }
  return { isDicom: false, hasPreamble: false, note: "Not a DICOM Part 10 file." };
}

export const SUPPORTED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".dcm": "application/dicom",
};

export function normalizeMime(mime: string, ext: string): string {
  if (mime && mime !== "application/octet-stream") return mime;
  return EXT_TO_MIME[ext.toLowerCase()] ?? mime ?? "application/octet-stream";
}
