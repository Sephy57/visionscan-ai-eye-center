import sharp from "sharp";

/**
 * Image Quality Gate - REAL deterministic image metrics computed with sharp.
 *
 * What is genuinely measured: sharpness (Laplacian variance proxy),
 * illumination (mean/percentiles), highlight clipping (glare), shadow clipping,
 * resolution adequacy, aspect ratio / field-of-view sanity, color presence.
 *
 * HONESTY: thresholds are engineering defaults and are NOT clinically
 * validated (validationStatus: not_validated in the model registry).
 * A failing gate blocks clinical interpretation output (safety rule).
 */

export interface QualityResult {
  quality_score: number;            // 0..1
  quality_status: "pass" | "borderline" | "fail";
  detected_artifacts: string[];
  affected_regions: string[];
  recommended_reacquisition: boolean;
  metrics: {
    width: number;
    height: number;
    sharpness_score: number;        // normalized 0..1 (higher = sharper)
    illumination_mean: number;      // 0..255
    illumination_p5: number;
    illumination_p95: number;
    highlight_clip_ratio: number;   // fraction of near-saturated pixels
    shadow_clip_ratio: number;
    colorfulness: number;           // 0..1
    grayscale_only: boolean;
  };
  thresholds: Record<string, number>;
  limitations: string[];
}

export const QUALITY_THRESHOLDS = {
  min_width: 512,
  min_height: 512,
  blur_cutoff: 0.18,       // sharpness below this => blur artifact
  dark_mean: 40,           // mean below this => poor illumination
  bright_mean: 235,        // mean above this => overexposure
  glare_clip: 0.02,        // highlight clip ratio above this => glare
  pass_score: 0.7,         // >= pass
  borderline_score: 0.45,  // >= borderline, below fail
};

export async function assessQuality(input: Buffer): Promise<QualityResult> {
  const image = sharp(input, { failOn: "none" });
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  // Grayscale downscale for speed; Laplacian variance proxy for sharpness.
  const smallSide = 512;
  const scale = Math.min(1, smallSide / Math.max(width || 1, height || 1));
  const rw = Math.max(32, Math.round((width || smallSide) * scale));
  const rh = Math.max(32, Math.round((height || smallSide) * scale));

  const { data, info } = await image
    .clone()
    .resize(rw, rh, { fit: "inside" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const px = data;

  // Histogram / illumination stats
  const hist = new Array<number>(256).fill(0);
  let sum = 0;
  for (let i = 0; i < px.length; i++) {
    hist[px[i]]++;
    sum += px[i];
  }
  const total = px.length;
  const mean = sum / total;
  let p5 = 0, p95 = 255, acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= total * 0.05) { p5 = i; break; }
  }
  acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= total * 0.95) { p95 = i; break; }
  }
  const highlightClip = (hist[254] + hist[255]) / total;
  const shadowClip = (hist[0] + hist[1]) / total;

  // Laplacian variance (sharpness proxy)
  let lapSum = 0, lapSumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * px[i] - px[i - 1] - px[i + 1] - px[i - w] - px[i + w];
      lapSum += lap;
      lapSumSq += lap * lap;
      n++;
    }
  }
  const lapVar = n > 0 ? lapSumSq / n - (lapSum / n) ** 2 : 0;
  // Normalize empirically: lapVar ~ 0 (blur) .. ~2000+ (very sharp)
  const sharpness = Math.max(0, Math.min(1, Math.log10(1 + lapVar) / Math.log10(1 + 2000)));

  // Colorfulness: mean absolute channel deviation from gray
  const rgb = await image.clone().resize(64, 64, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  let colorDev = 0;
  const ch = rgb.info.channels;
  const count = rgb.info.width * rgb.info.height;
  for (let i = 0; i < count; i++) {
    const r = rgb.data[i * ch], g = rgb.data[i * ch + 1], b = rgb.data[i * ch + 2];
    const gray = (r + g + b) / 3;
    colorDev += (Math.abs(r - gray) + Math.abs(g - gray) + Math.abs(b - gray)) / (3 * 128);
  }
  const colorfulness = count > 0 ? Math.min(1, colorDev / count) : 0;

  // ---- Artifact detection ----
  const artifacts: string[] = [];
  const affected: string[] = [];

  if (sharpness < QUALITY_THRESHOLDS.blur_cutoff) {
    artifacts.push("blur");
    affected.push("global");
  }
  if (mean < QUALITY_THRESHOLDS.dark_mean) {
    artifacts.push("poor_illumination");
    affected.push("global");
  }
  if (mean > QUALITY_THRESHOLDS.bright_mean) {
    artifacts.push("overexposure");
    affected.push("global");
  }
  if (highlightClip > QUALITY_THRESHOLDS.glare_clip) {
    artifacts.push("glare");
    affected.push("highlight_regions");
  }
  if (width < QUALITY_THRESHOLDS.min_width || height < QUALITY_THRESHOLDS.min_height) {
    artifacts.push("insufficient_resolution");
    affected.push("global");
  }
  if (width > 0 && height > 0) {
    const ar = width / height;
    if (ar < 0.5 || ar > 3.5) {
      artifacts.push("incorrect_field_of_view");
      affected.push("frame");
    }
  }
  if (meta.format === "jpeg") {
    // Coarse proxy: extremely small JPEG at low quality tends to block; we only
    // flag very small files which are often heavily compressed.
    if (input.length < 40 * 1024 && width >= 800) {
      artifacts.push("possible_compression_artifacts");
      affected.push("global");
    }
  }

  // ---- Score ----
  let score = 1;
  if (artifacts.includes("blur")) score -= 0.35;
  if (artifacts.includes("poor_illumination") || artifacts.includes("overexposure")) score -= 0.3;
  if (artifacts.includes("glare")) score -= 0.2;
  if (artifacts.includes("insufficient_resolution")) score -= 0.25;
  if (artifacts.includes("incorrect_field_of_view")) score -= 0.25;
  if (artifacts.includes("possible_compression_artifacts")) score -= 0.1;
  score = Math.max(0, Math.min(1, score));

  const status: QualityResult["quality_status"] =
    score >= QUALITY_THRESHOLDS.pass_score ? "pass" :
    score >= QUALITY_THRESHOLDS.borderline_score ? "borderline" : "fail";

  return {
    quality_score: round3(score),
    quality_status: status,
    detected_artifacts: artifacts,
    affected_regions: [...new Set(affected)],
    recommended_reacquisition: status !== "pass",
    metrics: {
      width,
      height,
      sharpness_score: round3(sharpness),
      illumination_mean: round3(mean),
      illumination_p5: p5,
      illumination_p95: p95,
      highlight_clip_ratio: round3(highlightClip),
      shadow_clip_ratio: round3(shadowClip),
      colorfulness: round3(colorfulness),
      grayscale_only: colorfulness < 0.02,
    },
    thresholds: QUALITY_THRESHOLDS,
    limitations: [
      "Quality thresholds are engineering defaults and are not clinically validated.",
      "Modality-specific quality criteria (e.g., OCT volume completeness, angiography contrast) are not yet implemented.",
    ],
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
