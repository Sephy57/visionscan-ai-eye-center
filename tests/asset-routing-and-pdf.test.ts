import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  classifyAssetContainer,
  classifyRasterContent,
  routeUploadedAsset,
} from "@/lib/assets/assetRouter";
import {
  classifyPdfPageText,
  extractOCTImageRegions,
  extractPdfMeasurements,
} from "@/lib/documents/extraction/pdfIntelligence";

async function fundusLike(): Promise<Buffer> {
  const size = 512;
  const raw = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot(x - size / 2, y - size / 2);
    let r = 10, g = 7, b = 7;
    if (radius < size * 0.43) {
      r = 70 + ((x * 7 + y * 3) % 80);
      g = 30 + ((x * 3 + y * 5) % 60);
      b = 20 + ((x + y) % 20);
    }
    if (radius < size * 0.11 && x > size * 0.58) { r = 240; g = 220; b = 190; }
    const i = (y * size + x) * 3; raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).jpeg().toBuffer();
}

async function octLike(): Promise<Buffer> {
  const width = 900, height = 480;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = Math.max(0, Math.min(255, 80 + Math.round(65 * Math.sin(y / 9) + 35 * Math.sin(x / 17))));
    const i = (y * width + x) * 3; raw[i] = v; raw[i + 1] = v; raw[i + 2] = v;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe("server-computed asset routing", () => {
  it("recognizes a metadata-free fundus-like image without converting missing device data to OOD", async () => {
    const bytes = await fundusLike();
    expect(classifyAssetContainer(bytes, "image/jpeg")).toBe("IMAGE");
    const route = await routeUploadedAsset(bytes, { mime: "image/jpeg", declaredModality: "unknown" });
    expect(["FUNDUS_PHOTO_CONFIRMED", "FUNDUS_PHOTO_PROBABLE"]).toContain(route.modality_state);
    expect(route.modality).toBe("FUNDUS_PHOTO");
    expect(route.device_state).toBe("DEVICE_UNKNOWN");
    expect(route.domain_state).toBe("DOMAIN_VALIDATION_UNKNOWN");
  });

  it("does not allow a client declaration to reclassify a PDF or unsupported bytes", async () => {
    expect(classifyAssetContainer(Buffer.from("%PDF-1.7\n"), "image/jpeg")).toBe("PDF");
    const route = await routeUploadedAsset(Buffer.from("not an image"), { mime: "image/jpeg", declaredModality: "fundus" });
    expect(route.container_type).toBe("IMAGE");
    expect(route.modality_state).toBe("MODALITY_DECLARED_ONLY");
  });
});

describe("mixed PDF page and bounded OCT-region intelligence", () => {
  it("classifies Zeiss/Cirrus pages and keeps laboratory pages separate", () => {
    const oct = classifyPdfPageText("ZEISS CIRRUS Macular Thickness: Macular Cube 512x128 OD Central Subfield Thickness 274 um Cube Volume 10.2 mm3", 2);
    expect(oct.content_type).toBe("OCT_MACULAR_CUBE");
    expect(oct.modality).toBe("OCT");
    expect(oct.laterality).toBe("OD");
    expect(oct.confidence_semantics).toBe("RULE_MATCH_STRONG");
    const lab = classifyPdfPageText("LABORATORY REPORT CBC Hemoglobin 13.4 g/dL", 1);
    expect(lab.content_type).toBe("LAB_RESULT");
    expect(lab.modality).toBe("CLINICAL_DOCUMENT");
  });

  it("does not infer bilateral laterality from a page that merely mentions both eyes", () => {
    const page = classifyPdfPageText("ZEISS CIRRUS Macular Cube OD ... comparison with OS ...", 4);
    expect(page.laterality).toBe("UNKNOWN");
    expect(page.laterality_source).toBe("AMBIGUOUS_TEXT");
  });

  it("extracts objective values as unreviewed evidence and never assigns disease meaning", () => {
    const values = extractPdfMeasurements("Macular Cube 512x128 OD Central Subfield Thickness 274 um Cube Volume 10.2 mm3", 2, "OD");
    expect(values.map((v) => v.key)).toEqual(expect.arrayContaining(["central_subfield_thickness", "cube_volume"]));
    expect(values.every((v) => v.verification_status === "UNREVIEWED")).toBe(true);
    expect(values.every((v) => v.laterality === "OD" && v.page === 2)).toBe(true);
  });

  it("keeps a unit-less numeric label raw without guessing a normalized unit", () => {
    const values = extractPdfMeasurements("OD Central Subfield Thickness 274", 2, "OD");
    expect(values[0]?.unit).toBeNull();
    expect(values[0]?.value_normalized).toBeNull();
  });

  it("crops only bounded OCT B-scan candidates and records source/ROI hashes", async () => {
    const png = await octLike();
    const classification = { ...classifyPdfPageText("High Definition Images: 5 Line Raster OS", 3), source_page_hash: "page-hash" };
    const regions = await extractOCTImageRegions({ document_id: "doc_asset_test", study_id: "study_asset_test", page: 3, png, classification, max_regions: 4 });
    expect(regions.length).toBeGreaterThan(0);
    expect(regions.every((r) => r.content_type === "OCT_BSCAN")).toBe(true);
    expect(regions.every((r) => r.bbox.w < 0.9 && r.bbox.h < 0.9)).toBe(true);
    expect(regions.every((r) => r.source_page_hash === "page-hash" && /^[a-f0-9]{64}$/.test(r.roi_hash))).toBe(true);
    expect(regions.every((r) => r.laterality === "OS" && r.verification_status === "UNREVIEWED")).toBe(true);
  });
});
