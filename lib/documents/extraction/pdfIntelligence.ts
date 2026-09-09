import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { createHash } from "crypto";
import { DOCUMENTS_ROOT, safeJoin, ensureDirs } from "../../config";

export type PdfPageContentType =
  | "LAB_RESULT"
  | "OPHTHALMIC_NOTE"
  | "FUNDUS_REPORT"
  | "OCT_MACULAR_CUBE"
  | "OCT_RASTER"
  | "VISUAL_FIELD"
  | "IOP_REPORT"
  | "REFRACTION"
  | "DICOM_SUMMARY"
  | "UNKNOWN_CLINICAL"
  | "NON_OPHTHALMIC_CLINICAL";

export type PdfLaterality = "OD" | "OS" | "OU" | "UNKNOWN";

export interface PdfPageClassification {
  page: number;
  content_type: PdfPageContentType;
  modality: "OCT" | "FUNDUS" | "VISUAL_FIELD" | "IOP" | "REFRACTION" | "CLINICAL_DOCUMENT" | "UNKNOWN";
  laterality: PdfLaterality;
  classifier_method: "TEXT_RULES" | "VISUAL_LAYOUT_RULES" | "TEXT_AND_VISUAL";
  confidence_semantics: "RULE_MATCH_STRONG" | "RULE_MATCH_WEAK" | "UNKNOWN";
  verification_state: "UNREVIEWED";
  signals: string[];
  source_page_hash?: string;
  /** Explains whether page laterality was explicit, bilateral, or ambiguous. */
  laterality_source?: "EXPLICIT_TEXT" | "EXPLICIT_BILATERAL" | "AMBIGUOUS_TEXT" | "UNKNOWN";
}

export type PdfRegionContentType = "OCT_BSCAN" | "OCT_THICKNESS_MAP" | "OCT_EN_FACE" | "NUMERIC_TABLE" | "UNKNOWN_IMAGE";

export interface PdfImageRegion {
  region_id: string;
  document_id: string;
  study_id?: string;
  page: number;
  bbox: { x: number; y: number; w: number; h: number };
  source_page_hash: string;
  roi_hash: string;
  content_type: PdfRegionContentType;
  laterality: PdfLaterality;
  extraction_method: "EMBEDDED_IMAGE_CROP" | "PAGE_RENDER_CROP";
  storage_path: string;
  width: number;
  height: number;
  verification_status: "UNREVIEWED";
}

export interface PdfMeasurement {
  key: "central_subfield_thickness" | "cube_volume" | "cube_average_thickness" | "ilm_rpe_thickness" | "unknown_measurement";
  value_raw: string;
  value_normalized: number | null;
  unit: string | null;
  laterality: PdfLaterality;
  page: number;
  source_region: string;
  verification_status: "UNREVIEWED";
}

export interface PdfAssetRouting {
  schema_version: "pdf-asset-routing-v1";
  document_id: string;
  study_id: string;
  /** SHA-256 of the immutable PDF bytes used for page rendering. */
  source_document_hash?: string;
  document_modality: "MIXED_CLINICAL_DOCUMENT" | "OPHTHALMIC_DOCUMENT" | "NON_OPHTHALMIC_CLINICAL_RECORD" | "UNKNOWN_CLINICAL";
  pages: PdfPageClassification[];
  image_regions: PdfImageRegion[];
  measurements: PdfMeasurement[];
  warnings: string[];
}

export interface PdfPageInput {
  page: number;
  text: string;
  png?: Buffer;
  width?: number;
  height?: number;
}

