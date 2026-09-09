import sharp from "sharp";
import { createHash } from "crypto";
import { detectDicom } from "../imaging/dicom";

/**
 * Server-side interpretation of an uploaded asset.  This is deliberately
 * separate from the user supplied scanType: metadata is useful context, but
 * it is never authoritative for routing.
 */
export type AssetContainerType = "IMAGE" | "PDF" | "DICOM" | "OTHER";
export type AssetModality = "FUNDUS_PHOTO" | "OCT" | "OCTA" | "FAF" | "FA" | "ICG" | "SLIT_LAMP" | "UNKNOWN";
export type ModalityState =
  | "FUNDUS_PHOTO_CONFIRMED"
  | "FUNDUS_PHOTO_PROBABLE"
  | "OCT_PROBABLE"
  | "MODALITY_DECLARED_ONLY"
  | "MODALITY_UNKNOWN"
  | "UNSUPPORTED_CONTAINER";
export type DeviceState = "DEVICE_KNOWN" | "DEVICE_UNKNOWN";
export type DomainState = "IN_DOMAIN" | "OUT_OF_DISTRIBUTION" | "DOMAIN_VALIDATION_UNKNOWN" | "NOT_ASSESSED";

export interface AssetRoutingResult {
  schema_version: "asset-routing-v1";
  container_type: AssetContainerType;
  modality: AssetModality;
  modality_state: ModalityState;
  device_state: DeviceState;
  domain_state: DomainState;
  method: "CONTENT_HEURISTICS" | "PDF_PAGE_ROUTER" | "DICOM_SIGNATURE" | "DECLARED_METADATA" | "UNSUPPORTED";
  source_hash: string;
  declared_modality?: string | null;
  signals: Record<string, number | string | boolean | null>;
  warnings: string[];
}

export interface RasterContentClassification {
  modality: AssetModality;
  state: ModalityState;
  score: number;
  signals: Record<string, number | boolean>;
  warnings: string[];
}

export function assetHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Content signatures are preferred over MIME/filename, which clients can spoof. */
export function classifyAssetContainer(bytes: Buffer, mime?: string | null): AssetContainerType {
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "PDF";
  if (detectDicom(bytes).isDicom || String(mime ?? "").toLowerCase() === "application/dicom") return "DICOM";
  // Raster magic is checked synchronously so this helper remains cheap and safe.
  const h = bytes.subarray(0, 12);
  const jpeg = h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
  const png = h.toString("ascii", 1, 4) === "PNG";
  const webp = h.toString("ascii", 0, 4) === "RIFF" && h.toString("ascii", 8, 12) === "WEBP";
  if (jpeg || png || webp || String(mime ?? "").toLowerCase().startsWith("image/")) return "IMAGE";
  return "OTHER";
}

function clamp(n: number): number { return Math.max(0, Math.min(1, n)); }

/**
 * Conservative fundus/OCT screenshot recognition.  It is a routing aid, not
 * a clinical classifier: several independent visual signals are required and
 * the result is exposed as CONFIRMED/PROBABLE/UNKNOWN rather than a clinical
 * probability.
 */
