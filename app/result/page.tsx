"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ScanViewer from "@/components/ScanViewer";
import DocumentEvidencePanel from "@/components/DocumentEvidencePanel";
import EvidenceWorkspacePanel from "@/components/EvidenceWorkspace";
import SpecialistConsensusPanel from "@/components/SpecialistConsensusPanel";
import ResearchAnalysisPanel from "@/components/ResearchAnalysisPanel";
import { Badge, ConfidenceIndicator, EmptyState, EvidenceState, type EvidenceStateKind, PageHeader, Provenance, ProvenanceLegend, type ProvenanceKind, StatePanel, TriageBadge, shortId } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { presentQuality } from "@/lib/analysis/qualityPresentation";
import { coverageForModality } from "@/lib/models/ophthalmicCoverage";

interface Finding {
  id: string; type: string; location: string; severity: string;
  confidence: number; confidence_category: string; confidence_calibrated?: number | null;
  taxonomy_level?: string; model_status?: string;
  explanation: string; synthetic: boolean; model_id: string;
  region?: { x: number; y: number; w: number; h: number } | null;
}

interface Bundle {
  study?: { study_id: string; modality: string; eye: string; status: string; created_at: string; original_sha256: string; patient_ref?: string };
  analysis?: {
    study: { eye: string; modality: string };
    analysis_mode?: "DEMO_ONLY" | "RESEARCH_MODEL_ANALYSIS" | "MIXED_RESEARCH_AND_DEMO" | "NO_MODEL_EXECUTED" | "MODEL_FAILED";
    asset_routing?: { container_type: string; modality: string; modality_state: string; device_state: string; domain_state: string; source_hash: string; warnings: string[] };
    document_routing?: Array<{ document_id: string; document_modality: string; pages: Array<{ page: number; content_type: string; modality: string; laterality: string; classifier_method: string; verification_state: string }>; measurements: Array<{ key: string; value_normalized: number | null; unit: string | null; laterality: string; page: number }>; image_regions: Array<{ region_id: string; page: number; content_type: string; laterality: string; bbox: { x: number; y: number; w: number; h: number }; roi_hash: string; source_page_hash: string; verification_status: string }> }>;
    model_execution?: { models_attempted: string[]; models_executed: string[]; models_failed: string[]; models_skipped: Array<{ model_id: string; reason: string }>; artifact_hashes: Record<string, string | null>; artifact_verification?: Record<string, string>; model_versions: Record<string, string>; runtime_status: string };
    model_execution_ledger?: Array<{ model_id: string; model_version: string; task: string; artifact_hash: string | null; input_asset_id: string; input_roi_id: string | null; laterality: string; eligibility: string; execution_status: string; skip_reason: string | null; quality_status: string; domain_status: string; runtime_ms: number; output_contract_version: string | null; validation_status: string; dependency_group_id: string }>;
    quality: { score: number; status: string; acceptable: boolean; artifacts: string[]; metrics: Record<string, number | boolean> };
    findings: Finding[];
    uncertainty: { overall: number; reasons: string[]; ensemble_agreement?: string };
    recommendation: { priority: string; action: string; rationale: string };
    ood?: { detected: boolean; reasons: string[]; message: string };
    fundus_abnormality?: {
      state: "NO_TARGET_ABNORMALITY_DETECTED" | "SUSPICIOUS_ABNORMALITY" | "MULTIPLE_ABNORMALITIES" | "IMAGE_NOT_SUITABLE" | "OUT_OF_DISTRIBUTION" | "MODEL_UNAVAILABLE" | "MODEL_NOT_VALIDATED_FOR_IMAGE";
      regions: Array<{ id: string; finding_type: string; localization: { kind: "bounding_box"; coordinates: { x: number; y: number; w: number; h: number } }; source_model_id: string; source_model_version: string; note: string }>;
      model_id: string | null; model_version: string | null; validation_state: string; limitations: string[];
    };
    dr_assessment?: {
      state: "GRADE_ESTIMATED" | "IMAGE_NOT_SUITABLE" | "OUT_OF_DISTRIBUTION" | "MODEL_UNAVAILABLE";
      grade: number | null; grade_label: string | null; model_score: number | null;
      score_semantics: string; referable_dr: boolean | null;
      calibration_state: string; quality_state: string; ood_state: string;
      limitations: string[]; validation_state: string;
      model_id: string | null; model_version: string | null;
    };
    multi_model?: {
      performed: boolean;
      agreement: "CORROBORATED_RESEARCH_EVIDENCE" | "MODEL_DISAGREEMENT" | "CONSISTENT_RESEARCH_NEGATIVE" | "SINGLE_RESEARCH_MODEL" | "NO_RESEARCH_MODEL_OUTPUT";
      models: Array<{ model_id: string; model_version: string; model_status: string; output_summary: string }>;
      notes: string[];
    };
    oct_assessment?: {
      state: "CLASS_ESTIMATED" | "IMAGE_NOT_SUITABLE" | "OUT_OF_DISTRIBUTION" | "MODEL_UNAVAILABLE";
      predicted_class: string | null; predicted_index: number | null;
      model_scores: number[] | null; score_semantics: string;
      calibration_state: string; quality_state: string; ood_state: string;
      limitations: string[]; validation_state: string;
      model_id: string | null; model_version: string | null;
    };
    oct_region_results?: Array<{ asset_id: string; document_id: string; page: number; laterality: string; source_page_hash: string; roi_hash: string; content_type: string; status: string; assessment?: { predicted_class: string | null }; note?: string }>;
    oct_aggregation?: string;
    model_registry?: {
      model_id: string; model_version: string; model_status: string; display_label: string | null;
      integrity_checks: Array<{ check: string; passed: boolean; detail: string }>;
      device_compatibility: { compatible: boolean; note: string };
      model_input?: "IMAGE_ONLY" | "IMAGE_AND_SYMPTOMS";
    };
    patient_context?: {
      reported: boolean;
      symptoms: Array<{ type: string; label?: string; onset: string; duration: string; severity: string; laterality: string; progression: string; frequency: string; free_text?: string | null }>;
      red_flags: string[];
      note: string;
    };
    symptom_correlation?: {
      state: "correlated" | "not_explained" | "inconclusive" | "conflicting" | "urgent";
      urgency: "emergency" | "urgent" | "prompt" | "routine";
      items: Array<{ symptom_type: string; symptom_label: string; state: string; matched_finding_types: string[]; note: string }>;
      notes: string[];
      label: string;
    };
    possible_conditions?: {
      conditions: Array<{ id: string; label: string; matched_findings: string[]; commonly_associated_symptoms: string[]; note: string }>;
      note: string;
    };
    treatment_information?: {
      items: Array<{
        condition_id: string; condition_label: string; available: boolean; reason: string;
        approaches: Array<{
          approach_label: string; purpose: string; evidence_reference: string;
          medications: Array<{ medication_id: string; generic_name: string; drug_class: string; purpose: string; route: string[]; common_contraindications: string[]; warnings: string[]; common_adverse_effects: string[]; evidence_references: string[] }>;
        }>;
        label: string;
      }>;
      dosage_notice: string;
      interaction_notice: string;
      note: string;
    };
    visualizations?: {
      localizations: Array<unknown>;
      segmentation: unknown;
      note: string;
    };
    demo: { synthetic_result: boolean; label: string };
    diagnosis_gate?: { allowed: boolean; reasons: string[]; clinical_interpretation: "DIAGNOSIS" | "REQUIRES_CLINICAL_CORRELATION" };
    provenance: { analyzed_at: string; pipeline_version: string; ruleset_version: string };
    safety: { disclaimers: string[] };
  };
  report?: { report_id: string; overall_result: string; review?: { status: string; reviewer_id?: string; finalized_at?: string } };
  error?: string;
}

/** Data-driven artifact/integrity note: never hard-code a placeholder claim. */
function checksumNote(a: NonNullable<Bundle["analysis"]>): string {
  const checks = a.model_registry?.integrity_checks ?? [];
  const artifact = checks.find((c) => c.check === "artifact" || c.check === "checksum");
  if (artifact) return `${artifact.passed ? "Verified" : "FAILED"} — ${artifact.detail}`;
  return "No artifact integrity evidence recorded for this result.";
}