function sourceHash(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

function lateralityFromText(text: string): { laterality: PdfLaterality; source: NonNullable<PdfPageClassification["laterality_source"]> } {
  const upper = text.toUpperCase();
  const od = /\bOD\b|\bRIGHT\s+EYE\b/.test(upper);
  const os = /\bOS\b|\bLEFT\s+EYE\b/.test(upper);
  if (/\bOU\b|\bBOTH\s+EYES?\b|\bBILATERAL\b/.test(upper)) return { laterality: "OU", source: "EXPLICIT_BILATERAL" };
  // Separate OD and OS mentions on a page are not safe evidence that every
  // derived region is bilateral; preserve the ambiguity instead of silently
  // assigning one eye or collapsing to an inferred OU.
  if (od && os) return { laterality: "UNKNOWN", source: "AMBIGUOUS_TEXT" };
  if (od) return { laterality: "OD", source: "EXPLICIT_TEXT" };
  if (os) return { laterality: "OS", source: "EXPLICIT_TEXT" };
  return { laterality: "UNKNOWN", source: "UNKNOWN" };
}

/** Text rules are intentionally coarse and make no disease inference. */
export function classifyPdfPageText(text: string, page = 1): PdfPageClassification {
  const raw = String(text ?? "").slice(0, 100_000);
  const upper = raw.toUpperCase();
  const lat = lateralityFromText(raw);
  const signals: string[] = [];
  const has = (re: RegExp, signal: string) => { if (re.test(upper)) signals.push(signal); return re.test(upper); };
  const lab = has(/\b(LABORATORY|LAB RESULT|CBC|HEMOGLOBIN|SERology|SERUM|CHEMISTRY|GLUCOSE|CREATININE|PLATELET|WBC|HBA1C|URINALYSIS)\b/i, "laboratory_marker");
  const zeiss = has(/\bZEISS\b/i, "zeiss_marker");
  const cirrus = has(/\bCIRRUS\b/i, "cirrus_marker");
  const cube = has(/MACULAR\s+CUBE|CUBE\s+(VOLUME|AVERAGE)|CENTRAL\s+SUBFIELD|ILM\s*[-–]?\s*RPE|512\s*[X×]\s*128|THICKNESS\s*MAP/i, "cirrus_macular_cube_marker");
  const raster = has(/HIGH\s+DEFINITION|5\s*LINE\s+RASTER|B[-\s]?SCAN|RETINAL\s+RASTER|HD\s+5\s+LINE/i, "oct_raster_marker");
  const fundus = has(/FUNDUS|RETINAL\s+PHOTOGRAPH|COLOR\s+PHOTO|OPTIC\s+DISC|DR\s+GRADE/i, "fundus_report_marker");
  const visualField = has(/VISUAL\s+FIELD|HUMPHREY|24[-\s]?2|30[-\s]?2|PERIMETRY/i, "visual_field_marker");
  const iop = has(/INTRAOCULAR\s+PRESSURE|\bIOP\b|TONOMETRY/i, "iop_marker");
  const refraction = has(/REFRACTION|SPHERE|CYLINDER|AXIS|PUPILLARY\s+DISTANCE/i, "refraction_marker");
  const note = has(/OPHTHALMOLOGY|OPHTHALMIC|ASSESSMENT|EXAMINATION|CLINICIAN\s+NOTE/i, "ophthalmic_note_marker");
  if ((cube || raster) && fundus) signals.push("modality_terms_conflict");
  if (zeiss && cirrus) signals.push("zeiss_cirrus_vendor_marker");
  let content_type: PdfPageContentType = "UNKNOWN_CLINICAL";
  let modality: PdfPageClassification["modality"] = "UNKNOWN";
  let confidence_semantics: PdfPageClassification["confidence_semantics"] = "UNKNOWN";
  if (cube) { content_type = "OCT_MACULAR_CUBE"; modality = "OCT"; confidence_semantics = fundus ? "RULE_MATCH_WEAK" : "RULE_MATCH_STRONG"; }
  else if (raster) { content_type = "OCT_RASTER"; modality = "OCT"; confidence_semantics = fundus ? "RULE_MATCH_WEAK" : "RULE_MATCH_STRONG"; }
  else if (lab && !fundus && !visualField && !iop) { content_type = "LAB_RESULT"; modality = "CLINICAL_DOCUMENT"; confidence_semantics = "RULE_MATCH_STRONG"; }
  else if (fundus) { content_type = "FUNDUS_REPORT"; modality = "FUNDUS"; confidence_semantics = "RULE_MATCH_WEAK"; }
  else if (visualField) { content_type = "VISUAL_FIELD"; modality = "VISUAL_FIELD"; confidence_semantics = "RULE_MATCH_STRONG"; }
  else if (iop) { content_type = "IOP_REPORT"; modality = "IOP"; confidence_semantics = "RULE_MATCH_STRONG"; }
  else if (refraction) { content_type = "REFRACTION"; modality = "REFRACTION"; confidence_semantics = "RULE_MATCH_STRONG"; }
  else if (note) { content_type = "OPHTHALMIC_NOTE"; modality = "CLINICAL_DOCUMENT"; confidence_semantics = "RULE_MATCH_WEAK"; }
  else if (raw.trim().length > 0) { content_type = "NON_OPHTHALMIC_CLINICAL"; modality = "CLINICAL_DOCUMENT"; confidence_semantics = "RULE_MATCH_WEAK"; }
  return {
    page, content_type, modality, laterality: lat.laterality,
    classifier_method: "TEXT_RULES", confidence_semantics, verification_state: "UNREVIEWED", signals,
    laterality_source: lat.source,
  };
}

async function visualSignals(png: Buffer): Promise<{ grayscale: boolean; texture: number; width: number; height: number }> {
  const { data, info } = await sharp(png, { failOn: "none" }).resize(128, 128, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  let diff = 0, texture = 0;
  const n = info.width * info.height;
  for (let i = 0; i < n; i++) {
    const r = data[i * channels] ?? 0, g = data[i * channels + Math.min(1, channels - 1)] ?? 0, b = data[i * channels + Math.min(2, channels - 1)] ?? 0;
    diff += Math.max(r, g, b) - Math.min(r, g, b);
    if (i % info.width > 0) {
      const prev = data[(i - 1) * channels] ?? 0;
      texture += Math.abs(r - prev);
    }
  }
  return { grayscale: diff / Math.max(1, n) < 7, texture: texture / Math.max(1, n), width: info.width, height: info.height };
}

export async function classifyPdfPage(page: PdfPageInput): Promise<PdfPageClassification> {
  const textResult = classifyPdfPageText(page.text, page.page);
  if (!page.png) return textResult;
  try {
    const visual = await visualSignals(page.png);
    const source_page_hash = sourceHash(page.png);
    const isVisualOct = visual.grayscale && visual.texture > 8 && visual.width / Math.max(1, visual.height) > 1.05;
    if (textResult.content_type === "UNKNOWN_CLINICAL" && isVisualOct) {
      return {
        ...textResult, content_type: "OCT_RASTER", modality: "OCT", classifier_method: "VISUAL_LAYOUT_RULES",
        confidence_semantics: "RULE_MATCH_WEAK", source_page_hash,
        signals: [...textResult.signals, "grayscale_wide_textured_layout"],
      };
    }
    return { ...textResult, classifier_method: textResult.signals.length ? "TEXT_AND_VISUAL" : "VISUAL_LAYOUT_RULES", source_page_hash };
  } catch {
    return textResult;
  }
}

function regionPath(documentId: string, regionId: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(documentId) || !/^[A-Za-z0-9_.-]+$/.test(regionId)) throw new Error("Path traversal rejected");
  return safeJoin(DOCUMENTS_ROOT, "extracted", "regions", documentId, `${regionId}.png`);
}

export async function readExtractedRegion(documentId: string, regionId: string): Promise<Buffer | null> {
  try { return await fs.readFile(regionPath(documentId, regionId)); } catch { return null; }
}

export async function deleteExtractedRegions(documentId: string): Promise<void> {
  if (!/^[A-Za-z0-9_.-]+$/.test(documentId)) return;
  try { await fs.rm(safeJoin(DOCUMENTS_ROOT, "extracted", "regions", documentId), { recursive: true, force: true }); } catch { /* best effort */ }
}

/**
 * Crops bounded image regions from an OCT report page. Whole-page screenshots
 * are rejected by construction (no candidate is >= 90% of page width/height).
 */
export async function extractOCTImageRegions(input: {
  document_id: string; study_id?: string; page: number; png: Buffer; classification: PdfPageClassification; max_regions?: number;
}): Promise<PdfImageRegion[]> {
  if (input.classification.modality !== "OCT" || !["OCT_RASTER", "OCT_MACULAR_CUBE"].includes(input.classification.content_type)) return [];
  let meta: import("sharp").Metadata;
  try { meta = await sharp(input.png, { failOn: "none" }).metadata(); } catch { return []; }
  const width = meta.width ?? 0, height = meta.height ?? 0;
  if (width < 160 || height < 100) return [];
  const source_page_hash = input.classification.source_page_hash ?? sourceHash(input.png);
  const wide = width / height > 1.35;
  // Report layouts commonly use one or more horizontal B-scan panels. The
  // alternatives are bounded interior tiles; ambiguity remains visible in
  // the region records rather than silently promoting the whole page.
  const boxes = wide
    ? [{ x: 0.06, y: 0.22, w: 0.42, h: 0.42 }, { x: 0.52, y: 0.22, w: 0.42, h: 0.42 }, { x: 0.06, y: 0.67, w: 0.42, h: 0.25 }, { x: 0.52, y: 0.67, w: 0.42, h: 0.25 }]
    : [{ x: 0.08, y: 0.20, w: 0.84, h: 0.26 }, { x: 0.08, y: 0.49, w: 0.84, h: 0.26 }, { x: 0.08, y: 0.76, w: 0.84, h: 0.16 }];
  const regions: PdfImageRegion[] = [];
  for (let i = 0; i < boxes.length && regions.length < (input.max_regions ?? 8); i++) {
    const b = boxes[i];
    if (b.w >= 0.9 || b.h >= 0.9 || b.w * b.h < 0.025) continue;
    const left = Math.max(0, Math.floor(b.x * width));
    const top = Math.max(0, Math.floor(b.y * height));
    const w = Math.min(width - left, Math.max(1, Math.floor(b.w * width)));
    const h = Math.min(height - top, Math.max(1, Math.floor(b.h * height)));
    if (w < 100 || h < 40) continue;
    try {
      const crop = await sharp(input.png, { failOn: "none" }).extract({ left, top, width: w, height: h }).png().toBuffer();
      const stats = await sharp(crop).stats();
      const spread = stats.channels.reduce((sum, c) => sum + c.stdev, 0) / Math.max(1, stats.channels.length);
      if (!Number.isFinite(spread) || spread < 4) continue;
      const means = stats.channels.map((c) => c.mean);
      const chroma = means.length >= 3 ? Math.max(...means.slice(0, 3)) - Math.min(...means.slice(0, 3)) : 0;
      const cropAspect = w / Math.max(1, h);
      // B-scans are grayscale, elongated, and textured. A strongly coloured
      // crop is retained as evidence but explicitly typed as a thickness map
      // (never admitted to the OCT B-scan model); near-square crops remain
      // unclassified rather than being silently promoted to B-scan.
      const content_type: PdfRegionContentType = chroma > 18
        ? "OCT_THICKNESS_MAP"
        : cropAspect < 1.2
          ? "OCT_EN_FACE"
          : "OCT_BSCAN";
      const roi_hash = sourceHash(crop);
      const region_id = `region_p${input.page}_${i}_${roi_hash.slice(0, 12)}`;
      const target = regionPath(input.document_id, region_id);
      ensureDirs();
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, crop, { flag: "wx" }).catch(async (err: unknown) => {
        if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
      });
      regions.push({
        region_id, document_id: input.document_id, study_id: input.study_id, page: input.page, bbox: b,
        source_page_hash, roi_hash, content_type, laterality: input.classification.laterality,
        extraction_method: "PAGE_RENDER_CROP", storage_path: path.relative(DOCUMENTS_ROOT, target), width: w, height: h,
        verification_status: "UNREVIEWED",
      });
    } catch { /* ambiguous/invalid crop: fail closed */ }
  }
  return regions;
}

