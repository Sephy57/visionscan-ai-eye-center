import { createRequire } from "module";
import { OCRProvider, OcrContext, OcrResult, ExtractionTimeoutError } from "./types";
import { OCR_TESSDATA_PATH, MAX_OCR_TIME_MS } from "../constants";

/**
 * Tesseract.js OCR provider (S2). Local WASM OCR in a worker — no cloud, no
 * PHI leaves the machine. Language data is cached under data\ocr\tessdata
 * (env OCR_TESSDATA_PATH). Every result is UNCERTAIN EXTRACTED DATA with
 * engine confidence attached; callers must treat it as unverified.
 *
 * The worker is lazily created and reused across pages; release() terminates
 * it. Per-page timeouts are enforced via a race + worker terminate/recreate.
 */

interface TesseractWorker {
  recognize(image: Buffer | string): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<void>;
}

type TesseractModule = {
  createWorker(langs?: string, oem?: number, options?: Record<string, unknown>): Promise<TesseractWorker>;
  OEM?: { LSTM_ONLY?: number };
  version?: string;
};

const require = createRequire(import.meta.url);

function tesseractVersion(): string {
  try {
    const pkg = require("tesseract.js/package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export class TesseractOcrProvider implements OCRProvider {
  readonly name = "tesseract.js";
  private workerPromise: Promise<TesseractWorker> | null = null;
  private readonly language: string;
  private readonly version = tesseractVersion();

  constructor(language = "eng") {
    this.language = language;
  }

  private async getWorker(): Promise<TesseractWorker> {
    if (!this.workerPromise) {
      this.workerPromise = (async () => {
        const tesseract = require("tesseract.js") as TesseractModule;
        const options: Record<string, unknown> = {
          logger: () => {}, // silence per-op logs; they could carry recognized text
        };
        if (OCR_TESSDATA_PATH) options.cachePath = OCR_TESSDATA_PATH;
        const oem = tesseract.OEM?.LSTM_ONLY ?? 1;
        return tesseract.createWorker(this.language, oem, options);
      })();
    }
    return this.workerPromise;
  }

  async recognize(png: Buffer, ctx: OcrContext): Promise<OcrResult> {
    const started = Date.now();
    const timeoutMs = Math.min(ctx.timeoutMs || MAX_OCR_TIME_MS, MAX_OCR_TIME_MS);
    const worker = await this.getWorker();
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        worker.recognize(png),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ExtractionTimeoutError()), timeoutMs);
        }),
      ]);
      const data = (result as { data: { text: string; confidence: number } }).data;
      const text = String(data.text ?? "").replace(/\s+/g, " ").trim();
      return {
        text,
        confidence: Math.max(0, Math.min(100, Number(data.confidence ?? 0))),
        engine: this.name,
        engine_version: this.version,
        language: this.language,
        time_ms: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof ExtractionTimeoutError) {
        // A wedged worker cannot be reused safely: terminate and recreate next time.
        this.workerPromise = null;
        void worker.terminate().catch(() => {});
        throw err;
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async release(): Promise<void> {
    const workerPromise = this.workerPromise;
    this.workerPromise = null;
    if (workerPromise) {
      try {
        const worker = await workerPromise;
        await worker.terminate();
      } catch {
        /* already gone */
      }
    }
  }
}

/** Factory (swappability seam; tests inject mock providers instead). */
export function createDefaultOcrProvider(): OCRProvider {
  return new TesseractOcrProvider();
}
