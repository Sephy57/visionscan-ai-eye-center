import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { validateSession, SESSION_COOKIE } from "@/lib/auth/sessions";
import { recordConsent, withdrawConsent, listConsentForStudy, ConsentPurpose, ConsentType } from "@/lib/consent/consent";
import { requireStudyScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PURPOSES: ConsentPurpose[] = [
  "screening_analysis", "research_use", "data_retention", "treatment_information",
  "CLINICAL_RESEARCH_ANALYSIS", "DOCUMENT_EXTRACTION", "IMAGE_MODEL_ANALYSIS",
  "RESEARCH_DATASET_USE", "EXPORT", "MODEL_VALIDATION",
];
const TYPES: ConsentType[] = ["explicit", "implied", "broad", "specific"];

export function GET(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function GET(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;
  const scoped = await requireStudyScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const records = await listConsentForStudy(params.id);
  return NextResponse.json({ consent: records });
}

export function POST(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function POST(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function POST(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "TECHNICIAN"]);
  if (denied) return denied;
  const scoped = await requireStudyScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { purpose?: string; consentType?: string; subjectRef?: string } | null;
  if (!body?.purpose || !PURPOSES.includes(body.purpose as ConsentPurpose)) {
    return NextResponse.json({ error: `purpose must be one of ${PURPOSES.join(", ")}` }, { status: 400 });
  }
  if (!body?.consentType || !TYPES.includes(body.consentType as ConsentType)) {
    return NextResponse.json({ error: `consentType must be one of ${TYPES.join(", ")}` }, { status: 400 });
  }
  const check = await validateSession(req.cookies.get(SESSION_COOKIE)?.value);
  try {
    const rec = await recordConsent({
      studyId: params.id, subjectRef: body.subjectRef ?? null,
      purpose: body.purpose as ConsentPurpose, consentType: body.consentType as ConsentType,
      status: "GRANTED", actor: check.session!.username,
    });
    return NextResponse.json({ consent: rec }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    if (code === "CONSENT_SUBJECT_MISMATCH" || code === "CONSENT_SUBJECT_UNBOUND") {
      return NextResponse.json({ error: code, message: "Consent subject must match the study's server-bound patient identity." }, { status: 400 });
    }
    return NextResponse.json({ error: "CONSENT_RECORD_FAILED" }, { status: 500 });
  }
}

export function DELETE(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function DELETE(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN"]);
  if (denied) return denied;
  const scoped = await requireStudyScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { consentId?: string; reason?: string } | null;
  if (!body?.consentId) return NextResponse.json({ error: "consentId is required" }, { status: 400 });
  const check = await validateSession(req.cookies.get(SESSION_COOKIE)?.value);
  const scopedRecords = await listConsentForStudy(params.id);
  if (!scopedRecords.some((record) => record.consentId === body.consentId)) {
    return NextResponse.json({ error: "Consent record not found" }, { status: 404 });
  }
  const rec = await withdrawConsent(body.consentId, check.session!.username, body.reason ?? "Not specified");
  if (!rec) return NextResponse.json({ error: "Consent record not found" }, { status: 404 });
  return NextResponse.json({ consent: rec });
}
