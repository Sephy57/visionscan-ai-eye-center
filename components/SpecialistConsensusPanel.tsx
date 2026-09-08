"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth/clientFetch";
import { Badge } from "@/components/ui";

type Summary = {
  specialty_id: string;
  capability_id: string | null;
  outcome: "COMPLETED" | "FAILED" | "NO_VALIDATED_MODEL_AVAILABLE";
  findings_count: number;
  possible_conditions_count: number;
  quality_status: string;
  ood_status: string;
  validation_status: string;
  failure_state: string | null;
  limitations: string[];
};

type Consensus = {
  status: "NO_SPECIALIST_OUTPUT" | "REVIEW_REQUIRED";
  specialty_summaries: Summary[];
  shared_evidence_ids: string[];
  disagreements: Array<{ capability_id: string; finding_type: string; difference_description: string; requires_clinician_review: true }>;
  missing_confirmation: string[];
  urgent_issues: string[];
  requires_clinician_review: true;
  note: string;
};

type EvidencePackage = {
  specialty: string;
  model_status: string;
  observed_findings: Array<{ category: string; laterality: string; summary: string }>;
  supporting_evidence: Array<{ evidence_id: string; source_type: string; category: string; laterality: string; summary: string }>;
  contradicting_evidence: Array<{ evidence_id: string; source_type: string; category: string; laterality: string; summary: string }>;
  missing_evidence: string[];
  possible_conditions: Array<{ canonical_name: string; laterality: string; state: string; note: string }>;
  urgency_notes: string[];
  limitations: string[];
};

export default function SpecialistConsensusPanel({ studyId }: { studyId: string }) {
  const [consensus, setConsensus] = useState<Consensus | null>(null);
  const [packages, setPackages] = useState<EvidencePackage[]>([]);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await authFetch(`/api/studies/${encodeURIComponent(studyId)}/specialist-analysis`);
      if (cancelled) return;
      if (!response.ok) { setUnavailable(true); return; }
      const body = await response.json() as { specialist_consensus?: Consensus | null; specialist_packages?: EvidencePackage[] };
      setConsensus(body.specialist_consensus ?? null);
      setPackages(body.specialist_packages ?? []);
    })();
    return () => { cancelled = true; };
  }, [studyId]);

  if (unavailable || !consensus) return null;
  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="card-title">
        <h3 style={{ fontSize: "0.9rem" }}>MULTI-SPECIALIST CONSENSUS</h3>
        <Badge tone={consensus.status === "REVIEW_REQUIRED" ? "warn" : "neutral"}>{consensus.status.replaceAll("_", " ")}</Badge>
      </div>
      <p className="tiny muted" style={{ marginTop: 0 }}>{consensus.note}</p>
      {consensus.urgent_issues.length > 0 && (
        <div className="alert danger" role="alert">
          <div className="alert-body"><strong>Specialist output blocked</strong><div>{consensus.urgent_issues.join("; ")}</div></div>
        </div>
      )}
      <div style={{ display: "grid", gap: 6 }}>
        {consensus.specialty_summaries.map((summary) => (
          <div key={summary.specialty_id} style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
            <div className="small" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <strong>{summary.specialty_id.replaceAll("_", " ")}</strong>
              <Badge tone={summary.outcome === "COMPLETED" ? "info" : summary.outcome === "FAILED" ? "bad" : "neutral"}>{summary.outcome.replaceAll("_", " ")}</Badge>
              <span className="tiny muted">{summary.findings_count} finding(s) · {summary.possible_conditions_count} possible association(s)</span>
            </div>
            {summary.failure_state && <div className="tiny muted">{summary.failure_state.replaceAll("_", " ")}</div>}
          </div>
        ))}
      </div>
      {consensus.disagreements.length > 0 && (
        <div className="alert warn" style={{ marginTop: 10 }}>
          <div className="alert-body">
            <strong>DISAGREEMENT — NO WINNER SELECTED</strong>
            {consensus.disagreements.map((d, i) => <div key={i} className="tiny">{d.capability_id} / {d.finding_type}: {d.difference_description}</div>)}
          </div>
        </div>
      )}
      {consensus.missing_confirmation.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="small" style={{ cursor: "pointer", fontWeight: 650 }}>Missing confirmation ({consensus.missing_confirmation.length})</summary>
          <ul className="tiny muted" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {consensus.missing_confirmation.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </details>
      )}
      {packages.length > 0 && (
        <details style={{ marginTop: 12 }} open>
          <summary className="small" style={{ cursor: "pointer", fontWeight: 650 }}>Specialist evidence packages ({packages.length})</summary>
          <p className="tiny muted" style={{ margin: "6px 0" }}>Deterministic hand-offs over documented tests, symptoms, and research observations. No package is a diagnosis.</p>
          <div style={{ display: "grid", gap: 8 }}>
            {packages.map((p) => (
              <div key={p.specialty} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <div className="small" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <strong>{p.specialty.replaceAll("_", " ")}</strong><Badge tone={p.model_status === "NO_VALIDATED_MODEL_AVAILABLE" ? "neutral" : "warn"}>{p.model_status.replaceAll("_", " ")}</Badge>
                </div>
                {p.observed_findings.length > 0 && <div className="tiny">Observed: {p.observed_findings.map((f) => `${f.category} (${f.laterality})`).join(" · ")}</div>}
                {p.contradicting_evidence.length > 0 && <div className="tiny" style={{ color: "var(--warn, #a05a00)" }}>Conflicts: {p.contradicting_evidence.map((e) => `${e.category} (${e.laterality})`).join(" · ")}</div>}
                <div className="tiny muted">Missing: {p.missing_evidence.join("; ")}</div>
                <div className="tiny muted">{p.urgency_notes.join(" ")}</div>
              </div>
            ))}
          </div>
        </details>
      )}
      <p className="tiny muted" style={{ marginBottom: 0 }}>Independent symptom triage and clinician final assessment remain authoritative. This panel never confirms a diagnosis.</p>
    </div>
  );
}
