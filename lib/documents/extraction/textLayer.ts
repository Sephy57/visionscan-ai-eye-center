import { createRequire } from "module";
import zlib from "zlib";
import { PDFDict, PDFName, PDFRawStream, PDFRef, PDFArray } from "pdf-lib";
import type { PageExtraction } from "./types";
import { MAX_EXTRACTION_CHARS_PER_PAGE } from "../constants";

/**
 * pdfjs + pdf-lib page-content access (S2).
 *
 * IMPORTANT ENGINEERING DECISION (recorded in docs/OCR_DECISION.md):
 * pdfjs-dist is used ONLY for text-layer extraction. Its canvas rendering
 * path hard-crashes Node when drawing embedded JPEG images against
 * @napi-rs/canvas (native access violation, 0xC0000005). Rasterization for
 * OCR therefore extracts the page's embedded image XObjects directly via
 * pdf-lib (memory-safe) instead of rasterizing through pdfjs. Pages without
 * an extractable image are reported as failures - never silently skipped.
 */

interface PdfTextItem {
  str?: string;
}
interface PdfPageProxy {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  cleanup(): void;
}
interface PdfDocumentProxy {
  numPages: number;
  getPage(n: number): Promise<PdfPageProxy>;
  destroy(): Promise<void>;
}

interface PdfjsModule {
  getDocument(src: { data: Uint8Array; useSystemFonts?: boolean; isEvalSupported?: boolean; disableFontFace?: boolean }): {
    promise: Promise<PdfDocumentProxy>;
  };
}

let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // Legacy build: plain Node-compatible ESM, no DOM assumptions. Dynamic
      // import keeps Next.js/webpack from bundling the ESM module statically.
      return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
    })();
  }
  return pdfjsPromise;
}

export interface TextLayerPage {
  page: number;
  text: string;
  char_count: number;
  warnings: string[];
}

export interface RenderedPage {
  png: Buffer;
  width: number;
  height: number;
  source: "embedded_image" | "embedded_image_rescaled";
  image_encoding: "DCTDecode" | "FlateDecode";
}

export class PageImageNotExtractableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PageImageNotExtractableError";
  }
}

interface PdfLibPage {
  node: {
    Resources(): PDFDict | undefined;
  };
}
interface PdfLibDoc {
  getPage(index: number): PdfLibPage;
}

export interface LoadedPdf {
  numPages: number;
  pageText(pageNumber: number, maxChars: number): Promise<TextLayerPage>;
  renderPageToPng(pageNumber: number, maxDimensionPx: number): Promise<RenderedPage>;
  destroy(): Promise<void>;
}

export async function loadPdf(bytes: Buffer): Promise<LoadedPdf> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    isEvalSupported: false,          // never evaluate embedded JS-like structures
    disableFontFace: true,
  }).promise;

  // Second, independent load with pdf-lib for image-XObject access.
  const { PDFDocument: PdfLibDocument } = await import("pdf-lib");
  const libDoc = (await PdfLibDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false })) as unknown as PdfLibDoc & { context: import("pdf-lib").PDFContext };

  return {
    numPages: doc.numPages,
    async pageText(pageNumber: number, maxChars = MAX_EXTRACTION_CHARS_PER_PAGE): Promise<TextLayerPage> {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        let text = content.items
          .map((item) => (typeof item.str === "string" ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        const warnings: string[] = [];
        if (text.length > maxChars) {
          warnings.push("char_limit_page");
          text = text.slice(0, maxChars);
        }
        return { page: pageNumber, text, char_count: text.length, warnings };
      } finally {
        page.cleanup();
      }
    },
    async renderPageToPng(pageNumber: number, maxDimensionPx: number): Promise<RenderedPage> {
      const { createCanvas, loadImage } = await import("@napi-rs/canvas");
      const pdfPage = libDoc.getPage(pageNumber - 1);
      const resources = pdfPage.node.Resources();
      const xobjRef = resources?.get(PDFName.of("XObject"));
      const xobj = xobjRef
        ? xobjRef instanceof PDFDict
          ? xobjRef
          : libDoc.context.lookupMaybe(xobjRef as PDFRef, PDFDict)
        : undefined;
      if (!xobj) throw new PageImageNotExtractableError("page has no XObject resources");

      // Pick the largest image XObject on the page (scanned reports are
      // single-image pages; smaller images are logos/stamps).
      let best: { stream: PDFRawStream; size: number } | null = null;
      for (const [, value] of xobj.entries()) {
        const resolved = (value instanceof PDFRef ? libDoc.context.lookup(value) : value) as unknown;
        if (!(resolved instanceof PDFRawStream)) continue;
        const subtype = resolved.dict.get(PDFName.of("Subtype"))?.toString();
        if (subtype !== "/Image") continue;
        const size = resolved.contents.length;
        if (!best || size > best.size) best = { stream: resolved, size };
      }
      if (!best) throw new PageImageNotExtractableError("no embedded image on page");

      const { stream } = best;
      const filterNames = imageFilters(stream.dict.get(PDFName.of("Filter")));
      let decoded: { width: number; height: number; draw(ctx: import("@napi-rs/canvas").SKRSContext2D): void };
      if (filterNames.includes("DCTDecode")) {
        const img = await loadImage(Buffer.from(stream.contents));
        decoded = { width: img.width, height: img.height, draw: (ctx) => ctx.drawImage(img, 0, 0) };
      } else if (filterNames.includes("FlateDecode")) {
        decoded = decodeFlateImage(stream.dict, stream.contents);
      } else {
        throw new PageImageNotExtractableError(`unsupported image filter: ${filterNames.join(",") || "none"}`);
      }

      // Cap raster dimensions (decompression-bomb safety).
      const scale = Math.min(1, maxDimensionPx / Math.max(decoded.width, decoded.height));
      const outW = Math.max(1, Math.round(decoded.width * scale));
      const outH = Math.max(1, Math.round(decoded.height * scale));
      const canvas = createCanvas(outW, outH);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, outW, outH);
      decoded.draw(ctx);
      const png = Buffer.from(canvas.toBuffer("image/png"));
      return {
        png,
        width: outW,
        height: outH,
        source: scale < 1 ? "embedded_image_rescaled" : "embedded_image",
        image_encoding: filterNames.includes("DCTDecode") ? "DCTDecode" : "FlateDecode",
      };
    },
    async destroy() {
      await doc.destroy();
    },
  };
}

