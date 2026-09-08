"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth/clientFetch";
import { Badge } from "@/components/ui";

type Agreement = "CROSS_MODALITY_CORROBORATION" | "CROSS_MODALITY_DISAGREEMENT" | "NOT_COMPARABLE";

interface Pair {
  agreement: Agreement;
  notComparableReason: string | null;
  fundus_study_id: string | null;
  oct_study_id: string | null;
  eye: string;
  pattern: string | null;
  fundusSignal: { lesionPositive: boolean; diabeticLesionTypes: string[]; drGrade: number | null; drReferable: boolean | null } | null;
  octSignal: { octClass: string | null; octPositive: boolean } | null;
  notes: string[];
  evidenceRefs: { fundusFindingIds: string[]; octFindingIds: string[] };
}

interface Assessment {
  pairs: Pair[];
  excluded_study_ids: string[];
  notes: string[];
  notice?: string;
}

function tone(agreement: Agreement): "ok" | "warn" | "bad" {
  if (agreement === "CROSS_MODALITY_CORROBORATION") return "ok";
  if (agreement === "CROSS_MODALITY_DISAGREEMENT") return "warn";
  return "bad";
}

/**
 * Encounter-level cross-modality evidence panel. It deliberately exposes
 * categorical outputs and evidence references only: scores/logits are never
 * fused and a disagreement never picks an automatic winner.
 */
export default function CrossModalityPanel({ encounterId }: { encounterId: string }) {
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await authFetch(`/api/encounters/${encodeURIComponent(encounterId)}/cross-modality`);
        if (!response.ok) { if (!cancelled) setError(true); return; }
        const json = await response.json() as Assessment;
        if (!cancelled) setAssessment(json);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [encounterId]);

  if (error) {
    return <p className="tiny muted" role="status" style={{ margin: "8px 0 0" }}>Cross-modality comparison is unavailable or not authorized for this encounter.</p>;
  }
  if (!assessment) return <p className="tiny muted" role="status" style={{ margin: "8px 0 0" }}>Loading same-eye cross-modality evidence…</p>;

  return (
    <div className="card" style={{ margin: "10px 0 0", background: "var(--surface-2, #fafbfc)" }}>
      <div className="card-title" style={{ marginBottom: 4 }}>
        <h3 style={{ fontSize: "0.9rem", margin: 0 }}>Cross-modality evidence</h3>
        <Badge tone="info">FUNDUS + OCT · SAME EYE</Badge>
      </div>
      <p className="tiny muted" style={{ margin: "0 0 8px" }}>
        Categorical research comparison only. It never fuses scores, establishes a diagnosis, or claims disease progression.
      </p>

      {assessment.pairs.length === 0 && (
        <div className="alert warn" role="status" style={{ margin: 0 }}>
          <span className="alert-icon" aria-hidden="true">⚠</span>
          <div className="alert-body"><strong>NOT COMPARABLE</strong> — no same-eye analyzed FUNDUS + OCT pair is available.</div>
        </div>
      )}

      {assessment.pairs.map((pair) => (
        <div key={`${pair.fundus_study_id}-${pair.oct_study_id}`} style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Badge tone={tone(pair.agreement)}>{pair.agreement.replaceAll("_", " ")}</Badge>
            <span className="tiny muted">Eye: {pair.eye}</span>
            {pair.pattern && <span className="tiny muted">Pattern: {pair.pattern.replaceAll("_", " ")}</span>}
          </div>
          <dl className="kv tiny" style={{ gridTemplateColumns: "125px 1fr", margin: "8px 0" }}>
            <dt>Fundus study</dt><dd>{pair.fundus_study_id ?? "—"}</dd>
            <dt>OCT study</dt><dd>{pair.oct_study_id ?? "—"}</dd>
            <dt>Fundus signal</dt><dd>{pair.fundusSignal ? `${pair.fundusSignal.lesionPositive ? "target regions present" : "no target regions"}; DR grade ${pair.fundusSignal.drGrade ?? "not estimated"}` : "not available"}</dd>
            <dt>OCT signal</dt><dd>{pair.octSignal?.octClass ?? "not estimated"}</dd>
          </dl>
          {pair.notes.map((note, i) => <p key={i} className="tiny" style={{ margin: "4px 0" }}>{note}</p>)}
          <p className="tiny muted" style={{ margin: "6px 0 0" }}>
            Evidence refs: fundus findings {pair.evidenceRefs.fundusFindingIds.length}, OCT findings {pair.evidenceRefs.octFindingIds.length}.
            {pair.notComparableReason ? ` Reason: ${pair.notComparableReason.replaceAll("_", " ")}.` : " No automatic winner."}
          </p>
        </div>
      ))}

      {assessment.excluded_study_ids.length > 0 && (
        <p className="tiny muted" style={{ margin: "8px 0 0" }}>
          Excluded for patient-reference mismatch: {assessment.excluded_study_ids.join(", ")}.
        </p>
      )}
      {assessment.notes.map((note, i) => <p key={`note-${i}`} className="tiny muted" style={{ margin: "6px 0 0" }}>{note}</p>)}
    </div>
  );
}

