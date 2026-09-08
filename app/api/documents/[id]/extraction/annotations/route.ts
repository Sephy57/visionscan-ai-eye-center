import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth/rbac";
import {
  annotateExtractionItem,
  ExtractionItemCategory,
  AnnotationAction,
} from "@/lib/documents/extraction/recordExtractionStore";
import { requireDocumentScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES: ExtractionItemCategory[] = [
  "symptoms",
  "medications",
  "allergies",
  "systemic_candidates",
  "explicit_negations",
  "source_document_diagnoses",
  "ocular_history_candidates",
  "family_history_candidates",
  "exam_findings",
  "plan_candidates",
  "follow_up_candidates",
];
const ACTIONS: AnnotationAction[] = ["VERIFY", "CORRECT", "REJECT"];

/**
 * Clinician verification of an extracted item (eye-center workspace).
 *
 * POST { category, item_id, action: VERIFY|CORRECT|REJECT, note?, corrected_value? }
 *
 * - VERIFY  marks the item VERIFIED_BY_CLINICIAN (provenance records who/when).
 * - CORRECT applies ONLY the category's mutable fields; the original raw
 *   text stays intact and the correction is recorded as an annotation.
 * - REJECT  marks the item REJECTED_BY_CLINICIAN; it stays for audit but
 *   downstream consumers must filter it out.
 *
 * The original extraction is never overwritten wholesale; corrections
 * create provenance (handoff §26).
 */
export function POST(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function POST(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function POST(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN"]);
  if (denied) return denied;
  const scoped = await requireDocumentScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Document extraction or item not found" }, { status: 404 });
  const { user } = await requireSession(req);

  try {
    const body = await req.json();
    const category = body?.category as ExtractionItemCategory;
    const action = body?.action as AnnotationAction;
    const itemId = typeof body?.item_id === "string" ? body.item_id : "";

    if (!CATEGORIES.includes(category)) {
      return NextResponse.json({ error: "Unknown category" }, { status: 400 });
    }
    if (!ACTIONS.includes(action)) {
      return NextResponse.json({ error: "action must be VERIFY, CORRECT or REJECT" }, { status: 400 });
    }
    if (!itemId) {
      return NextResponse.json({ error: "item_id is required" }, { status: 400 });
    }
    if (action === "CORRECT" && (!body?.corrected_value || typeof body.corrected_value !== "object")) {
      return NextResponse.json({ error: "corrected_value object is required for CORRECT" }, { status: 400 });
    }

    const updated = await annotateExtractionItem(params.id, {
      category,
      item_id: itemId,
      action,
      by: user?.username ?? "unknown",
      note: typeof body?.note === "string" ? body.note.slice(0, 500) : null,
      corrected_value: action === "CORRECT" ? body.corrected_value : null,
    });
    if (!updated) {
      return NextResponse.json({ error: "Document extraction or item not found" }, { status: 404 });
    }
    return NextResponse.json({ extraction: updated });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