export function extractPdfMeasurements(text: string, page: number, laterality: PdfLaterality, sourceRegion = `page-${page}`): PdfMeasurement[] {
  const out: PdfMeasurement[] = [];
  const patterns: Array<[PdfMeasurement["key"], RegExp]> = [
    ["central_subfield_thickness", /CENTRAL\s+SUBFIELD\s+THICKNESS[^\d]{0,40}(\d+(?:\.\d+)?)\s*(UM|µM|MM)?/i],
    ["cube_volume", /CUBE\s+VOLUME[^\d]{0,40}(\d+(?:\.\d+)?)\s*(MM3|MM\s*3|MM³)?/i],
    ["cube_average_thickness", /CUBE\s+AVERAGE\s+THICKNESS[^\d]{0,40}(\d+(?:\.\d+)?)\s*(UM|µM|MM)?/i],
    ["ilm_rpe_thickness", /ILM\s*[-–]?\s*RPE[^\d]{0,40}(\d+(?:\.\d+)?)\s*(UM|µM|MM)?/i],
  ];
  for (const [key, re] of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const value = Number(m[1]);
    const token = m[2]?.toUpperCase().replace(/\s+/g, "");
    const unit = token
      ? token.startsWith("UM") || token === "ΜM" ? "µm" : token.startsWith("MM") ? key === "cube_volume" ? "mm³" : "mm" : null
      : null;
    // A number without a legible unit is retained as raw evidence only. Never
    // guess µm/mm³ from the measurement label; normalization stays null.
    out.push({ key, value_raw: m[0].trim().slice(0, 160), value_normalized: Number.isFinite(value) && unit ? value : null, unit, laterality, page, source_region: sourceRegion, verification_status: "UNREVIEWED" });
  }
  return out;
}

