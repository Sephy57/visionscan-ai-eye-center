"use client";

import { useEffect, useState } from "react";
import ScanViewer, { Localization } from "@/components/ScanViewer";
import { Badge } from "@/components/ui";
import { authFetch } from "@/lib/auth/clientFetch";
import { friendlyLabel, noResultStateFor, NO_RESULT_COPY } from "@/lib/reports/terminology";
import { presentQuality, QualityPresentation } from "@/lib/analysis/qualityPresentation";
import type { QualityResult } from "@/lib/imaging/quality";

/**
 * S10: read-only panel for the isolated research-model analysis endpoint
 * (GET /api/studies/{id}/research-analysis). Renders the REAL SegFormer
 * optic-disc/cup segmentation output — a genuine model inference with
 * ZERO published validation evidence. This panel must never present the
 * output as a validated finding or diagnosis; every state is rendered
 * honestly, including the fail-closed / inconclusive states.
 */

type ResearchState =
  | "NOT_A_STUDY"
  | "UNSUPPORTED_MODALITY"
  | "IMAGE_QUALITY_INSUFFICIENT"
  | "OUT_OF_DISTRIBUTION"
  | "INFERENCE_UNAVAILABLE"
  | "COMPLETED";

type Laterality = "OD" | "OS" | "OU" | "UNKNOWN";
type ConditionState = "POSSIBLE_CONDITION" | "SUPPORTED_CONDITION" | "INSUFFICIENT_EVIDENCE" | "CONFLICTING_EVIDENCE" | "UNABLE_TO_ASSESS";

interface Finding {
  id: string;
  type: string;
  location: string;
  severity: string;
  confidence: number;
  confidence_category: string;
  confidence_raw?: number | null;
  confidence_calibrated?: number | null;
  taxonomy_level?: string;
  region?: { x: number; y: number; w: number; h: number } | null;
  explanation: string;
  synthetic: boolean;
  model_id: string;
  model_status?: string;
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
  note: string;
}

interface EvidenceWorkspace {
  possible_conditions: ConditionAssessment[];
}

