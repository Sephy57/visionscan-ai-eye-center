import { NextRequest, NextResponse } from "next/server";
import { evaluate, symptomStratifiedEvaluation, BinaryCase } from "@/lib/research/metrics";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Research-only performance evaluation endpoint.
 * POST { cases: BinaryCase[], stratify_by_symptoms?: boolean }
 * -> full metric report (no "accuracy" headline), optional symptom-stratified analysis.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const cases: BinaryCase[] = body?.cases;
    if (!Array.isArray(cases) || cases.length === 0) {
      return NextResponse.json({ error: "cases array required" }, { status: 400 });
    }
    for (const c of cases) {
      if (typeof c.case_id !== "string" || ![0, 1].includes(c.y_true) || ![0, 1].includes(c.y_pred)) {
        return NextResponse.json({ error: "Each case requires case_id, y_true (0|1), y_pred (0|1)" }, { status: 400 });
      }
    }
    await audit({ actor: "research", action: "evaluate", outcome: "ok", detail: `${cases.length} cases evaluated` });
    if (body?.stratify_by_symptoms === true) {
      return NextResponse.json({
        overall: evaluate(cases),
        symptom_stratified: symptomStratifiedEvaluation(cases),
      });
    }
    return NextResponse.json(evaluate(cases));
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