export async function analyzePdfDocument(input: { document_id: string; study_id: string; source_document_hash?: string; pages: PdfPageInput[] }): Promise<PdfAssetRouting> {
  const pages: PdfPageClassification[] = [];
  const image_regions: PdfImageRegion[] = [];
  const measurements: PdfMeasurement[] = [];
  const warnings: string[] = [];
  for (const page of input.pages) {
    const classification = await classifyPdfPage(page);
    pages.push(classification);
    measurements.push(...extractPdfMeasurements(page.text, page.page, classification.laterality));
    if (["OCT_RASTER", "OCT_MACULAR_CUBE"].includes(classification.content_type)) {
      if (page.png) image_regions.push(...await extractOCTImageRegions({ document_id: input.document_id, study_id: input.study_id, page: page.page, png: page.png, classification }));
      else warnings.push(`page_${page.page}:oct_image_not_rendered`);
    }
  }
  const octCount = pages.filter((p) => p.modality === "OCT").length;
  const eyeCount = pages.filter((p) => p.modality === "FUNDUS" || p.modality === "VISUAL_FIELD" || p.modality === "IOP" || p.modality === "REFRACTION").length;
  const nonOph = pages.filter((p) => p.content_type === "LAB_RESULT" || p.content_type === "NON_OPHTHALMIC_CLINICAL").length;
  const document_modality = octCount > 0 && (nonOph > 0 || pages.length > octCount)
    ? "MIXED_CLINICAL_DOCUMENT"
    : octCount > 0 || eyeCount > 0 ? "OPHTHALMIC_DOCUMENT"
      : nonOph > 0 ? "NON_OPHTHALMIC_CLINICAL_RECORD" : "UNKNOWN_CLINICAL";
  return { schema_version: "pdf-asset-routing-v1", document_id: input.document_id, study_id: input.study_id, source_document_hash: input.source_document_hash, document_modality, pages, image_regions, measurements, warnings };
}
