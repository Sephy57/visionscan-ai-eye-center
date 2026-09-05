"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { authFetch } from "@/lib/auth/clientFetch";

/**
 * S5: read-only, non-clinical evidence workspace panel. Renders the
 * EvidenceWorkspace produced by lib/evidence/synthesize.ts - a
 * cross-source (symptoms, source-document claims, history, extracted test
 * results, medications/allergies, and AI findings) view with
 * provenance and conflict/condition-pattern organization. This is NEVER a
 * diagnosis, NEVER a probability, and is entirely separate from the
 * analysis/triage result shown elsewhere on this page.
 */

type SourceType = "IMAGE" | "PDF" | "SOURCE_DOCUMENT_DIAGNOSIS" | "TEST_RESULT" | "SYMPTOM" | "HISTORY" | "MEDICATION" | "ALLERGY" | "CLINICIAN_OBSERVATION" | "AI_FINDING";
type Laterality = "OD" | "OS" | "OU" | "UNKNOWN";
type TrustLevel = "UNVERIFIED" | "AUTO_EXTRACTED" | "HUMAN_VERIFIED" | "CLINICIAN_ENTERED" | "VALIDATED_AI_FINDING" | "REJECTED";
type ConditionState = "POSSIBLE_CONDITION" | "SUPPORTED_CONDITION" | "INSUFFICIENT_EVIDENCE" | "CONFLICTING_EVIDENCE" | "UNABLE_TO_ASSESS";

interface EvidenceProvenance {
  study_id: string;
  document_id?: string;
  result_id?: string;
  page?: number;
  source_text?: string;
  source_clinician_raw?: string;
  analysis_id?: string;
  finding_id?: string;
  extraction_method?: string;
}

interface EvidenceItem {
  id: string;
  study_id: string;
  source_type: SourceType;
  source_id: string;
  category: string;
  laterality: Laterality;
  laterality_source: string;
  value?: number;
  unit?: string;
  qualitative_finding?: string;
  presence: string;
  timestamp?: string;
  date_raw?: string;
  trust_level: TrustLevel;
  confidence?: number;
  uncertainty?: string[];
  provenance: EvidenceProvenance;
  conflict_ids: string[];
  synthetic?: boolean;
}

interface EvidenceConflict {
  id: string;
  conflict_type: "VALUE_CONFLICT" | "LATERALITY_CONFLICT" | "QUALITATIVE_CONFLICT";
  category: string;
  laterality: Laterality[];
  evidence_ids: string[];
  severity: "low" | "medium" | "high";
  resolution_state: "UNRESOLVED" | "ACKNOWLEDGED";
  note: string;
}

interface ConditionAssessment {
  condition_id: string;
  canonical_name: string;
  category: string;
  laterality: Laterality;
  state: ConditionState;
  supporting_evidence_ids: string[];
  contradicting_evidence_ids: string[];
  missing_required: string[];
  red_flag_candidates: string[];
  differential_relationships: string[];
  taxonomy_version: string;
  note: string;
}

interface EvidenceWorkspace {
  study_id: string;
  examination_context: {
    study_id: string;
    created_at: string;
    modality: string;
    eye: string;
    patient_ref?: string;
    source_count: { symptoms: number; test_results: number; ai_findings: number; source_document_diagnoses?: number; history?: number; medications?: number; allergies?: number };
  };
  evidence: EvidenceItem[];
  conflicts: EvidenceConflict[];
  possible_conditions: ConditionAssessment[];
  safety_banner: string;
  taxonomy_version: string;
  generated_at: string;
}

function trustTone(t: TrustLevel): "ok" | "warn" | "bad" | "info" | "neutral" {
  if (t === "REJECTED") return "bad";
  if (t === "HUMAN_VERIFIED" || t === "CLINICIAN_ENTERED") return "ok";
  if (t === "VALIDATED_AI_FINDING") return "info";
  return "warn";
}

function conditionTone(s: ConditionState): "ok" | "warn" | "bad" | "info" | "neutral" {
  switch (s) {
    case "SUPPORTED_CONDITION": return "warn";
    case "POSSIBLE_CONDITION": return "neutral";
    case "CONFLICTING_EVIDENCE": return "bad";
    case "INSUFFICIENT_EVIDENCE": return "neutral";
    case "UNABLE_TO_ASSESS": return "neutral";
    default: return "neutral";
  }
}

