import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { uploadDocument } from "@/lib/documents/service";
import { listDocumentsByStudy } from "@/lib/documents/repository";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents/constants";
import { audit } from "@/lib/audit";
import { requireStudyScope } from "@/lib/auth/scope";
import { enqueueExtraction } from "@/lib/jobs/queue";
import { checkProcessingConsent, consentRequiredPayload, PROCESSING_CONSENT_PURPOSES } from "@/lib/consent/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * S1 document ingestion for a study.
 *   POST - upload a PDF (ADMIN, CLINICIAN, TECHNICIAN)
 *   GET  - list the study's documents (ADMIN, CLINICIAN, REVIEWER, TECHNICIAN)
 * RESEARCHER is intentionally excluded everywhere: documents may contain PHI.
 * Least privilege: TECHNICIAN can upload and see status but never fetch the
 * file bytes (see /api/documents/[id]/file).
 */

const UPLOAD_ROLES = ["ADMIN", "CLINICIAN", "TECHNICIAN"] as const;
const VIEW_ROLES = ["ADMIN", "CLINICIAN", "REVIEWER", "TECHNICIAN"] as const;

export function POST(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function POST(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function POST(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, [...UPLOAD_ROLES]);
  if (denied) return denied;
  const scoped = await requireStudyScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const consent = await checkProcessingConsent(params.id, PROCESSING_CONSENT_PURPOSES.documentExtraction);
  if (!consent.ok) return NextResponse.json(consentRequiredPayload(consent), { status: 403 });
  const username = req.cookies.get("vsa_session") ? await getUsername(req) : "unknown";

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "NO_FILE", message: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      return NextResponse.json({ error: "TOO_LARGE", message: `Document exceeds maximum size (${Math.round(MAX_DOCUMENT_BYTES / 1048576)} MB)` }, { status: 413 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const outcome = await uploadDocument(params.id, file.name, file.type || "", bytes, username);
    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.error_code, message: outcome.error, detail: undefined },
        { status: outcome.httpStatus }
      );
    }
    // Accepted browser/API uploads enter the extraction queue immediately.
    // The queue is fire-and-forget but its id is returned so clients can poll
    // the existing job endpoint. Duplicate uploads do not start a second
    // extraction generation.
    if (outcome.httpStatus === 201 && outcome.document?.document_id) {
      const extractionJob = await enqueueExtraction(outcome.document.document_id, params.id);
      return NextResponse.json(
        { document: outcome.document, duplicate: false, extraction_job_id: extractionJob.job_id, extraction_status: extractionJob.status },
        { status: outcome.httpStatus }
      );
    }
    return NextResponse.json(
      { document: outcome.document, duplicate: outcome.duplicate ?? false },
      { status: outcome.httpStatus }
    );
  } catch {
    await audit({ actor: "user", action: "document.upload_started", outcome: "error", resource: "document", studyId: params.id, detail: "malformed multipart upload" });
    return NextResponse.json({ error: "INVALID_DOCUMENT", message: "Malformed upload" }, { status: 400 });
  }
}

export function GET(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function GET(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, [...VIEW_ROLES]);
  if (denied) return denied;
  const scoped = await requireStudyScope(req, params.id);
  if (scoped.response) return scoped.response;
  // Preserve the existing poll/list contract for an unknown study: an empty
  // list does not disclose whether a guessed study exists. Mutating upload
  // above remains fail-closed with 404.
  if (!scoped.resource) return NextResponse.json({ documents: [] });
  const documents = await listDocumentsByStudy(params.id);
  return NextResponse.json({ documents });
}

async function getUsername(req: NextRequest): Promise<string> {
  // Lightweight identity readout for provenance (requireRole already
  // validated the session; this just extracts the username for the record).
  const { requireSession } = await import("@/lib/auth/rbac");
  const { user } = await requireSession(req);
  return user?.username ?? "unknown";
}
