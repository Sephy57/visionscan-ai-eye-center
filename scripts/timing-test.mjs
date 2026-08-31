// Times each stage of the upload -> symptom -> analyze flow to find slowness.
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "http://localhost:3000";
const tmp = path.join(root, "data", "tmp");

const t0 = Date.now();
const dt = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;

// Simulate a realistic large photo (12 MB-ish)
const svg = '<svg width="1024" height="768"><rect width="1024" height="768" fill="#7a1f1f"/></svg>';
const base = await sharp(Buffer.from(svg)).resize(2000, 1500).png().toBuffer();
const big = await sharp(base).jpeg({ quality: 95 }).toBuffer();
// Pad to ~12 MB by embedding extra data? JPEG size is what it is; report actual.
console.log(`[${dt()}] test image: ${(big.length / 1048576).toFixed(1)} MB`);

const fd = new FormData();
fd.set("file", new Blob([big]), "timing-test.jpg");
fd.set("scanType", "fundus");
fd.set("eye", "OD");
const upT = Date.now();
const up = await fetch(`${BASE}/api/upload`, { method: "POST", body: fd });
const upj = await up.json();
console.log(`[${dt()}] upload: status=${up.status} (${((Date.now() - upT) / 1000).toFixed(2)}s)`, upj.study_id ?? JSON.stringify(upj));

const anT = Date.now();
const an = await fetch(`${BASE}/api/analyze`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ study_id: upj.study_id }),
});
const anj = await an.json();
console.log(`[${dt()}] analyze: status=${an.status} (${((Date.now() - anT) / 1000).toFixed(2)}s)`, JSON.stringify(anj).slice(0, 160));

const del = await fetch(`${BASE}/api/studies/${upj.study_id}`, { method: "DELETE" });
console.log(`[${dt()}] cleanup: ${del.status}`);
