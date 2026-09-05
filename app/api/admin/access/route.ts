import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth/rbac";
import {
  grantPatientAccess,
  revokePatientAccess,
  listPatientAccessGrants,
} from "@/lib/auth/scope";
import { getUserById } from "@/lib/auth/users";
import { getPatient } from "@/lib/patients/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ADMIN-only patient/tenant assignment management.  Access grants are
 * additive and auditable; they are the explicit care-team boundary used by
 * patient-bound resource routes.  This endpoint never returns clinical data.
 */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  const userId = req.nextUrl.searchParams.get("user_id") ?? undefined;
  const patientId = req.nextUrl.searchParams.get("patient_id") ?? undefined;
  const grants = await listPatientAccessGrants({ user_id: userId, patient_id: patientId });
  return NextResponse.json({ grants });
}

export async function POST(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  const { user } = await requireSession(req);
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    user_id?: string;
    tenant_id?: string | null;
    patient_id?: string | null;
    patient_ref?: string | null;
  } | null;
  if (!body?.user_id || (!body.tenant_id && !body.patient_id && !body.patient_ref)) {
    return NextResponse.json({ error: "user_id and at least one of tenant_id, patient_id, patient_ref are required" }, { status: 400 });
  }
  if (!(await getUserById(body.user_id))) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (body.patient_id && !(await getPatient(body.patient_id))) {
    return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  }
  const grant = await grantPatientAccess({
    user_id: body.user_id,
    tenant_id: body.tenant_id,
    patient_id: body.patient_id,
    patient_ref: body.patient_ref,
    granted_by: `user:${user.username}`,
  });
  if (!grant) return NextResponse.json({ error: "Invalid access grant" }, { status: 400 });
  return NextResponse.json({ grant }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  const { user } = await requireSession(req);
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { access_id?: string } | null;
  if (!body?.access_id) return NextResponse.json({ error: "access_id is required" }, { status: 400 });
  const revoked = await revokePatientAccess(body.access_id, `user:${user.username}`);
  if (!revoked) return NextResponse.json({ error: "Access grant not found" }, { status: 404 });
  return NextResponse.json({ revoked: true });
}