function evidenceLabel(e: EvidenceItem): string {
  const parts = [e.category.replaceAll("_", " "), e.laterality];
  if (e.value !== undefined) parts.push(`${e.value}${e.unit ? ` ${e.unit}` : ""}`);
  else if (e.qualitative_finding) parts.push(e.qualitative_finding);
  return parts.join(" · ");
}

function sourceGroupLabel(t: SourceType): string {
  switch (t) {
    case "SYMPTOM": return "Symptoms";
    case "SOURCE_DOCUMENT_DIAGNOSIS": return "Source-document diagnoses (not VisionScan diagnoses)";
    case "TEST_RESULT": return "Eye Tests";
    case "HISTORY": return "History";
    case "CLINICIAN_OBSERVATION": return "Clinician observations";
    case "MEDICATION": return "Medications";
    case "ALLERGY": return "Allergies";
    case "AI_FINDING": return "AI Findings";
    default: return t;
  }
}

function EvidenceRow({ e }: { e: EvidenceItem }) {
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6, marginTop: 6 }}>
      <div className="small">
        <strong>{e.category.replaceAll("_", " ")}</strong>
        {" · "}
        <Badge tone={e.laterality === "UNKNOWN" ? "bad" : "neutral"}>{e.laterality}</Badge>
        {e.value !== undefined && <> · {e.value}{e.unit ? ` ${e.unit}` : ""}</>}
        {e.qualitative_finding && <> · {e.qualitative_finding}</>}
        {" · "}
        <Badge tone={trustTone(e.trust_level)}>{e.trust_level.replaceAll("_", " ")}</Badge>
        {e.confidence !== undefined && (
          <span className="tiny muted">
            {" · "}
            {e.source_type === "AI_FINDING"
              ? `model confidence ${(e.confidence * 100).toFixed(0)}% (uncalibrated, not clinical confidence)`
              : `extraction confidence ${(e.confidence * 100).toFixed(0)}% (not clinical confidence)`}
          </span>
        )}
      </div>
      {(e.provenance.document_id || e.provenance.page !== undefined || e.provenance.source_text || e.provenance.analysis_id) && (
        <div className="tiny muted" style={{ wordBreak: "break-word" }}>
          {e.provenance.document_id && <>doc {e.provenance.document_id.slice(0, 12)}… </>}
          {e.provenance.page !== undefined && <>· p.{e.provenance.page} </>}
          {e.provenance.analysis_id && <>analysis {e.provenance.analysis_id.slice(0, 12)}… </>}
          {e.provenance.source_clinician_raw && <>· source clinician: {e.provenance.source_clinician_raw} </>}
          {e.provenance.source_text && <>· source: {e.provenance.source_text}</>}
        </div>
      )}
      {e.uncertainty && e.uncertainty.length > 0 && (
        <div className="tiny" style={{ color: "var(--warn, #a05a00)" }}>flags: {e.uncertainty.join(", ")}</div>
      )}
    </div>
  );
}