export async function classifyRasterContent(bytes: Buffer): Promise<RasterContentClassification> {
  try {
    const image = sharp(bytes, { failOn: "none" });
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < 64 || height < 64) {
      return { modality: "UNKNOWN", state: "MODALITY_UNKNOWN", score: 0, signals: { width, height }, warnings: ["image_too_small_for_content_classification"] };
    }
    const { data, info } = await image.resize(160, 160, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    const px = info.width * info.height;
    const at = (x: number, y: number, c: number) => data[(y * info.width + x) * channels + Math.min(c, channels - 1)] ?? 0;
    let mean = [0, 0, 0];
    let variance = [0, 0, 0];
    let colourful = 0;
    let nonDark = 0;
    let darkCorners = 0;
    let centerBright = 0;
    let radialInside = 0;
    let radialOutside = 0;
    let texture = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const r = at(x, y, 0), g = at(x, y, 1), b = at(x, y, 2);
        const lum = (r + g + b) / 3;
        mean[0] += r; mean[1] += g; mean[2] += b;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 18) colourful++;
        if (lum > 18) nonDark++;
        const dx = (x - info.width / 2) / (info.width / 2);
        const dy = (y - info.height / 2) / (info.height / 2);
        const radius = Math.sqrt(dx * dx + dy * dy);
        if (radius < 0.82) radialInside += lum;
        else radialOutside += lum;
        if (radius < 0.25 && lum > 155) centerBright++;
        if ((x < 20 || x >= info.width - 20) && (y < 20 || y >= info.height - 20) && lum < 45) darkCorners++;
        if (x > 0) texture += Math.abs(lum - ((at(x - 1, y, 0) + at(x - 1, y, 1) + at(x - 1, y, 2)) / 3));
      }
    }
    mean = mean.map((x) => x / px);
    variance = mean.map((m, c) => {
      let v = 0;
      for (let y = 0; y < info.height; y += 2) for (let x = 0; x < info.width; x += 2) {
        const value = at(x, y, c); v += (value - m) ** 2;
      }
      return Math.sqrt(v / Math.max(1, Math.floor(px / 4))) / 128;
    });
    const colorSignal = clamp((mean[0] - mean[2] + (mean[1] - mean[2]) * 0.4) / 100);
    const circularSignal = clamp((radialInside / Math.max(1, radialOutside * 3)) * 1.2) * (darkCorners / 400);
    const textureSignal = clamp(texture / px / 28);
    const opticSignal = clamp(centerBright / (px * 0.04));
    const fovSignal = clamp(nonDark / px);
    const fundusScore =
      (width / Math.max(width, height) > 0.72 && height / Math.max(width, height) > 0.72 ? 1 : 0) +
      (colorSignal > 0.18 ? 1 : 0) +
      (circularSignal > 0.28 ? 1 : 0) +
      (textureSignal > 0.18 ? 1 : 0) +
      (fovSignal > 0.42 && fovSignal < 0.98 ? 1 : 0) +
      (opticSignal > 0.08 ? 1 : 0);
    const grayscale = channels === 1 || Math.max(...mean) - Math.min(...mean) < 5;
    // OCT report screenshots tend to be grayscale, wide and strongly textured;
    // this state remains probable and never overrides explicit page evidence.
    const octScore = (grayscale ? 2 : 0) + (width / Math.max(1, height) > 1.15 ? 1 : 0) + (textureSignal > 0.28 ? 1 : 0);
    const signals = {
      width, height, mean_r: Number(mean[0].toFixed(3)), mean_g: Number(mean[1].toFixed(3)), mean_b: Number(mean[2].toFixed(3)),
      color_signal: Number(colorSignal.toFixed(3)), circular_field_signal: Number(circularSignal.toFixed(3)),
      texture_signal: Number(textureSignal.toFixed(3)), optic_disc_like_signal: Number(opticSignal.toFixed(3)),
      field_of_view_signal: Number(fovSignal.toFixed(3)), grayscale,
    };
    // Wide grayscale OCT screenshots can share several low-level signals with
    // a dark fundus frame. Prefer OCT when its independent layout/texture
    // evidence is present unless the fundus evidence reaches the stronger
    // confirmed threshold; this prevents OCT fixtures from being sent to the
    // fundus lesion/DR providers while keeping conservative probable states.
    if (octScore >= 3 && grayscale && fundusScore < 5) return { modality: "OCT", state: "OCT_PROBABLE", score: octScore, signals, warnings: ["oct_content_requires_bscan_roi_validation"] };
    if (fundusScore >= 5) return { modality: "FUNDUS_PHOTO", state: "FUNDUS_PHOTO_CONFIRMED", score: fundusScore, signals, warnings: [] };
    if (fundusScore >= 4) return { modality: "FUNDUS_PHOTO", state: "FUNDUS_PHOTO_PROBABLE", score: fundusScore, signals, warnings: ["content_classifier_is_conservative_and_not_clinically_validated"] };
    if (octScore >= 3) return { modality: "OCT", state: "OCT_PROBABLE", score: octScore, signals, warnings: ["oct_content_requires_bscan_roi_validation"] };
    return { modality: "UNKNOWN", state: "MODALITY_UNKNOWN", score: fundusScore, signals, warnings: ["insufficient_content_signals_for_modality_route"] };
  } catch {
    return { modality: "UNKNOWN", state: "MODALITY_UNKNOWN", score: 0, signals: {}, warnings: ["image_decode_failed"] };
  }
}