interface EvidenceSummary {
  evidence?: Array<{ id: string; source_type: string; category: string }>;
  conflicts?: Array<{ id: string }>;
  examination_context?: { source_count?: Record<string, number | undefined> };
}

/** Evidence fetch failure; `forbidden` only when the server refused the role (401/403). */
type EvidenceUnavailable = { unavailable: true; forbidden: boolean };

interface Lane {
  key: string; name: string; icon: IconName; summary: string; detail?: string;
  prov: ProvenanceKind; provLabel?: string; state?: EvidenceStateKind; stateLabel?: string;
}

/**
 * Multimodal evidence lanes. Each lane is derived strictly from fields the
 * server already computed; nothing is scored, fused, or upgraded here. A lane
 * with no input is "not assessed" — never "normal".
 */
function buildLanes(a: NonNullable<Bundle["analysis"]>, isFundus: boolean, isOct: boolean, ev: EvidenceSummary | null | EvidenceUnavailable): Lane[] {
  const lanes: Lane[] = [];
  const agreement = a.multi_model?.performed ? a.multi_model.agreement : undefined;
  const agreementState = (): { state: EvidenceStateKind; label?: string } | undefined =>
    agreement === "CORROBORATED_RESEARCH_EVIDENCE" ? { state: "corroborated" }
      : agreement === "MODEL_DISAGREEMENT" ? { state: "disagreement" }
      : agreement === "CONSISTENT_RESEARCH_NEGATIVE" ? { state: "corroborated", label: "Consistent negative" }
      : agreement === "SINGLE_RESEARCH_MODEL" ? { state: "single" }
      : undefined;

  // FUNDUS
  const f = a.fundus_abnormality;
  if (!isFundus) {
    lanes.push({ key: "fundus", name: "Fundus", icon: "eye", summary: "No fundus image in this study", prov: "not-assessed" });
  } else if (!a.quality.acceptable) {
    lanes.push({ key: "fundus", name: "Fundus", icon: "eye", summary: "Quality gate blocked interpretation", detail: a.quality.artifacts.join(", ") || "insufficient quality", prov: "unavailable", state: "blocked" });
  } else if (f?.state === "OUT_OF_DISTRIBUTION" || a.ood?.detected) {
    lanes.push({ key: "fundus", name: "Fundus", icon: "eye", summary: "Input outside model operating conditions", detail: a.ood?.message, prov: "unavailable", state: "ood" });
  } else if (!f || f.state === "MODEL_UNAVAILABLE" || f.state === "MODEL_NOT_VALIDATED_FOR_IMAGE") {
    lanes.push({ key: "fundus", name: "Fundus", icon: "eye", summary: "General fundus abnormality model unavailable", detail: "Unavailable coverage is not a normal result", prov: "unavailable", state: "unavailable" });
  } else {
    const regions = f.regions?.length ?? 0;
    const dr = a.dr_assessment?.state === "GRADE_ESTIMATED" ? ` · DR grade estimate ${a.dr_assessment.grade}/4` : "";
    const ag = agreementState();
    lanes.push({
      key: "fundus", name: "Fundus", icon: "eye",
      summary: regions > 0 ? `${regions} suspicious research region${regions === 1 ? "" : "s"}${dr}` : `No target region emitted${dr}`,
      detail: "Research lesion/DR models · uncalibrated", prov: "model", state: ag?.state ?? "review", stateLabel: ag?.label,
    });
  }

  // OCT
  const oct = a.oct_assessment;
  const rois = a.oct_region_results?.length ?? 0;
  if (!isOct && rois === 0) {
    // The OCT model reports OUT_OF_DISTRIBUTION for any non-OCT input; with no
    // OCT image or OCT region there was simply nothing to assess.
    lanes.push({ key: "oct", name: "OCT", icon: "layers", summary: "No OCT input in this study", prov: "not-assessed" });
  } else if (oct && oct.state === "CLASS_ESTIMATED") {
    lanes.push({ key: "oct", name: "OCT", icon: "layers", summary: `Class estimate: ${oct.predicted_class}`, detail: `Classification only — no localization${rois ? ` · ${rois} ROI(s) from PDF` : ""}`, prov: "model", state: "single" });
  } else if (oct && oct.state !== "MODEL_UNAVAILABLE") {
    lanes.push({ key: "oct", name: "OCT", icon: "layers", summary: oct.state.replaceAll("_", " ").toLowerCase(), detail: oct.limitations?.[0], prov: "unavailable", state: oct.state === "OUT_OF_DISTRIBUTION" ? "ood" : "blocked" });
  } else if (rois > 0) {
    lanes.push({ key: "oct", name: "OCT", icon: "layers", summary: `${rois} bounded OCT region(s) from linked PDF`, detail: a.oct_aggregation?.replaceAll("_", " ").toLowerCase(), prov: "model", state: "review" });
  } else {
    lanes.push({ key: "oct", name: "OCT", icon: "layers", summary: oct?.state === "MODEL_UNAVAILABLE" ? "OCT model unavailable for this input" : "No OCT input in this study", prov: oct?.state === "MODEL_UNAVAILABLE" ? "unavailable" : "not-assessed", state: oct?.state === "MODEL_UNAVAILABLE" ? "unavailable" : undefined });
  }

  // DOCUMENTS & MEASUREMENTS
  const docs = a.document_routing ?? [];
  const pages = docs.reduce((n, d) => n + d.pages.length, 0);
  const measurements = docs.reduce((n, d) => n + d.measurements.length, 0);
  lanes.push(docs.length
    ? { key: "docs", name: "Documents", icon: "document", summary: `${docs.length} record(s) · ${pages} routed page(s)`, detail: "Document-extracted, unreviewed until verified", prov: "observed", state: "review" }
    : { key: "docs", name: "Documents", icon: "document", summary: "No clinical record attached", prov: "not-assessed" });
  lanes.push(measurements
    ? { key: "measure", name: "Measurements", icon: "ruler", summary: `${measurements} value(s) from records`, detail: "Unreviewed document measurements", prov: "observed", state: "review" }
    : { key: "measure", name: "Measurements", icon: "ruler", summary: "No measurements extracted", prov: "not-assessed" });

  // SYMPTOMS
  const pc = a.patient_context;
  if (pc?.reported) {
    const corr = a.symptom_correlation;
    lanes.push({
      key: "symptoms", name: "Symptoms", icon: "symptom",
      summary: `${pc.symptoms.length} reported${pc.red_flags.length ? ` · ${pc.red_flags.length} red flag` : ""}`,
      detail: corr ? `Rules correlation: ${corr.state.replaceAll("_", " ")} (inferred after model ran)` : undefined,
      prov: "observed", state: corr?.state === "conflicting" ? "disagreement" : pc.red_flags.length ? "review" : corr?.state === "correlated" ? "corroborated" : "insufficient",
      stateLabel: corr?.state === "correlated" ? "Correlated (rules)" : pc.red_flags.length ? "Urgent review" : undefined,
    });
  } else {
    lanes.push({ key: "symptoms", name: "Symptoms", icon: "symptom", summary: "No symptoms reported", prov: "not-assessed" });
  }

  // HISTORY / TESTS (evidence workspace)
  if (ev && "unavailable" in ev) {
    lanes.push({ key: "history", name: "History & tests", icon: "clipboard", summary: ev.forbidden ? "Evidence workspace unavailable for your role" : "Evidence workspace could not be loaded", prov: "unavailable" });
  } else if (ev) {
    const c = ev.examination_context?.source_count ?? {};
    const history = (c.history ?? 0) + (c.medications ?? 0) + (c.allergies ?? 0);
    const tests = c.test_results ?? 0;
    lanes.push(history
      ? { key: "history", name: "History", icon: "clipboard", summary: `${c.history ?? 0} history · ${c.medications ?? 0} medication · ${c.allergies ?? 0} allergy item(s)`, prov: "observed", state: "review" }
      : { key: "history", name: "History", icon: "clipboard", summary: "No structured history", prov: "not-assessed" });
    lanes.push(tests
      ? { key: "tests", name: "Tests", icon: "beaker", summary: `${tests} documented test result(s)`, detail: ev.conflicts?.length ? `${ev.conflicts.length} unresolved evidence conflict(s)` : undefined, prov: "observed", state: ev.conflicts?.length ? "disagreement" : "review" }
      : { key: "tests", name: "Tests", icon: "beaker", summary: "No documented test results", prov: "not-assessed" });
  }
  return lanes;
}

function ResultSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading study">
      <div className="skel" style={{ height: 64, marginBottom: 16 }} />
      <div className="skel" style={{ height: 96, marginBottom: 16 }} />
      <div className="zone-3">
        <div className="skel" style={{ height: 520 }} />
        <div style={{ display: "grid", gap: 14 }}><div className="skel" style={{ height: 260 }} /><div className="skel" style={{ height: 180 }} /></div>
        <div style={{ display: "grid", gap: 14 }}><div className="skel" style={{ height: 230 }} /><div className="skel" style={{ height: 150 }} /></div>
      </div>
    </div>
  );
}

function StudyPicker() {
  const [rows, setRows] = useState<Array<{ study_id: string; created_at: string; modality: string; eye: string; patient_ref?: string | null; dashboard_status?: string }> | null>(null);
  useEffect(() => {
    fetch("/api/studies?with_status=1&limit=12").then((r) => (r.ok ? r.json() : { studies: [] })).then((j) => setRows(j.studies ?? [])).catch(() => setRows([]));
  }, []);
  return (
    <div>
      <PageHeader eyebrow="Results workspace" title="Open a study result" lede="Choose a recent analyzed study, or start a new analysis. Results open with the imaging viewer, evidence lanes, and review status side by side." actions={<Link className="btn" href="/analyze"><Icon name="plus" size={14} /> New analysis</Link>} />
      {!rows && <div className="loading-row" role="status"><span className="pulse-dot" aria-hidden="true" /> Loading recent studies…</div>}
      {rows && rows.length === 0 && (
        <EmptyState icon={<Icon name="eye" size={22} />} title="No studies yet" action={<Link className="btn" href="/analyze">Start a new analysis</Link>}>
          No study has been uploaded to this workspace. Results appear here once an analysis completes.
        </EmptyState>
      )}
      {rows && rows.length > 0 && (
        <div className="card flush">
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Recent studies">
            <table className="table">
              <caption className="sr-only">Recent studies you can open</caption>
              <thead><tr><th scope="col">Study</th><th scope="col">Modality</th><th scope="col">Created</th><th scope="col" className="actions">Open</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.study_id}>
                  <td>{r.patient_ref && <strong>{r.patient_ref} </strong>}<span className="id-cell">{shortId(r.study_id, 20)}</span></td>
                  <td>{r.modality.replaceAll("_", " ")} · {r.eye}</td>
                  <td className="small muted">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="actions"><Link className="btn sm" href={`/result?study=${encodeURIComponent(r.study_id)}`}>Open result</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultInner() {
  const params = useSearchParams();
  const study = params.get("study") ?? "";
  const [data, setData] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceSummary | null | EvidenceUnavailable>(null);
  const [activeRegion, setActiveRegion] = useState<Finding["region"]>(null);
  // Presentation Mode / Clinician View: a client-side-only display
  // preference, not a safety state. It never changes what the server
  // computed (diagnosis gate, quality, OOD, findings) - it only shows or
  // hides purely technical/provenance sections. Safety-critical disclaimers,
  // the clinical-correlation notice, and urgency are shown in BOTH modes.
  const [clinicianView, setClinicianView] = useState(false);
  useEffect(() => {
    try {
      setClinicianView(window.localStorage.getItem("vs_clinician_view") === "1");
    } catch { /* private/blocked storage - default to Presentation Mode */ }
  }, []);
  function toggleClinicianView() {
    setClinicianView((v) => {
      const next = !v;
      try { window.localStorage.setItem("vs_clinician_view", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  useEffect(() => {
    if (!study) return;
    (async () => {
      try {
        const res = await fetch(`/api/studies/${encodeURIComponent(study)}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) setErr(json.error ?? (res.status === 404 ? "Study not found or not visible to your account." : "The study service returned an error."));
        else setData(json);
      } catch {
        setErr("Network error — the study service could not be reached.");
      }
    })();
    fetch(`/api/studies/${encodeURIComponent(study)}/evidence`)
      .then((r) => (r.ok ? r.json() : { unavailable: true, forbidden: r.status === 401 || r.status === 403 }))
      .then(setEvidence)
      .catch(() => setEvidence({ unavailable: true, forbidden: false }));
  }, [study]);

  if (!study) return <StudyPicker />;
  if (err) {
    return (
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <PageHeader eyebrow="Results workspace" title="Unable to open result" />
        <StatePanel tone="danger" icon="warning" role="alert" title="This result cannot be displayed"
          what={err}
          why="The study may have been deleted, may belong to another tenant, or the server may be unavailable. Access is enforced server-side."
          next="Open a different study from History, or upload a new scan."
          actions={<><Link className="btn" href="/history">Open History</Link><Link className="btn secondary" href="/analyze">Upload new scan</Link></>} />
      </div>
    );
  }
  if (!data) return <ResultSkeleton />;
  if (!data.analysis) {
    return (
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <PageHeader eyebrow="Results workspace" title="Analysis not available yet" />
        <StatePanel tone="warn" icon="clock" title="No analysis has been recorded for this study"
          what={<>Study <code>{shortId(data.study?.study_id, 24)}</code> exists but has status “{data.study?.status ?? "unknown"}”.</>}
          why="The analysis job may not have been started, may still be running, or consent may be missing."
          next="Start or resume the analysis job. No result is shown until the server publishes one."
          actions={<><Link className="btn" href={`/processing?study=${encodeURIComponent(study)}`}>Start / resume analysis</Link><Link className="btn secondary" href="/history">Back to History</Link></>} />
      </div>
    );
  }

  const a = data.analysis;
  const mode = a.analysis_mode ?? (a.demo?.synthetic_result ? "DEMO_ONLY" : "RESEARCH_MODEL_ANALYSIS");
  const rejected = !a.quality.acceptable;
  const abnormal = a.findings.length > 0;
  const studyModality = (a.study?.modality ?? "").toLowerCase();
  const isFundusStudy = ["fundus", "retinal_photo", "optic_nerve", "macula"].includes(studyModality);
  const isOctStudy = studyModality === "oct" || studyModality === "octa";
  const fundus = a.fundus_abnormality;
  const suspiciousFundus = isFundusStudy && (fundus?.state === "SUSPICIOUS_ABNORMALITY" || fundus?.state === "MULTIPLE_ABNORMALITIES");
  const fundusUnavailable = isFundusStudy && (fundus?.state === "MODEL_UNAVAILABLE" || fundus?.state === "MODEL_NOT_VALIDATED_FOR_IMAGE");
  // S12: honest quality presentation - a "pass" status can still carry real
  // artifacts (see lib/analysis/qualityPresentation.ts's doc comment); never
  // shown as a bare "GOOD" when a real artifact was detected.
  const qp = presentQuality({ quality_status: a.quality.status, detected_artifacts: a.quality.artifacts });
  const ood = a.ood?.detected === true;
  const hasImage = !!data.study;
  const redFlags = a.patient_context?.red_flags ?? [];
  const hasRedFlag = redFlags.length > 0;
  const fundusCoverage = coverageForModality("FUNDUS");
  const researchPipelineTargets = fundusCoverage.filter((entry) => entry.state === "RESEARCH_PIPELINE").map((entry) => entry.display_name);
  const disabledCandidateTargets = fundusCoverage.filter((entry) => entry.state === "CANDIDATE_DISABLED").map((entry) => entry.display_name);
  const unsupportedDiseaseTargets = fundusCoverage.filter((entry) => entry.task === "DISEASE_SCREENING").map((entry) => entry.display_name);
  const reviewStatus = data.report?.review?.status ?? "ai_only";
  const lanes = buildLanes(a, isFundusStudy, isOctStudy, evidence);

  const researchNoTarget = !rejected && !abnormal && !suspiciousFundus && !ood && !fundusUnavailable && mode !== "DEMO_ONLY";
  const heroClass = rejected ? "reject" : abnormal || suspiciousFundus || ood || fundusUnavailable || researchNoTarget ? "abnormal" : "normal";
  const headline = rejected
    ? "Automated interpretation inconclusive — image quality insufficient"
    : suspiciousFundus
      ? "Abnormal retinal region identified by research AI"
      : fundusUnavailable
        ? "General fundus abnormality model unavailable"
      : mode === "MODEL_FAILED"
        ? "Research model analysis failed — no finding inferred"
      : mode === "NO_MODEL_EXECUTED"
        ? "No applicable research model executed"
      : abnormal
      ? "Potential abnormal finding detected"
      : ood
        ? "Automated interpretation inconclusive"
        : "No target abnormality identified by the available model";

  const eyeLabel = (l?: string) => l === "OD" || l === "right" ? "RIGHT EYE" : l === "OS" || l === "left" ? "LEFT EYE" : l === "both" ? "BOTH EYES" : "EYE: UNKNOWN";
  const modalityLabel = (m?: string) => (m ? m.replaceAll("_", " ").toUpperCase() : "UNKNOWN MODALITY");
  const modeTone = mode === "MODEL_FAILED" ? "bad" : mode === "DEMO_ONLY" ? "demo" : mode === "NO_MODEL_EXECUTED" ? "neutral" : "info";

  return (
    <div>
      {/* ---- Red-flag panel: always near the top, never buried ---- */}
      {hasRedFlag && (
        <div className="alert danger" role="alert" style={{ marginTop: 0 }}>
          <span className="alert-icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
          <div className="alert-body">
            <strong>URGENT REVIEW</strong>
            {a.patient_context!.symptoms
              .filter((s) => redFlags.includes(s.type))
              .map((s) => (
                <div key={s.type}>
                  {s.label ?? s.type.replaceAll("_", " ")} was reported
                  {s.laterality === "right" ? " (right eye)" : s.laterality === "left" ? " (left eye)" : ""}.
                </div>
              ))}
            Prompt ophthalmic assessment is recommended. This escalation does not name or imply any specific condition.
          </div>
        </div>
      )}

      <PageHeader
        eyebrow="Results workspace"
        title={data.study?.patient_ref ? <>Study result · {data.study.patient_ref}</> : "Study result"}
        actions={<>
          <button
            type="button"
            className="btn secondary sm"
            aria-pressed={clinicianView}
            onClick={toggleClinicianView}
            title="Clinician View shows technical/provenance sections; Presentation Mode hides them. Never changes the underlying safety state, quality, OOD, or diagnosis gate result."
          >
            <Icon name={clinicianView ? "layers" : "eye"} size={14} />
            Technical details
          </button>
          <Link className="btn secondary sm" href={`/report?study=${encodeURIComponent(study)}`}><Icon name="reports" size={14} /> Report</Link>
          <Link className="btn authority sm" href={`/clinician?study=${encodeURIComponent(study)}`}><Icon name="review" size={14} /> Clinical Review</Link>
        </>}
      />

      <dl className="identity-bar" aria-label="Study identity">
        <div><dt>Study</dt><dd className="mono" title={data.study?.study_id}>{shortId(data.study?.study_id, 18)}</dd></div>
        <div><dt>Eye</dt><dd>{eyeLabel(a.study?.eye)}</dd></div>
        <div><dt>Modality</dt><dd>{modalityLabel(a.study?.modality)}</dd></div>
        <div><dt>Analyzed</dt><dd className="num">{new Date(a.provenance.analyzed_at).toLocaleString()}</dd></div>
        <div><dt>Analysis mode</dt><dd><Badge tone={modeTone}>{mode.replaceAll("_", " ")}</Badge></dd></div>
        <div><dt>Clinician review</dt><dd>{reviewStatus === "clinician_finalized" ? <Provenance kind="clinician" label="Finalized" /> : reviewStatus === "clinician_reviewed" ? <Provenance kind="clinician" label="In review" /> : <Badge tone="warn">Awaiting review</Badge>}</dd></div>
      </dl>

      <div className={`result-hero ${heroClass}`} role="status">
        <span className="hero-icon" aria-hidden="true"><Icon name={rejected ? "x" : heroClass === "normal" ? "check" : "warning"} size={22} /></span>
        <div>
          <div className="eyebrow">SCREENING RESULT · RESEARCH OUTPUT</div>
          <h2>{headline}</h2>
          <p className="small" style={{ margin: 0, maxWidth: 720 }}>
            {rejected
              ? "Image quality is insufficient for reliable automated analysis. Please acquire another scan or have the image reviewed by an eye-care professional."
              : suspiciousFundus
                ? "A research model localized a suspicious retinal region. The type is not established unless listed below, and ophthalmic interpretation is required."
                : fundusUnavailable
                  ? "Clinical interpretation is not available because no installed general fundus abnormality model can evaluate this image. This is not a normal-fundus result."
              : abnormal
                ? "The automated analysis identified the findings below. These are screening signals, not diagnoses, and require interpretation by a qualified eye-care professional."
                : ood
                  ? "Input is outside the validated operating conditions of this model. Automated interpretation is inconclusive — normality is not claimed."
                  : "No target abnormality was identified by the available model. This does not exclude other eye disease."}
          </p>
        </div>
        <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
          <TriageBadge priority={a.recommendation.priority} />
          <span className="tiny muted" style={{ maxWidth: 240, textAlign: "right" }}>{a.recommendation.action}</span>
        </div>
      </div>

      <div className="card" style={{ padding: "10px 16px", marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span className="stat-label">Evidence provenance</span>
        <ProvenanceLegend />
        {a.asset_routing && <span className="tiny muted" style={{ marginLeft: "auto" }}>Routing: {[a.asset_routing.container_type, a.asset_routing.modality_state, a.asset_routing.device_state, a.asset_routing.domain_state].map((v) => v.replaceAll("_", " ").toLowerCase()).join(" · ")}</span>}
      </div>

      {/* ---- Three-zone workspace: viewer | evidence | assessment & review ---- */}
      <div className="workspace">
        {/* ZONE 1 — imaging */}
        <div className="zone zone-viewer">
          <div className="zone-label">Imaging</div>
          <div className="card" style={{ padding: 12 }}>
            <div className="card-title" style={{ padding: "0 4px", marginBottom: 10 }}>
              <h3>Scan viewer</h3>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Badge tone="neutral">{eyeLabel(a.study?.eye)}</Badge><Badge tone="neutral">{modalityLabel(a.study?.modality)}</Badge></span>
            </div>
            {hasImage ? (
              <ScanViewer
                src={`/api/studies/${encodeURIComponent(study)}/image`}
                alt={`Original scan ${data.study?.study_id}`}
                region={activeRegion}
                localizations={(fundus?.regions ?? []).map((r) => ({ id: r.id, finding_id: r.id, kind: r.localization.kind, coordinates: r.localization.coordinates, priority: "high" as const, note: `SUSPICIOUS REGION — ${r.finding_type.replaceAll("_", " ")}` }))}
                overlayStatus={fundus?.regions?.length ? (fundus.validation_state === "CLINICALLY_VALIDATED" ? "CLINICALLY_VALIDATED" : "RESEARCH") : undefined}
                classificationOnly={isOctStudy && a.oct_assessment?.state === "CLASS_ESTIMATED"}
                derivativeNote={(a.oct_region_results?.length ?? 0) > 0
                  ? `${a.oct_region_results!.length} bounded OCT region(s) derived from the linked PDF remain listed under multimodal evidence. They are not a substitute for this original.`
                  : undefined}
                infoOverlay={{
                  eye: eyeLabel(a.study?.eye),
                  modality: modalityLabel(a.study?.modality),
                  // This viewer belongs to the normal Gate-A pipeline. The
                  // isolated SegFormer path has its own explicitly labelled
                  // viewer; never call synthetic output "research".
                  analysisLabel: mode === "DEMO_ONLY" ? "DEMO / SYNTHETIC" : mode === "MODEL_FAILED" ? "MODEL FAILED" : mode === "NO_MODEL_EXECUTED" ? "NO MODEL EXECUTED" : "RESEARCH ANALYSIS",
                }}
              />
            ) : (
              <EmptyState icon={<Icon name="eye" size={22} />} title="Original image unavailable">The stored original could not be served. No substitute image is shown.</EmptyState>
            )}
            <p className="tiny muted" style={{ margin: "8px 4px 0" }}>
              Unmodified pixels. Labels and overlays are rendered around the image, never burned into it; themes never filter the scan.
            </p>
          </div>
          <div className="card">
            <div className="card-title"><h3>Image quality</h3><Badge tone={qp.blocked ? "bad" : a.quality.artifacts.length > 0 ? "warn" : "ok"}>{qp.overall_label}</Badge></div>
            <dl className="kv tiny" style={{ gridTemplateColumns: "120px 1fr" }}>
              <dt>Quality score</dt><dd className="num">{a.quality.score} ({a.quality.status})</dd>
              <dt>Artifacts</dt><dd>{a.quality.artifacts.join(", ") || "none detected"}</dd>
            </dl>
            {!qp.blocked && a.quality.artifacts.length > 0 && <p className="tiny muted" style={{ margin: "8px 0 0" }}>{qp.impact_note}</p>}
          </div>
        </div>

        {/* ZONE 2 — evidence */}
        <div className="zone">
          <div className="zone-label">Multimodal evidence</div>
          <section className="evidence-lanes" aria-label="Evidence lanes">
            {lanes.map((lane) => (
              <div key={lane.key} className={`lane${lane.prov === "not-assessed" ? " is-empty" : " has-evidence"}`}>
                <span className="lane-name"><span className="lane-icon" aria-hidden="true"><Icon name={lane.icon} size={14} /></span>{lane.name}</span>
                <span className="lane-summary">{lane.summary}{lane.detail && <span className="tiny">{lane.detail}</span>}</span>
                <span className="lane-tags"><Provenance kind={lane.prov} label={lane.provLabel} />{lane.state && <EvidenceState state={lane.state} label={lane.stateLabel} />}</span>
              </div>
            ))}
          </section>

          <div className="card">
            <div className="card-title"><h3>Observed signals</h3><span style={{ display: "flex", gap: 6 }}><Provenance kind="model" /><Badge tone="neutral">{a.findings.length + (fundus?.regions?.length ?? 0)}</Badge></span></div>
            {!abnormal && !(fundus?.regions?.length) && (
              <div className="empty-state compact">
                <h3 style={{ fontSize: "0.9rem" }}>{mode === "MODEL_FAILED" ? "MODEL FAILED — NO FINDING INFERRED" : mode === "NO_MODEL_EXECUTED" ? "NO APPLICABLE MODEL EXECUTED" : mode === "RESEARCH_MODEL_ANALYSIS" || mode === "MIXED_RESEARCH_AND_DEMO" ? "NO TARGET FINDING DETECTED" : "NO VALIDATED FINDINGS"}</h3>
                <p className="tiny muted" style={{ marginBottom: 8 }}>
                  {mode === "MODEL_FAILED" ? "The applicable research provider failed. No synthetic replacement or normality claim was generated." : mode === "NO_MODEL_EXECUTED" ? "No compatible research provider ran for this asset. This state is not evidence of normality." : mode === "RESEARCH_MODEL_ANALYSIS" || mode === "MIXED_RESEARCH_AND_DEMO" ? "No target finding was emitted by the research model(s) that completed successfully. Other abnormalities may still be present." : "The currently installed model does not provide clinically validated ophthalmic findings."}
                </p>
                <p className="tiny muted" style={{ margin: 0 }}>Model {a.model_registry?.model_id ?? "—"} · {mode.replaceAll("_", " ")}</p>
              </div>
            )}
            {a.findings.map((f) => (
              <div key={f.id} className={`finding-card${f.synthetic ? " synthetic" : ""}`}>
                <div className="finding-head">
                  <h4>RETINAL FINDING — {f.type.replaceAll("_", " ").toUpperCase()}</h4>
                  {f.synthetic
                    ? <span className="badge demo">DEMO / SYNTHETIC</span>
                    : <span className="badge warn">RESEARCH / UNVALIDATED</span>}
                </div>
                <dl className="kv tiny" style={{ gridTemplateColumns: "105px 1fr", marginBottom: 8 }}>
                  <dt>Location</dt><dd>{f.location.replaceAll("_", " ")}</dd>
                  <dt>Laterality</dt><dd>{a.study?.eye}</dd>
                  <dt>Model</dt><dd>{f.model_id}</dd>
                  <dt>Validation</dt><dd>Not clinically validated</dd>
                  <dt>Localization</dt><dd>{f.region ? "Bounding box (research overlay — View on scan)" : "Not available"}</dd>
                  <dt>Priority</dt><dd>{f.severity === "severe" || f.severity === "moderate" ? "Requires clinician review" : "Routine review"}</dd>
                </dl>
                <ConfidenceIndicator finding={f} />
                <p className="tiny" style={{ margin: "8px 0 8px" }}>{f.explanation}</p>
                {f.region && hasImage
                  ? <button className="btn secondary sm" onClick={() => setActiveRegion(f.region ?? null)}><Icon name="target" size={13} /> View on scan</button>
                  : <span className="tiny muted">No validated localization data available.</span>}
              </div>
            ))}
            {(fundus?.regions ?? []).map((region) => (
              <div key={region.id} className="finding-card">
                <div className="finding-head"><h4>SUSPICIOUS REGION — {region.finding_type.replaceAll("_", " ").toUpperCase()}</h4><span className="badge warn">RESEARCH</span></div>
                <p className="tiny" style={{ margin: "8px 0" }}>{region.note}</p>
                <button className="btn secondary sm" onClick={() => setActiveRegion(region.localization.coordinates)}><Icon name="target" size={13} /> View on scan</button>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-title"><h3>Model assessments</h3><Provenance kind="model" /></div>
            {isFundusStudy && (
              <div className="assessment">
                <div className="assessment-head"><h4>AI imaging review · fundus abnormality</h4><Badge tone={suspiciousFundus ? "bad" : fundusUnavailable ? "warn" : "neutral"}>{fundus?.state?.replaceAll("_", " ") ?? "NOT AVAILABLE"}</Badge></div>
                <p className="small" style={{ margin: "0 0 6px" }}>
                  {suspiciousFundus ? "Research AI detected a suspicious fundus region; ophthalmic review is required." : fundus?.limitations?.[0] ?? "No general fundus-abnormality result is recorded."}
                </p>
                <p className="assessment-meta" style={{ margin: 0 }}>Validation: <strong>{fundus?.validation_state ?? "not recorded"}</strong> · Model: {fundus?.model_id ?? "not installed"}{fundus?.model_version ? ` v${fundus.model_version}` : ""}</p>
                <details className="disclosure" style={{ marginTop: 8 }}>
                  <summary>What this deployment did and did not evaluate</summary>
                  <p className="tiny muted"><strong>Active production imaging targets:</strong> none.</p>
                  {researchPipelineTargets.length > 0 && (
                    <p className="tiny muted"><strong>Research lesion detection {fundus?.model_id ? "executed for this image" : "available in this deployment"} (uncalibrated, not validated):</strong> {researchPipelineTargets.join(", ")}.</p>
                  )}
                  <p className="tiny muted"><strong>Downloaded candidate, disabled and not executed here:</strong> {disabledCandidateTargets.length ? disabledCandidateTargets.join(", ") : "none"}.</p>
                  <p className="tiny muted"><strong>No validated disease model available:</strong> {unsupportedDiseaseTargets.join(", ")}.</p>
                  <p className="tiny muted" style={{ marginBottom: 0 }}>Missing or disabled coverage is never evidence of a normal fundus or absence of unlisted pathology.</p>
                </details>
              </div>
            )}
            {a.dr_assessment && a.dr_assessment.state !== "MODEL_UNAVAILABLE" && (
              <div className="assessment">
                <div className="assessment-head"><h4>DR grade assessment</h4><Badge tone={a.dr_assessment.state === "GRADE_ESTIMATED" ? "warn" : "neutral"}>{a.dr_assessment.state.replaceAll("_", " ")}</Badge></div>
                {a.dr_assessment.state === "GRADE_ESTIMATED" ? (
                  <>
                    <div className="assessment-value">Grade {a.dr_assessment.grade}/4 <span className="small muted">({a.dr_assessment.grade_label?.replaceAll("_", " ")})</span></div>
                    <p className="small" style={{ margin: "0 0 6px" }}>
                      Research estimate — referable threshold (≥2): <strong>{a.dr_assessment.referable_dr ? "met" : "not met"}</strong>.
                      This is not a diagnosis and not a referral decision.
                    </p>
                    <p className="assessment-meta" style={{ margin: 0 }}>
                      Model score {typeof a.dr_assessment.model_score === "number" ? a.dr_assessment.model_score.toFixed(3) : "—"} (ranking score, NOT a probability) ·
                      Calibration: not calibrated · Validation: {a.dr_assessment.validation_state} ·
                      Model: {a.dr_assessment.model_id ?? "not installed"}{a.dr_assessment.model_version ? ` v${a.dr_assessment.model_version}` : ""}
                    </p>
                  </>
                ) : (
                  <p className="small" style={{ margin: 0 }}>{a.dr_assessment.limitations?.[0] ?? "No DR grade result is recorded."}</p>
                )}
              </div>
            )}
            {a.oct_assessment && a.oct_assessment.state !== "MODEL_UNAVAILABLE" && (
              <div className="assessment">
                <div className="assessment-head"><h4>OCT classification</h4><Badge tone={a.oct_assessment.state === "CLASS_ESTIMATED" ? "warn" : "neutral"}>{a.oct_assessment.state.replaceAll("_", " ")}</Badge></div>
                {a.oct_assessment.state === "CLASS_ESTIMATED" ? (
                  <>
                    <div className="assessment-value">{a.oct_assessment.predicted_class}</div>
                    <p className="small" style={{ margin: "0 0 6px" }}>
                      Research estimate (backbone argmax over CNV/DME/DRUSEN/NORMAL).
                      This is not a diagnosis; a NORMAL estimate does not mean a healthy macula.
                    </p>
                    <p className="assessment-meta" style={{ margin: 0 }}>
                      Model scores [{(a.oct_assessment.model_scores ?? []).map((v) => v.toFixed(2)).join(", ")}] (ranking scores, NOT probabilities) ·
                      Calibration: not calibrated · Validation: {a.oct_assessment.validation_state} ·
                      Model: {a.oct_assessment.model_id ?? "not installed"}{a.oct_assessment.model_version ? ` v${a.oct_assessment.model_version}` : ""} ·
                      No overlay: classification-only output has no localization.
                    </p>
                  </>
                ) : (
                  <p className="small" style={{ margin: 0 }}>{a.oct_assessment.limitations?.[0] ?? "No OCT result is recorded."}</p>
                )}
              </div>
            )}
            {!isFundusStudy && !(a.dr_assessment && a.dr_assessment.state !== "MODEL_UNAVAILABLE") && !(a.oct_assessment && a.oct_assessment.state !== "MODEL_UNAVAILABLE") && (
              <p className="small muted" style={{ margin: 0 }}>No model assessment was recorded for this modality. This is not evidence of normality.</p>
            )}
          </div>

          {a.multi_model && a.multi_model.performed && (
            <div className="card">
              <div className="card-title"><h3>Multi-model research agreement</h3>
                <EvidenceState state={a.multi_model.agreement === "MODEL_DISAGREEMENT" ? "disagreement" : a.multi_model.agreement === "CORROBORATED_RESEARCH_EVIDENCE" || a.multi_model.agreement === "CONSISTENT_RESEARCH_NEGATIVE" ? "corroborated" : a.multi_model.agreement === "SINGLE_RESEARCH_MODEL" ? "single" : "insufficient"} label={a.multi_model.agreement.replaceAll("_", " ")} /></div>
              {a.multi_model.models.map((m) => (
                <p key={m.model_id} className="tiny muted" style={{ margin: "0 0 4px" }}>
                  <strong>{m.model_id}</strong> v{m.model_version} ({m.model_status}): {m.output_summary}
                </p>
              ))}
              {a.multi_model.notes.map((n, i) => (
                <p key={i} className="small" style={{ margin: "6px 0 0" }}>{n}</p>
              ))}
              <p className="tiny muted" style={{ margin: "8px 0 0" }}>Agreement compares categorical outputs only; scores are never fused and disagreement never picks a winner.</p>
            </div>
          )}

          {a.patient_context?.reported && (
            <div className="card">
              <div className="card-title">
                <h3>Clinical context · reported symptoms</h3>
                <span style={{ display: "flex", gap: 6 }}><Provenance kind="observed" label="Patient-reported" />{hasRedFlag && <Badge tone="bad">⚠ RED FLAG</Badge>}</span>
              </div>
              {a.patient_context.symptoms.map((s, i) => (
                <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  <div className="small" style={{ fontWeight: 600 }}>
                    {s.label ?? s.type.replaceAll("_", " ")}
                    {redFlags.includes(s.type) && <span style={{ color: "var(--danger)" }}> ⚠</span>}
                  </div>
                  <div className="tiny muted">
                    {s.onset} onset • {s.duration.replaceAll("_", " ")} • {s.severity} •{" "}
                    {s.laterality === "right" ? "right eye" : s.laterality === "left" ? "left eye" : s.laterality} • {s.progression}
                  </div>
                </div>
              ))}
              <p className="tiny muted" style={{ margin: "8px 0 0" }}>{a.patient_context.note}</p>
            </div>
          )}

          {a.symptom_correlation && a.patient_context?.reported && (
            <div className="card">
              <div className="card-title">
                <h3>Symptom / imaging correlation</h3>
                <span style={{ display: "flex", gap: 6 }}><Provenance kind="inferred" label="Rules inference" />
                  <Badge tone={a.symptom_correlation.state === "urgent" ? "bad" : a.symptom_correlation.state === "correlated" ? "info" : "warn"}>
                    {a.symptom_correlation.state.replaceAll("_", " ").toUpperCase()}
                  </Badge></span>
              </div>
              {a.symptom_correlation.items.map((item, i) => (
                <p key={i} className="small" style={{ margin: "6px 0" }}>
                  <strong>{item.symptom_label}</strong>{" "}
                  <Badge tone={item.state === "urgent" ? "bad" : item.state === "correlated" ? "info" : "warn"}>{item.state.replaceAll("_", " ")}</Badge>
                  <span className="muted small" style={{ display: "block", marginTop: 2 }}>{item.note}</span>
                </p>
              ))}
              <p className="tiny muted" style={{ margin: "8px 0 0" }}>
                {a.symptom_correlation.label} • Model input: {a.model_registry?.model_input ?? "IMAGE_ONLY"} • correlation is never
                converted into model confidence.
              </p>
            </div>
          )}

          <div className="card">
            <div className="card-title"><h3>Possible associations</h3><Provenance kind="inferred" /></div>
            {a.possible_conditions && a.possible_conditions.conditions.length > 0 ? (
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {a.possible_conditions.conditions.map((c) => (
                  <li key={c.id} style={{ marginBottom: 6 }}>
                    {c.label} — {c.note}
                    {c.commonly_associated_symptoms.length > 0 && (
                      <div className="tiny muted" style={{ marginTop: 2 }}>
                        Commonly associated symptoms (knowledge base — not necessarily reported by this patient):{" "}
                        {c.commonly_associated_symptoms.map((s) => s.replaceAll("_", " ")).join(", ")}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
                No conditions are displayed: the current model is not validated, and condition inference requires
                documented validation evidence for the specific intended use. These would be associations, never an
                automated diagnosis.
              </p>
            )}
          </div>

          <div className="card">
            <div className="card-title"><h3>Treatment information</h3><Badge tone="warn">Clinician review required</Badge></div>
            {a.treatment_information && a.treatment_information.items.length > 0 ? (
              <>
                {a.treatment_information.items.map((item) => (
                  <div key={item.condition_id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <div className="small" style={{ fontWeight: 650 }}>{item.condition_label}</div>
                    {item.available ? (
                      item.approaches.map((ap, i) => (
                        <div key={i} className="small" style={{ marginTop: 4 }}>
                          <strong>{ap.approach_label}</strong> — {ap.purpose}
                          {ap.medications.length > 0 && (
                            <ul className="tiny muted" style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                              {ap.medications.map((m) => <li key={m.medication_id}>{m.generic_name} ({m.drug_class})</li>)}
                            </ul>
                          )}
                          <div className="tiny muted" style={{ marginTop: 2 }}>Evidence: {ap.evidence_reference}</div>
                        </div>
                      ))
                    ) : (
                      <p className="tiny muted" style={{ margin: "4px 0 0" }}>{item.reason}</p>
                    )}
                  </div>
                ))}
                <p className="tiny muted" style={{ margin: "10px 0 0" }}>
                  {a.treatment_information.dosage_notice} {a.treatment_information.interaction_notice}{" "}
                  {a.treatment_information.note}
                </p>
              </>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
                No treatment information is displayed: treatment information is only generated for conditions that have
                already passed validated-model condition gating, and this deployment has no connected medication
                knowledge source. Evidence-based treatment information is not a prescription and always requires
                clinician review.
              </p>
            )}
          </div>

          <div className="card">
            <div className="card-title"><h3>Uncertainty &amp; limitations</h3></div>
            {/* S12: relabeled - this is a heuristic score from the pipeline's
                quality/agreement heuristics, not calibrated model confidence; a
                bare percentage badge here could be misread as AI confidence. */}
            <p className="tiny muted" style={{ margin: "0 0 8px" }}>
              Heuristic uncertainty score (not calibrated confidence): <strong>{(a.uncertainty.overall * 100).toFixed(0)}%</strong>
            </p>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {a.uncertainty.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        </div>

        {/* ZONE 3 — assessment & human review */}
        <div className="zone zone-assess">
          <div className="zone-label">Assessment &amp; review</div>
          <section className="authority-panel" aria-labelledby="authority-title">
            <div className="authority-kicker"><Icon name="review" size={13} /> Human authority</div>
            <h3 id="authority-title" style={{ marginBottom: 8 }}>Clinician review</h3>
            <div className={`review-status ${reviewStatus === "clinician_finalized" ? "finalized" : "pending"}`}>
              <Icon name={reviewStatus === "clinician_finalized" ? "check" : "clock"} size={18} />
              <span>
                <strong>{reviewStatus === "clinician_finalized" ? "Finalized by a clinician" : reviewStatus === "clinician_reviewed" ? "Review in progress" : "Awaiting clinician review"}</strong>
                <span className="tiny muted">{data.report?.review?.finalized_at ? `${new Date(data.report.review.finalized_at).toLocaleString()}${data.report.review.reviewer_id ? ` · ${data.report.review.reviewer_id}` : ""}` : "No interpretation is authoritative until a qualified clinician finalizes it."}</span>
              </span>
            </div>
            <Link className="btn authority block" style={{ marginTop: 12 }} href={`/clinician?study=${encodeURIComponent(study)}`}><Icon name="review" size={15} /> Open clinical review</Link>
            <p className="tiny muted" style={{ margin: "10px 0 0" }}>AI output, clinician interpretation, and the final report are stored as separate, audited records.</p>
          </section>

          <div className="card">
            <div className="card-title"><h3>Analysis summary</h3></div>
            <dl className="kv tiny" style={{ gridTemplateColumns: "110px 1fr" }}>
              <dt>Study</dt><dd>{data.study?.patient_ref ?? data.study?.study_id.slice(0, 16) + "…"}</dd>
              <dt>Eye</dt><dd>{eyeLabel(a.study?.eye)}</dd>
              <dt>Modality</dt><dd>{modalityLabel(a.study?.modality)}</dd>
              <dt>Image quality</dt>
              <dd>
                <Badge tone={qp.blocked ? "bad" : a.quality.artifacts.length > 0 ? "warn" : "ok"}>{qp.overall_label}</Badge>
              </dd>
              <dt>Model</dt><dd>{a.model_registry?.model_id} v{a.model_registry?.model_version}</dd>
              <dt>Model status</dt><dd><Badge tone="warn">{a.model_registry?.model_status}</Badge></dd>
              <dt>Clinical validation</dt><dd style={{ color: "var(--danger)", fontWeight: 650 }}>NOT VALIDATED</dd>
              <dt>Findings</dt><dd>{abnormal ? `${a.findings.length} (${mode.replaceAll("_", " ")})` : mode === "RESEARCH_MODEL_ANALYSIS" || mode === "MIXED_RESEARCH_AND_DEMO" ? "No target finding detected" : mode === "MODEL_FAILED" ? "Model failed" : mode === "NO_MODEL_EXECUTED" ? "No applicable model" : "None available"}</dd>
              <dt>Symptom correlation</dt><dd>{a.symptom_correlation && a.patient_context?.reported ? `${a.symptom_correlation.state.replaceAll("_", " ")} (research)` : a.patient_context?.reported ? "inconclusive" : "no symptoms reported"}</dd>
              <dt>Urgency</dt><dd>{a.recommendation.priority === "routine_follow_up" ? "No escalation" : "Review recommended"}</dd>
            </dl>
          </div>

          <div className="card">
            <div className="card-title"><h3>Why am I seeing this result?</h3></div>
            <ol className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 7 }}>
              <li><strong>Image quality:</strong> the quality gate measured the image ({a.quality.status}); {a.quality.acceptable ? "analysis proceeded." : "analysis of findings was blocked."}</li>
              <li><strong>Model status:</strong> {mode === "DEMO_ONLY" ? "a registered DEMO placeholder produced labeled synthetic output." : mode === "MODEL_FAILED" ? "the applicable research provider failed; no synthetic replacement was used." : mode === "NO_MODEL_EXECUTED" ? "no compatible research model ran for this asset." : "research model execution completed; outputs are uncalibrated and not clinically validated."}</li>
              <li><strong>Detected findings:</strong> {abnormal ? mode === "DEMO_ONLY" ? `${a.findings.length} synthetic demo signal(s) were generated to exercise the pipeline. They do not derive from image content.` : `${a.findings.length} research model output signal(s) are shown with their provenance.` : mode === "MODEL_FAILED" ? "no findings were produced because model execution failed." : mode === "NO_MODEL_EXECUTED" ? "no findings were produced because no applicable model ran." : "no target findings were emitted by the research model(s) that completed."}</li>
              <li><strong>Model validation:</strong> not clinically validated — results cannot be used clinically and cannot be considered normal.</li>
              <li><strong>Symptom information:</strong> {a.patient_context?.reported ? "reported symptoms were correlated separately by a rules layer AFTER the model ran." : "no symptoms were reported for this study."} {a.model_registry?.model_input === "IMAGE_ONLY" ? "The model analyzes the image only; symptoms are never used as model input." : ""}</li>
            </ol>
          </div>

          {data.study?.study_id && (
            <div style={{ margin: 0 }}>
              <ResearchAnalysisPanel
                studyId={data.study.study_id}
                originalImageUrl={`/api/studies/${encodeURIComponent(study)}/image`}
                eye={data.study.eye}
              />
            </div>
          )}

          {clinicianView && (
            <details className="card" style={{ margin: 0 }} open>
              <summary style={{ cursor: "pointer", fontWeight: 650, fontSize: "0.9rem" }}>MODEL INFORMATION</summary>
              <dl className="kv tiny" style={{ gridTemplateColumns: "120px 1fr", marginTop: 10 }}>
                <dt>Model name</dt><dd>{a.model_registry?.model_id}</dd>
                <dt>Version</dt><dd>{a.model_registry?.model_version}</dd>
                <dt>Modality</dt><dd>{modalityLabel(a.study?.modality)}</dd>
                <dt>Input type</dt><dd>{a.model_registry?.model_input ?? "IMAGE_ONLY"}</dd>
                <dt>Uses symptoms</dt><dd>{a.model_registry?.model_input === "IMAGE_AND_SYMPTOMS" ? "YES" : "NO"}</dd>
                <dt>Supported conditions</dt><dd>None registered</dd>
                <dt>Checksum</dt><dd className="tiny">{checksumNote(a)}</dd>
                <dt>Validation</dt><dd style={{ color: "var(--danger)", fontWeight: 650 }}>NOT VALIDATED</dd>
                <dt>Device compatibility</dt><dd>{a.model_registry?.device_compatibility.note}</dd>
              </dl>
            </details>
          )}

          {clinicianView && data.study?.study_id && (
            <div style={{ margin: 0 }}>
              <DocumentEvidencePanel studyId={data.study.study_id} />
            </div>
          )}

          {clinicianView && data.study?.study_id && (
            <div style={{ margin: 0 }}>
              <EvidenceWorkspacePanel studyId={data.study.study_id} />
            </div>
          )}

          {clinicianView && data.study?.study_id && (
            <div style={{ margin: 0 }}>
              <SpecialistConsensusPanel studyId={data.study.study_id} />
            </div>
          )}
        </div>
      </div>

      {/* ---- Provenance & execution records (always available, collapsed) ---- */}
      <section className="section" aria-labelledby="provenance-title">
        <div className="section-header"><div><div className="eyebrow eyebrow-muted">Audit trail</div><h2 id="provenance-title">Model execution &amp; provenance</h2></div></div>
        <div className="card-stack">
          {a.model_execution && (
            <details className="card disclosure" open={clinicianView}>
              <summary>Model execution <Badge tone={a.model_execution.runtime_status === "COMPLETED" ? "ok" : a.model_execution.models_failed.length ? "bad" : "warn"}>{a.model_execution.runtime_status}</Badge></summary>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Model execution table">
                <table className="table"><thead><tr><th scope="col">Model</th><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Artifact</th></tr></thead><tbody>
                  {[...new Set([...a.model_execution.models_attempted, ...a.model_execution.models_failed, ...a.model_execution.models_skipped.map((x) => x.model_id)])].map((id) => {
                    const status = a.model_execution!.models_executed.includes(id) ? "EXECUTED" : a.model_execution!.models_failed.includes(id) ? "FAILED" : "SKIPPED";
                    const verification = a.model_execution!.artifact_verification?.[id] ?? (a.model_execution!.artifact_hashes[id] ? "EXPECTED_REGISTRY_HASH" : "UNAVAILABLE");
                    return <tr key={id}><td>{id}</td><td>{a.model_execution!.model_versions[id] ?? "—"}</td><td>{status}</td><td className="tiny mono">{verification} {a.model_execution!.artifact_hashes[id] ? `${a.model_execution!.artifact_hashes[id]!.slice(0, 12)}…` : ""}</td></tr>;
                  })}
                </tbody></table>
              </div>
            </details>
          )}

          {a.model_execution_ledger && (
            <details className="card disclosure" open={clinicianView}>
              <summary>Input / model execution ledger <Badge tone="info">{a.model_execution_ledger.length} row(s)</Badge></summary>
              <p className="tiny muted">Server-derived provenance for every primary asset and admitted OCT ROI. Dependency groups show which outputs share the same immutable pixels.</p>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Execution ledger table">
                <table className="table"><thead><tr><th scope="col">Task / model</th><th scope="col">Asset / ROI</th><th scope="col">Eye</th><th scope="col">Eligibility</th><th scope="col">Status</th><th scope="col">Quality / domain</th><th scope="col">Runtime</th></tr></thead><tbody>
                  {a.model_execution_ledger.map((row, i) => <tr key={`${row.model_id}-${row.input_asset_id}-${i}`}><td><strong>{row.task.replaceAll("_", " ")}</strong><div className="tiny muted">{row.model_id} v{row.model_version}</div></td><td className="tiny mono">{row.input_asset_id.slice(0, 16)}…{row.input_roi_id ? <div>ROI {row.input_roi_id.slice(0, 12)}…</div> : null}</td><td>{row.laterality}</td><td>{row.eligibility}</td><td>{row.execution_status}{row.skip_reason ? <div className="tiny muted">{row.skip_reason}</div> : null}</td><td className="tiny">{row.quality_status} / {row.domain_status}</td><td className="num">{row.runtime_ms} ms</td></tr>)}
                </tbody></table>
              </div>
            </details>
          )}

          {a.oct_region_results && a.oct_region_results.length > 0 && (
            <details className="card disclosure" open={clinicianView}>
              <summary>Uploaded PDF assets / OCT regions <Badge tone="info">{a.oct_region_results.length} ROI(s)</Badge></summary>
              <p className="tiny muted">Only bounded OCT_BSCAN regions are eligible for OCT research inference. Source-page and ROI hashes preserve provenance; measurements remain unreviewed document evidence.</p>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="OCT regions table"><table className="table"><thead><tr><th scope="col">Page</th><th scope="col">Eye</th><th scope="col">Content</th><th scope="col">Status</th><th scope="col">ROI hash</th></tr></thead><tbody>
                {a.oct_region_results.map((r) => <tr key={r.asset_id}><td>{r.page}</td><td>{r.laterality}</td><td>{r.content_type}</td><td>{r.status}</td><td className="tiny mono">{r.roi_hash.slice(0, 12)}…</td></tr>)}
              </tbody></table></div>
              {a.oct_aggregation && <p className="tiny muted" style={{ marginBottom: 0 }}>Scan-level aggregation: {a.oct_aggregation.replaceAll("_", " ")} (categorical evidence; no logit averaging).</p>}
            </details>
          )}

          {a.document_routing && a.document_routing.length > 0 && (
            <details className="card disclosure" open={clinicianView}>
              <summary>Document page routing <Badge tone="info">{a.document_routing.reduce((n, d) => n + d.pages.length, 0)} page(s)</Badge></summary>
              {a.document_routing.map((doc) => <div key={doc.document_id} className="table-wrap" tabIndex={0} role="region" aria-label={`Document ${doc.document_id} page routing`} style={{ marginTop: 8 }}><table className="table"><thead><tr><th scope="col">Page</th><th scope="col">Content</th><th scope="col">Modality</th><th scope="col">Eye</th><th scope="col">Method</th></tr></thead><tbody>{doc.pages.map((p) => <tr key={`${doc.document_id}-${p.page}`}><td>{p.page}</td><td>{p.content_type}</td><td>{p.modality}</td><td>{p.laterality}</td><td>{p.classifier_method}</td></tr>)}</tbody></table></div>)}
            </details>
          )}

          {clinicianView && (
            <details className="tech card" open>
              <summary>Advanced technical information</summary>
              <dl className="kv">
                <dt>Pipeline version</dt><dd>{a.provenance.pipeline_version}</dd>
                <dt>Ruleset version</dt><dd>{a.provenance.ruleset_version}</dd>
                <dt>Quality score</dt><dd>{a.quality.score} ({a.quality.status})</dd>
                <dt>Quality artifacts</dt><dd>{a.quality.artifacts.join(", ") || "none"}</dd>
                <dt>Ensemble agreement</dt><dd>{String(a.uncertainty.ensemble_agreement)}</dd>
                <dt>Heuristic uncertainty score</dt><dd>{(a.uncertainty.overall * 100).toFixed(0)}% (not calibrated confidence)</dd>
                <dt>Clinical interpretation gate</dt>
                <dd>{a.diagnosis_gate?.clinical_interpretation === "DIAGNOSIS" ? "DIAGNOSIS" : "REQUIRES CLINICAL CORRELATION"}{a.diagnosis_gate && a.diagnosis_gate.reasons.length > 0 ? ` — ${a.diagnosis_gate.reasons.join(" ")}` : ""}</dd>
                <dt>Localization data</dt><dd>No validated localization data available (future validated models will populate this via the visualization API).</dd>
                <dt>Original SHA-256</dt><dd className="mono" style={{ wordBreak: "break-all", fontSize: "0.76rem" }}>{data.study?.original_sha256}</dd>
              </dl>
            </details>
          )}
        </div>
        {!clinicianView && (
          <p className="tiny muted" style={{ marginTop: 14 }}>
            Presentation Mode is hiding technical/provenance details (model metadata, raw evidence, pipeline internals).
            Safety notices, quality status, and clinical-correlation requirements above are shown in every mode.{" "}
            <button type="button" className="btn ghost sm" onClick={toggleClinicianView}>Switch to Clinician View</button>
          </p>
        )}
      </section>

      <div style={{ display: "flex", gap: 10, marginTop: 24, flexWrap: "wrap" }}>
        <Link className="btn authority" href={`/clinician?study=${encodeURIComponent(study)}`}><Icon name="review" size={15} /> Open clinical review</Link>
        <Link className="btn secondary" href={`/report?study=${encodeURIComponent(study)}`}>Open full report</Link>
        <Link className="btn secondary" href={`/compare?current=${encodeURIComponent(study)}`}>Compare with previous scan</Link>
        <Link className="btn ghost" href="/analyze">Analyze another scan</Link>
      </div>
    </div>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={<div className="page-loading" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" />Loading result…</div>}>
      <ResultInner />
    </Suspense>
  );
}