export default function EvidenceWorkspacePanel({ studyId }: { studyId: string }) {
  const [workspace, setWorkspace] = useState<EvidenceWorkspace | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await authFetch(`/api/studies/${encodeURIComponent(studyId)}/evidence`);
      if (cancelled) return;
      if (!res.ok) { setUnavailable(true); return; }
      const j = await res.json();
      setWorkspace(j);
    })();
    return () => { cancelled = true; };
  }, [studyId]);

  if (unavailable) return null;
  if (workspace === null) return null;
  if (workspace.evidence.length === 0 && workspace.possible_conditions.length === 0) return null;

  const byId = new Map(workspace.evidence.map((e) => [e.id, e]));
  const groups: SourceType[] = ["SYMPTOM", "SOURCE_DOCUMENT_DIAGNOSIS", "HISTORY", "CLINICIAN_OBSERVATION", "TEST_RESULT", "MEDICATION", "ALLERGY", "AI_FINDING"];

  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="card-title">
        <h3 style={{ fontSize: "0.9rem" }}>MULTI-SOURCE EVIDENCE WORKSPACE</h3>
      </div>

      <div className="alert warn" role="note" style={{ marginTop: 0 }}>
        <div className="alert-body">
          <strong>{workspace.safety_banner}</strong>
        </div>
      </div>

      <div className="kv tiny" style={{ gridTemplateColumns: "140px 1fr", marginTop: 6 }}>
        <dt>Study</dt><dd style={{ fontFamily: "var(--mono)" }}>{workspace.examination_context.study_id}</dd>
        <dt>Modality / eye</dt><dd>{workspace.examination_context.modality} · {workspace.examination_context.eye}</dd>
        <dt>Sources</dt>
        <dd>
          {workspace.examination_context.source_count.symptoms} symptoms ·{" "}
          {(workspace.examination_context.source_count.source_document_diagnoses ?? 0)} source-document diagnoses ·{" "}
          {(workspace.examination_context.source_count.history ?? 0)} history ·{" "}
          {workspace.examination_context.source_count.test_results} test results ·{" "}
          {workspace.examination_context.source_count.medications ?? 0} medications ·{" "}
          {workspace.examination_context.source_count.allergies ?? 0} allergies ·{" "}
          {workspace.examination_context.source_count.ai_findings} AI findings
        </dd>
      </div>

      {groups.map((g) => {
        const items = workspace.evidence.filter((e) => e.source_type === g);
        if (items.length === 0) return null;
        return (
          <details key={g} style={{ marginTop: 10 }} open>
            <summary className="small" style={{ cursor: "pointer", fontWeight: 650 }}>
              {sourceGroupLabel(g)} ({items.length})
            </summary>
            {items.map((e) => <EvidenceRow key={e.id} e={e} />)}
          </details>
        );
      })}

      {workspace.conflicts.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="alert danger" style={{ margin: 0 }}>
            <div className="alert-body">
              <strong>CONFLICTING EVIDENCE — HUMAN RESOLUTION REQUIRED, NO VALUE CHOSEN AUTOMATICALLY</strong>
              {workspace.conflicts.map((c) => (
                <div key={c.id} style={{ marginTop: 8, borderTop: "1px solid var(--danger-border)", paddingTop: 6 }}>
                  <div className="small">
                    <strong>{c.conflict_type.replaceAll("_", " ")}</strong> · {c.category.replaceAll("_", " ")} · {c.laterality.join("/")}
                    {" · "}<Badge tone={c.resolution_state === "ACKNOWLEDGED" ? "warn" : "bad"}>{c.resolution_state}</Badge>
                  </div>
                  <p className="tiny" style={{ margin: "2px 0" }}>{c.note}</p>
                  <ul className="tiny" style={{ margin: 0, paddingLeft: 16 }}>
                    {c.evidence_ids.map((id) => {
                      const item = byId.get(id);
                      return <li key={id}>{item ? evidenceLabel(item) : id}</li>;
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {workspace.possible_conditions.length > 0 && (
        <details style={{ marginTop: 12 }} open>
          <summary className="small" style={{ cursor: "pointer", fontWeight: 650 }}>
            Evidence-pattern associations ({workspace.possible_conditions.length})
          </summary>
          <p className="tiny muted" style={{ margin: "6px 0" }}>
            Non-clinical pattern matching against structured evidence only — NOT A DIAGNOSIS, NOT a probability,
            and not a substitute for clinical judgment.
          </p>
          {workspace.possible_conditions.map((c) => (
            <div key={`${c.condition_id}-${c.laterality}`} style={{ borderTop: "1px solid var(--border)", paddingTop: 6, marginTop: 6 }}>
              <div className="small">
                <strong>{c.canonical_name}</strong> · {c.laterality}
                {" · "}<Badge tone={conditionTone(c.state)}>{c.state.replaceAll("_", " ")}</Badge>
              </div>
              <p className="tiny muted" style={{ margin: "2px 0" }}>NOT A DIAGNOSIS — an evidence-organization association only.</p>
              {c.note && <p className="tiny" style={{ margin: "2px 0" }}>{c.note}</p>}
              {c.supporting_evidence_ids.length > 0 && (
                <div className="tiny">
                  supporting: {c.supporting_evidence_ids.map((id) => byId.get(id)).filter((x): x is EvidenceItem => !!x).map((x) => evidenceLabel(x)).join("; ")}
                </div>
              )}
              {c.contradicting_evidence_ids.length > 0 && (
                <div className="tiny" style={{ color: "var(--danger)" }}>
                  contradicting: {c.contradicting_evidence_ids.map((id) => byId.get(id)).filter((x): x is EvidenceItem => !!x).map((x) => evidenceLabel(x)).join("; ")}
                </div>
              )}
              {c.missing_required.length > 0 && (
                <div className="tiny muted">missing required evidence: {c.missing_required.join(", ")}</div>
              )}
              {c.red_flag_candidates.length > 0 && (
                <div className="tiny" style={{ color: "var(--warn, #a05a00)" }}>
                  {c.red_flag_candidates.map((r) => `RED_FLAG_CANDIDATE: ${r}`).join(" · ")}
                </div>
              )}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