function imageFilters(filter: unknown): string[] {
  if (filter instanceof PDFName) return [filter.toString().replace(/^\//, "")];
  if (filter instanceof PDFArray) {
    return filter.asArray().map((f) => (f instanceof PDFName ? f.toString().replace(/^\//, "") : "")).filter(Boolean);
  }
  return [];
}

/**
 * Reconstructs a FlateDecode (zlib) image bitmap for 8-bit gray/RGB images,
 * including PNG-style row predictors (Predictor 15). Anything else is
 * rejected with an error - never guessed.
 */
function decodeFlateImage(dict: PDFDict, contents: Uint8Array): { width: number; height: number; draw(ctx: import("@napi-rs/canvas").SKRSContext2D): void } {
  const num = (key: string): number | undefined => {
    const v = dict.get(PDFName.of(key));
    return v ? Number(v.toString().replace(/^\//, "")) : undefined;
  };
  const width = num("Width") ?? num("W");
  const height = num("Height") ?? num("H");
  const bpc = num("BitsPerComponent") ?? num("BPC") ?? 8;
  const cs = dict.get(PDFName.of("ColorSpace"))?.toString().replace(/^\//, "") ?? "";
  const components =
    cs === "DeviceGray" || cs === "CalGray" || cs === "G" ? 1 :
    cs === "DeviceRGB" || cs === "RGB" ? 3 :
    undefined; // ICCBased/Indexed/CMYK are deliberately NOT guessed - fail closed
  if (!width || !height || bpc !== 8 || !components) {
    throw new PageImageNotExtractableError(`unsupported bitmap (cs=${cs} bpc=${bpc})`);
  }

  const predictor = num("Predictor") ?? 1;
  const inflated = zlib.inflateSync(Buffer.from(contents));
  const rowBytes = width * components;
  let raw: Buffer;
  if (predictor >= 10) {
    raw = unfilterPngRows(inflated, rowBytes, height);
  } else if (predictor === 1 || predictor === 2) {
    raw = inflated.subarray(0, rowBytes * height);
    if (raw.length < rowBytes * height) throw new PageImageNotExtractableError("truncated image data");
  } else {
    throw new PageImageNotExtractableError(`unsupported predictor ${predictor}`);
  }

  return {
    width,
    height,
    draw(ctx) {
      // Build RGBA ImageData from the raw samples.
      const rgba = Buffer.alloc(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        if (components === 3) {
          rgba[i * 4] = raw[i * 3];
          rgba[i * 4 + 1] = raw[i * 3 + 1];
          rgba[i * 4 + 2] = raw[i * 3 + 2];
        } else {
          rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = raw[i];
        }
        rgba[i * 4 + 3] = 255;
      }
      ctx.putImageData({ data: new Uint8ClampedArray(rgba), width, height }, 0, 0);
    },
  };
}

function libLookupN(entry: unknown): number | undefined {
  // entry is a Ref to the ICC stream; resolving it here would duplicate the
  // lookup machinery, so we accept only inline N - uncommon but safe.
  return undefined;
}

function unfilterPngRows(data: Buffer, rowBytes: number, height: number): Buffer {
  const stride = rowBytes + 1;
  if (data.length < stride * height) throw new PageImageNotExtractableError("truncated predicted image data");
  const out = Buffer.alloc(rowBytes * height);
  const bpp = 1; // 8 bits per component => 1 byte per component (PNG bpp parameter)
  for (let y = 0; y < height; y++) {
    const filter = data[y * stride];
    const row = data.subarray(y * stride + 1, y * stride + 1 + rowBytes);
    const prev = y > 0 ? out.subarray((y - 1) * rowBytes, y * rowBytes) : Buffer.alloc(rowBytes);
    const cur = out.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      const val = row[x];
      switch (filter) {
        case 0: cur[x] = val; break;
        case 1: cur[x] = (val + a) & 0xff; break;
        case 2: cur[x] = (val + b) & 0xff; break;
        case 3: cur[x] = (val + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          cur[x] = (val + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: throw new PageImageNotExtractableError(`bad PNG filter ${filter}`);
      }
    }
  }
  return out;
}

export type { PageExtraction };