function declaredToModality(declared?: string | null): AssetModality {
  const d = String(declared ?? "").toLowerCase();
  if (["fundus", "retinal_photo", "optic_nerve", "macula"].includes(d)) return "FUNDUS_PHOTO";
  if (d === "oct") return "OCT";
  if (d === "octa") return "OCTA";
  if (d === "faf") return "FAF";
  if (["ffa", "fa"].includes(d)) return "FA";
  if (d === "icg") return "ICG";
  if (d === "slit_lamp") return "SLIT_LAMP";
  return "UNKNOWN";
}

export async function routeUploadedAsset(
  bytes: Buffer,
  options: { mime?: string | null; declaredModality?: string | null; device?: { manufacturer?: string; model?: string } | null } = {},
): Promise<AssetRoutingResult> {
  const container = classifyAssetContainer(bytes, options.mime);
  const deviceState: DeviceState = options.device?.manufacturer || options.device?.model ? "DEVICE_KNOWN" : "DEVICE_UNKNOWN";
  const source_hash = assetHash(bytes);
  if (container === "PDF") {
    return {
      schema_version: "asset-routing-v1", container_type: container, modality: "UNKNOWN", modality_state: "MODALITY_UNKNOWN",
      device_state: deviceState, domain_state: "NOT_ASSESSED", method: "PDF_PAGE_ROUTER", source_hash,
      declared_modality: options.declaredModality ?? null, signals: { pdf_signature: true }, warnings: ["page_level_classification_required"],
    };
  }
  if (container === "DICOM") {
    return {
      schema_version: "asset-routing-v1", container_type: container, modality: "UNKNOWN", modality_state: "UNSUPPORTED_CONTAINER",
      device_state: deviceState, domain_state: "NOT_ASSESSED", method: "DICOM_SIGNATURE", source_hash,
      declared_modality: options.declaredModality ?? null, signals: { dicom_signature: true }, warnings: ["dicom_pixel_decoding_not_implemented"],
    };
  }
  if (container !== "IMAGE") {
    return {
      schema_version: "asset-routing-v1", container_type: container, modality: "UNKNOWN", modality_state: "UNSUPPORTED_CONTAINER",
      device_state: deviceState, domain_state: "NOT_ASSESSED", method: "UNSUPPORTED", source_hash,
      declared_modality: options.declaredModality ?? null, signals: {}, warnings: ["unsupported_asset_container"],
    };
  }
  const content = await classifyRasterContent(bytes);
  const declared = declaredToModality(options.declaredModality);
  const modality = content.modality !== "UNKNOWN" ? content.modality : declared;
  const state = content.modality !== "UNKNOWN" ? content.state : declared !== "UNKNOWN" ? "MODALITY_DECLARED_ONLY" : "MODALITY_UNKNOWN";
  const warnings = [...content.warnings];
  if (content.modality !== "UNKNOWN" && declared !== "UNKNOWN" && content.modality !== declared) warnings.push("declared_modality_conflicts_with_content");
  return {
    schema_version: "asset-routing-v1", container_type: container, modality, modality_state: state,
    device_state: deviceState, domain_state: modality === "UNKNOWN" ? "NOT_ASSESSED" : "DOMAIN_VALIDATION_UNKNOWN",
    method: content.modality !== "UNKNOWN" ? "CONTENT_HEURISTICS" : declared !== "UNKNOWN" ? "DECLARED_METADATA" : "UNSUPPORTED",
    source_hash, declared_modality: options.declaredModality ?? null, signals: content.signals, warnings,
  };
}
