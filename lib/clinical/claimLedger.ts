import type {
  AnalysisResult,
  ClaimLedger,
  ClaimLedgerEntry,
  ClaimCertainty,
  ClaimLedgerReleaseStatus,
} from "../analysis/schema";

export const CLAIM_LEDGER_SCHEMA_VERSION = "claim-ledger-1.1.0";

const VALIDATED_MODEL_STATES = new Set(["EXTERNALLY_VALIDATED", "CLINICALLY_VALIDATED"]);

function findingClaim(analysis: AnalysisResult, finding: AnalysisResult["findings"][number]): ClaimLedgerEntry {
  const modelStatus = finding.model_status ?? analysis.model_registry?.model_status ?? "UNKNOWN";
  const modelValidated = VALIDATED_MODEL_STATES.has(modelStatus) && analysis.diagnosis_gate?.allowed === true;
  const evidenceRefs = [
    `finding:${finding.id}`,
    ...(finding.source_asset_id ? [`asset:${finding.source_asset_id}`] : []),
    ...(finding.source_page === undefined ? [] : [`page:${finding.source_page}`]),
  ];
  const blockedReasons = modelValidated
    ? []
    : ["MODEL_NOT_CLINICALLY_VALIDATED", "DIAGNOSIS_GATE_CLOSED"];
  const releaseStatus: ClaimLedgerReleaseStatus = evidenceRefs.length > 0
    ? modelValidated ? "CLINICIAN_REVIEW_REQUIRED" : "RESEARCH_REVIEW_ONLY"
    : "BLOCKED_NO_EVIDENCE";
  const executionRows = (analysis.model_execution_ledger ?? []).filter((row) =>
    row.model_id === finding.model_id &&
    (finding.model_version === undefined || row.model_version === finding.model_version) &&
    (finding.source_asset_id === undefined || row.input_asset_id === finding.source_asset_id),
  );
  const sourceIds = [
    ...(finding.source_asset_id ? [`asset:${finding.source_asset_id}`] : []),
    ...(finding.source_page === undefined ? [] : [`document-page:${finding.source_page}`]),
  ];
  const certainty: ClaimCertainty = modelStatus === "RESEARCH" || modelStatus === "INTERNAL_VALIDATION"
    ? "RESEARCH_SCORE_ONLY"
    : finding.confidence_category === "HIGH CONFIDENCE" ? "HIGH"
      : finding.confidence_category === "MODERATE CONFIDENCE" ? "MODERATE"
        : finding.confidence_category === "LOW CONFIDENCE" ? "LOW" : "UNKNOWN";
  return {
    claim_id: `claim:${finding.id}`,
    claim_type: "OBSERVATION",
    text: finding.explanation,
    release_status: releaseStatus,
    evidence_refs: evidenceRefs,
    laterality: finding.laterality ?? analysis.study.eye,
    provenance: {
      study_id: analysis.study.study_id,
      finding_id: finding.id,
      source_asset_id: finding.source_asset_id ?? null,
      source_page: finding.source_page ?? null,
      model_id: finding.model_id,
      model_version: finding.model_version ?? null,
      model_status: modelStatus,
    },
    blocked_reasons: blockedReasons,
    clinician_review_required: true,
    certainty,
    source_ids: sourceIds,
    model_execution_ids: executionRows.map((row) => `model-execution:${row.model_id}:${row.input_asset_id}:${row.input_roi_id ?? "primary"}`),
    rule_ids: ["rule:claim-ledger-evidence-gate", "rule:research-review-boundary"],
    knowledge_source_ids: [],
  };
}

export function buildClaimLedger(analysis: AnalysisResult): ClaimLedger {
  const entries: ClaimLedgerEntry[] = analysis.findings.map((finding) => findingClaim(analysis, finding));
  const recommendationRefs = [
    `quality:${analysis.quality.status}`,
    ...analysis.findings.map((finding) => `finding:${finding.id}`),
    ...(analysis.patient_context?.symptoms ?? []).map((symptom) => `symptom:${symptom.type}`),
  ];
  entries.push({
    claim_id: `claim:triage:${analysis.study.study_id}`,
    claim_type: "TRIAGE_RECOMMENDATION",
    text: analysis.recommendation.action,
    release_status: recommendationRefs.length > 0 ? "CLINICIAN_REVIEW_REQUIRED" : "BLOCKED_NO_EVIDENCE",
    evidence_refs: recommendationRefs,
    laterality: analysis.study.eye,
    provenance: {
      study_id: analysis.study.study_id,
      finding_id: null,
      source_asset_id: analysis.asset_routing?.source_hash ?? null,
      source_page: null,
      model_id: null,
      model_version: null,
      model_status: "RULES_ONLY",
    },
    blocked_reasons: [],
    clinician_review_required: true,
    certainty: "RULE_DERIVED",
    source_ids: recommendationRefs.filter((ref) => ref.startsWith("asset:") || ref.startsWith("symptom:")),
    model_execution_ids: [],
    rule_ids: ["rule:quality-gate", "rule:conservative-triage", "rule:claim-ledger-evidence-gate"],
    knowledge_source_ids: [],
  });

  const publicationBlocked = entries.some((entry) => entry.release_status === "BLOCKED_NO_EVIDENCE");
  return {
    schema_version: CLAIM_LEDGER_SCHEMA_VERSION,
    entries,
    publication_status: publicationBlocked ? "BLOCKED" : "RESEARCH_REVIEW_ONLY",
    publication_blocked: publicationBlocked,
    note: "Every presentation-facing claim must retain evidence references and provenance. Research output remains review-only; blocked claims cannot be published.",
  };
}
