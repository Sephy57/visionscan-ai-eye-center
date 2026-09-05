// OCR warmup: pre-downloads the tesseract.js language data into
// data\ocr\tessdata so runtime OCR (and tests) never need network.
// Usage: npm run ocr:warmup
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tessdata = process.env.OCR_TESSDATA_PATH || path.join(root, "data", "ocr", "tessdata");
fs.mkdirSync(tessdata, { recursive: true });

const { createWorker } = await import("tesseract.js");
const { createCanvas } = await import("@napi-rs/canvas");
console.log(`[ocr:warmup] downloading/caching 'eng' language data -> ${tessdata}`);
const worker = await createWorker("eng", 1, { cachePath: tessdata, logger: () => {} });
// Small valid PNG (drawn locally) so the worker initializes the language model fully.
const canvas = createCanvas(120, 40);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#ffffff";
ctx.fillRect(0, 0, 120, 40);
ctx.fillStyle = "#000000";
ctx.font = "24px sans-serif";
ctx.fillText("warmup", 8, 28);
await worker.recognize(canvas.toBuffer("image/png"));
await worker.terminate();
const files = fs.readdirSync(tessdata).filter((f) => f.includes("traineddata"));
console.log(`[ocr:warmup] ready. cached: ${files.join(", ") || "(none - check network on first run)"}`);
