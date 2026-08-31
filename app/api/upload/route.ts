import { NextRequest, NextResponse } from "next/server";
import { createStudy } from "@/lib/studies/service";
import { normalizeMime, SUPPORTED_MIME, detectDicom } from "@/lib/imaging/dicom";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { ScanType, EyeLaterality, DeviceMetadata } from "@/lib/devices/adapter";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCAN_TYPES: ScanType[] = [
  "fundus", "retinal_photo", "oct", "octa", "faf", "ffa", "icg",
  "slit_lamp", "external_eye", "optic_nerve", "macula", "unknown",
];

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: `File exceeds maximum size (${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB)` }, { status: 413 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const ext = file.name.slice(file.name.lastIndexOf(".")) || "";
    const mime = normalizeMime(file.type || "", ext);

    const isDicom = detectDicom(bytes).isDicom;
    if (!SUPPORTED_MIME.has(mime) && !isDicom) {
      await audit({ actor: "user", action: "upload", outcome: "rejected", detail: `unsupported type ${mime}` });
      return NextResponse.json({ error: `Unsupported file type: ${mime}. Supported: JPEG, PNG, WEBP (DICOM is detected but not yet analyzable).` }, { status: 415 });
    }

    const scanTypeRaw = String(form.get("scanType") ?? "unknown");
    const scanType: ScanType = SCAN_TYPES.includes(scanTypeRaw as ScanType) ? (scanTypeRaw as ScanType) : "unknown";
    const eyeRaw = String(form.get("eye") ?? "unknown");
    const eye: EyeLaterality = eyeRaw === "OD" || eyeRaw === "OS" ? eyeRaw : "unknown";
    const manufacturer = String(form.get("manufacturer") ?? "").trim() || undefined;
    const model = String(form.get("deviceModel") ?? "").trim() || undefined;
    const scanDateTime = String(form.get("scanDateTime") ?? "").trim() || undefined;

    const declared: DeviceMetadata = {
      scanType,
      eye,
      manufacturer,
      model,
      scanDateTime,
      providedBy: manufacturer || model ? "user" : "none",
    };

    const study = await createStudy(file.name, mime, bytes, declared);
    return NextResponse.json({ study_id: study.study_id, status: study.status, sha256: study.original_sha256 }, { status: 201 });
  } catch (err) {
    await audit({ actor: "user", action: "upload", outcome: "error", detail: String(err).slice(0, 200) });
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