interface ResearchAnalysisResult {
  state: ResearchState;
  reason?: string;
  modality: string;
  quality_status?: string;
  quality?: QualityResult;
  findings: Finding[];
  evidence_workspace: EvidenceWorkspace | null;
  safety_banner: string;
  generated_at: string;
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

function qualityTone(label: QualityPresentation["overall_label"]): "ok" | "warn" | "bad" {
  switch (label) {
    case "GOOD": return "ok";
    case "ACCEPTABLE WITH LIMITATIONS": return "warn";
    case "ANALYSIS BLOCKED": return "bad";
  }
}

const NO_RESULT_SEVERITY: Record<keyof typeof NO_RESULT_COPY, "danger" | "warn"> = {
  IMAGE_NOT_SUITABLE: "danger",
  MODEL_UNAVAILABLE: "danger",
  MODEL_NOT_VALIDATED_FOR_IMAGE: "warn",
  NO_TARGET_FINDING_DETECTED: "warn",
  IMAGE_OUT_OF_DISTRIBUTION: "warn",
};

export default function ResearchAnalysisPanel({ studyId, originalImageUrl, eye }: { studyId: string; originalImageUrl: string; eye?: string }) {
  const [result, setResult] = useState<ResearchAnalysisResult | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await authFetch(`/api/studies/${encodeURIComponent(studyId)}/research-analysis`);
      if (cancelled) return;
      if (!res.ok) { setUnavailable(true); return; }
      const j = await res.json();
      setResult(j);
    })();
    return () => { cancelled = true; };
  }, [studyId]);

  if (unavailable) return null;
  if (result === null) return null;
  if (result.state === "NOT_A_STUDY") return null;

  const localizations: Localization[] = result.findings
    .filter((f) => !!f.region)
    .map((f) => ({
      id: f.id,
      finding_id: f.id,
      kind: "bounding_box",
      coordinates: f.region ?? undefined,
      priority: "moderate",
      note: `${f.type.replaceAll("_", " ")} — RESEARCH ONLY, NOT VALIDATED`,
    }));

  const quality = result.quality ? presentQuality(result.quality) : null;
  const noResultState = noResultStateFor(result.state, result.findings.length);

  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="card-title">
        <h3 style={{ fontSize: "0.9rem" }}>RESEARCH MODEL ANALYSIS (SegFormer optic-disc/cup segmentation)</h3>
        <Badge tone="warn">{friendlyLabel("CANDIDATE_ONLY")} — NOT CLINICALLY VALIDATED</Badge>
      </div>

      <div className="alert warn" role="note" style={{ marginTop: 0 }}>
        <div className="alert-body">
          <strong>{result.safety_banner}</strong>
        </div>
      </div>

      {quality && (
        <div className="small" style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0" }}>
          <span className="muted">Image quality:</span>
          <Badge tone={qualityTone(quality.overall_label)}>{quality.overall_label}</Badge>
          <span className="tiny muted">{quality.impact_note}</span>
        </div>
      )}

      {result.state === "COMPLETED" && result.findings.length > 0 && (
        <>
          <div style={{ margin: "10px 0" }}>
            <ScanViewer
              src={originalImageUrl}
              alt={`Research analysis scan${eye ? ` (${eye})` : ""}`}
              localizations={localizations}
              infoOverlay={{ eye, analysisLabel: "RESEARCH ANALYSIS" }}
            />
          </div>
          {result.findings.map((f) => (
            <div key={f.id} className="finding-card" style={{ marginBottom: 10, boxShadow: "none" }}>
              <div className="finding-head">
                <h3 style={{ fontSize: "0.8rem" }}>{f.type.replaceAll("_", " ").toUpperCase()}</h3>
                <Badge tone="warn">RESEARCH ONLY</Badge>
              </div>
              <dl className="kv tiny" style={{ gridTemplateColumns: "105px 1fr", marginBottom: 8 }}>
                <dt>Location</dt><dd>{f.location.replaceAll("_", " ")}</dd>
                <dt>Model</dt><dd>{f.model_id}</dd>
                <dt>Confidence</dt><dd>NOT CALIBRATED</dd>
              </dl>
              <p className="tiny" style={{ margin: "8px 0 8px" }}>{f.explanation}</p>
            </div>
          ))}
        </>
      )}

      {noResultState && (
        <div className={`alert ${NO_RESULT_SEVERITY[noResultState]}`} style={{ marginTop: 10 }}>
          <span className="alert-icon" aria-hidden="true">⚠</span>
          <div className="alert-body">
            <strong>{NO_RESULT_COPY[noResultState].headline}</strong>
            <p style={{ margin: "4px 0 0" }}>{NO_RESULT_COPY[noResultState].body}</p>
            {result.reason && <p className="tiny muted" style={{ margin: "4px 0 0" }}>{result.reason}</p>}
            <p className="tiny muted" style={{ margin: "4px 0 0" }}>No disease conclusion can be made.</p>
          </div>
        </div>
      )}

      {result.evidence_workspace && result.evidence_workspace.possible_conditions.length > 0 && (
        <details style={{ marginTop: 12 }} open>
          <summary className="small" style={{ cursor: "pointer", fontWeight: 650 }}>
            Evidence-pattern associations ({result.evidence_workspace.possible_conditions.length})
          </summary>
          <p className="tiny muted" style={{ margin: "6px 0" }}>
            Non-clinical pattern matching against structured evidence only — NOT A DIAGNOSIS, NOT a probability, and
            not a substitute for clinical judgment.
          </p>
          {result.evidence_workspace.possible_conditions.map((c) => (
            <div key={`${c.condition_id}-${c.laterality}`} style={{ borderTop: "1px solid var(--border)", paddingTop: 6, marginTop: 6 }}>
              <div className="small">
                <strong>{c.canonical_name}</strong> · {c.laterality}
                {" · "}<Badge tone={conditionTone(c.state)}>{friendlyLabel(c.state)}</Badge>
              </div>
              <p className="tiny muted" style={{ margin: "2px 0" }}>NOT A DIAGNOSIS — an evidence-organization association only.</p>
              {c.note && <p className="tiny" style={{ margin: "2px 0" }}>{c.note}</p>}
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

      <details style={{ marginTop: 12 }}>
        <summary className="small" style={{ cursor: "pointer", fontWeight: 650 }}>Technical Details ▾</summary>
        <dl className="kv tiny" style={{ gridTemplateColumns: "140px 1fr", margin: "6px 0" }}>
          <dt>Raw state</dt><dd>{result.state}</dd>
          <dt>Raw modality</dt><dd>{result.modality}</dd>
          <dt>Raw quality_status</dt><dd>{result.quality_status ?? "n/a"}</dd>
          <dt>Generated at</dt><dd>{result.generated_at}</dd>
          {result.findings.length === 0 && (
            <>
              <dt>Model</dt><dd>segformer-optic-disc-cup-refuge</dd>
            </>
          )}
        </dl>
        {result.findings.length > 0 && (
          <table className="tiny" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Finding</th>
                <th style={{ textAlign: "left" }}>model_id</th>
                <th style={{ textAlign: "left" }}>taxonomy_level</th>
                <th style={{ textAlign: "left" }}>synthetic</th>
              </tr>
            </thead>
            <tbody>
              {result.findings.map((f) => (
                <tr key={`tech-${f.id}`}>
                  <td>{f.type}</td>
                  <td>{f.model_id || "segformer-optic-disc-cup-refuge"}</td>
                  <td>{f.taxonomy_level ?? "n/a"}</td>
                  <td>{String(f.synthetic)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </div>
  );
}
