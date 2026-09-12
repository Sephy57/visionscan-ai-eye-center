import type { AnalysisResult, Finding } from "../analysis/schema";
import type { ConditionAssessment, EvidenceItem } from "../evidence/types";
import type { SpecialtyId } from "./specialistRegistry";

/**
 * A deterministic hand-off package for a clinician.  This is deliberately a
 * view over already-produced evidence; it never runs a model, invents a
 * finding, assigns a probability, or emits a diagnosis.
 */
export type SpecialistPackageId =
  | "RETINA" | "GLAUCOMA" | "MACULA_OCT" | "COMPREHENSIVE"
  | SpecialtyId;
export type SpecialistModelStatus = "RESEARCH_ONLY" | "NO_VALIDATED_MODEL_AVAILABLE" | "MIXED_RESEARCH_AND_UNAVAILABLE";

const LEGACY_PACKAGE_IDS: SpecialistPackageId[] = ["RETINA", "GLAUCOMA", "MACULA_OCT", "COMPREHENSIVE"];
const PHASE2_SPECIALTY_IDS: SpecialtyId[] = [
  "COMPREHENSIVE_OPHTHALMOLOGY", "RETINA", "GLAUCOMA", "CORNEA_EXTERNAL_DISEASE",
  "CATARACT_LENS", "NEURO_OPHTHALMOLOGY", "PEDIATRIC_OPHTHALMOLOGY",
  "UVEITIS_INFLAMMATION", "OCULAR_ONCOLOGY",
];

export interface SpecialistEvidenceReference {
  evidence_id: string;
  source_type: EvidenceItem["source_type"];
  category: string;
  laterality: EvidenceItem["laterality"];
  summary: string;
}

export interface SpecialistObservedFinding {
  finding_id: string;
  category: string;
  laterality: EvidenceItem["laterality"];
  summary: string;
  model_id?: string;
  model_status?: string;
  evidence_id?: string;
}

export interface SpecialistEvidencePackage {
  specialty: SpecialistPackageId;
  available_models: Array<{ model_id: string; model_version: string; task: string; status: string; limitation: string }>;
  model_status: SpecialistModelStatus;
  observed_findings: SpecialistObservedFinding[];
  supporting_evidence: SpecialistEvidenceReference[];
  contradicting_evidence: SpecialistEvidenceReference[];
  missing_evidence: string[];
  possible_conditions: ConditionAssessment[];
  urgency_notes: string[];
  limitations: string[];
  requires_clinician_review: true;
  provenance: { package_version: string; generated_at: string; source_evidence_ids: string[]; source_analysis_present: boolean };
}

export const SPECIALIST_PACKAGE_VERSION = "specialist-package-1.0.0";

const CONDITION_BY_SPECIALTY: Partial<Record<SpecialistPackageId, string[]>> = {
  RETINA: ["diabetic_retinal_disease_pattern", "macular_thickening_pattern", "oct_macular_class_pattern", "acute_vision_change_pattern"],
  GLAUCOMA: ["iop_evidence_pattern", "optic_nerve_evidence_pattern"],
  MACULA_OCT: ["macular_thickening_pattern", "oct_macular_class_pattern"],
  COMPREHENSIVE: [],
};

function domainFor(specialty: SpecialistPackageId): "COMPREHENSIVE" | "RETINA" | "GLAUCOMA" | "MACULA_OCT" | "OTHER" {
  if (specialty === "COMPREHENSIVE" || specialty === "COMPREHENSIVE_OPHTHALMOLOGY") return "COMPREHENSIVE";
  if (specialty === "MACULA_OCT") return "MACULA_OCT";
  if (specialty === "GLAUCOMA") return "GLAUCOMA";
  if (specialty === "RETINA") return "RETINA";
  return "OTHER";
}

function conditionIdsFor(specialty: SpecialistPackageId): string[] {
  const domain = domainFor(specialty);
  if (domain === "OTHER") return [];
  return CONDITION_BY_SPECIALTY[specialty] ?? CONDITION_BY_SPECIALTY[domain] ?? [];
}

function ref(item: EvidenceItem): SpecialistEvidenceReference {
  return { evidence_id: item.id, source_type: item.source_type, category: item.category, laterality: item.laterality, summary: item.qualitative_finding ?? (item.value !== undefined ? `${item.value}${item.unit ? ` ${item.unit}` : ""}` : item.presence) };
}

function findingsFor(specialty: SpecialistPackageId, analysis: AnalysisResult | null | undefined, evidence: EvidenceItem[]): SpecialistObservedFinding[] {
  const out: SpecialistObservedFinding[] = [];
  const domain = domainFor(specialty);
  const matches = (f: Finding): boolean => {
    if (domain === "GLAUCOMA") return /optic|disc|cup|rnfl|nerve/i.test(f.type) || /optic|disc|cup|rnfl/i.test(f.location);
    if (domain === "MACULA_OCT") return /mac|oct|fluid|thick|cyst|dru/i.test(`${f.type} ${f.location}`);
    if (domain === "RETINA" || domain === "COMPREHENSIVE") return true;
    return true;
  };
  for (const f of (analysis?.findings ?? []).filter(matches)) {
    const linked = evidence.find((e) => e.source_type === "AI_FINDING" && e.source_id === f.id);
    out.push({ finding_id: f.id, category: f.type, laterality: linked?.laterality ?? "UNKNOWN", summary: f.explanation, model_id: f.model_id, model_status: f.model_status, evidence_id: linked?.id });
  }
  // Objective values are observations too, even when no image model ran.
  for (const e of evidence.filter((x) => x.source_type === "TEST_RESULT" && (domain === "COMPREHENSIVE" || (domain === "GLAUCOMA" && /IOP|CUP|VISUAL_FIELD|OCT|RNFL|PACHY/i.test(x.category)) || (domain === "MACULA_OCT" && /CST|OCT/i.test(x.category))))) {
    out.push({ finding_id: e.id, category: e.category, laterality: e.laterality, summary: ref(e).summary, evidence_id: e.id });
  }
  return out;
}

function modelInventory(specialty: SpecialistPackageId, analysis: AnalysisResult | null | undefined): SpecialistEvidencePackage["available_models"] {
  const domain = domainFor(specialty);
  const models = analysis?.multi_model?.models ?? [];
  const out = models
    .filter((m) => domain !== "GLAUCOMA" || /optic|disc|cup|glaucoma/i.test(`${m.model_id} ${m.output_summary}`))
    .map((m) => ({ model_id: m.model_id, model_version: m.model_version, task: "research image observation", status: m.model_status, limitation: "Research-only output; not a diagnosis or calibrated probability." }));
  if (analysis?.model_registry && (domain === "RETINA" || domain === "COMPREHENSIVE")) {
    const m = analysis.model_registry;
    if (!out.some((x) => x.model_id === m.model_id)) out.push({ model_id: m.model_id, model_version: m.model_version, task: "research image observation", status: m.model_status, limitation: "Research-only output; narrow target coverage and clinician review required." });
  }
  return out;
}

function missingFor(specialty: SpecialistPackageId, evidence: EvidenceItem[], analysis: AnalysisResult | null | undefined): string[] {
  const domain = domainFor(specialty);
  const has = (re: RegExp) => evidence.some((e) => re.test(e.category) && e.presence === "PRESENT");
  const missing: string[] = [];
  if (domain === "GLAUCOMA") {
    if (!has(/IOP/i)) missing.push("documented IOP for each eye");
    if (!has(/VISUAL_FIELD/i)) missing.push("reliable visual-field indices and pattern");
    if (!has(/OCT|RNFL|CUP/i) && !(analysis?.findings ?? []).some((f) => /optic|disc|cup|rnfl/i.test(`${f.type} ${f.location}`))) missing.push("clinician optic-nerve examination and RNFL/OCT correlation");
    missing.push("clinician-authored diagnosis and longitudinal progression assessment");
  } else if (domain === "MACULA_OCT") {
    if (!has(/OCT|CST/i)) missing.push("OCT B-scan review and fluid/layer localization");
    missing.push("clinician macular examination and validated disease confirmation");
  } else if (domain === "RETINA") {
    missing.push("dilated clinician retinal examination and validated disease classification");
  } else if (specialty === "CORNEA_EXTERNAL_DISEASE") {
    missing.push("slit-lamp/external-eye examination and corneal surface documentation");
    missing.push("NO COMPATIBLE IMAGE MODEL");
  } else if (specialty === "CATARACT_LENS") {
    missing.push("lens examination and validated cataract grading");
    missing.push("NO COMPATIBLE IMAGE MODEL");
  } else if (specialty === "NEURO_OPHTHALMOLOGY") {
    missing.push("visual fields, pupils, neurologic examination, and clinician synthesis");
    missing.push("NO COMPATIBLE IMAGE MODEL");
  } else if (specialty === "PEDIATRIC_OPHTHALMOLOGY") {
    missing.push("age-appropriate examination and pediatric population validation");
    missing.push("NO COMPATIBLE IMAGE MODEL");
  } else if (specialty === "UVEITIS_INFLAMMATION") {
    missing.push("slit-lamp/inflammatory examination and systemic correlation");
    missing.push("NO COMPATIBLE IMAGE MODEL");
  } else if (specialty === "OCULAR_ONCOLOGY") {
    missing.push("specialist examination and validated lesion/referral assessment");
    missing.push("NO COMPATIBLE IMAGE MODEL");
  } else {
    missing.push("clinician synthesis of all available history, examination and test evidence");
  }
  return [...new Set(missing)];
}

function urgencyFor(evidence: EvidenceItem[], conditions: ConditionAssessment[]): string[] {
  const notes: string[] = [];
  const red = evidence.filter((e) => e.source_type === "SYMPTOM" && e.presence === "PRESENT" && /sudden_vision_loss|new_floaters|curtain_shadow|chemical_exposure|trauma_with_vision_loss|severe_pain/i.test(e.category));
  if (red.length) notes.push("Documented red-flag symptom evidence is present; follow the independent urgent/emergency triage pathway.");
  if (conditions.some((c) => c.red_flag_candidates.length > 0)) notes.push("A condition pattern has a red-flag candidate; clinician review is required and no urgency is inferred from image absence.");
  if (!notes.length) notes.push("No urgency is inferred by this specialist package; use the independent symptom/clinician triage result.");
  return notes;
}

export function buildSpecialistEvidencePackages(input: {
  analysis?: AnalysisResult | null;
  evidence: EvidenceItem[];
  possible_conditions?: ConditionAssessment[];
  generated_at?: string;
  /** Return the exact nine Phase 2 specialty lanes instead of the legacy
   * four-package compatibility view. */
  allSpecialties?: boolean;
}): SpecialistEvidencePackage[] {
  const analysis = input.analysis ?? null;
  const evidence = input.evidence;
  const allConditions = input.possible_conditions ?? [];
  const generatedAt = input.generated_at ?? new Date().toISOString();
  const packageIds = input.allSpecialties ? PHASE2_SPECIALTY_IDS : LEGACY_PACKAGE_IDS;
  return packageIds.map((specialty) => {
    const domain = domainFor(specialty);
    const available_models = modelInventory(specialty, analysis);
    const observed_findings = findingsFor(specialty, analysis, evidence);
    const relevant = evidence.filter((e) => {
      if (domain === "COMPREHENSIVE") return true;
      if (domain === "GLAUCOMA") return /IOP|CUP|VISUAL_FIELD|RNFL|OCT|family|optic|disc|glaucoma/i.test(`${e.category} ${e.qualitative_finding ?? ""}`);
      if (domain === "MACULA_OCT") return /OCT|CST|mac|fluid|thick|cyst|dru/i.test(`${e.category} ${e.qualitative_finding ?? ""}`);
      if (domain === "RETINA") return /AI_FINDING|TEST_RESULT|SYMPTOM|HISTORY|SOURCE_DOCUMENT/i.test(e.source_type);
      return /SYMPTOM|TEST_RESULT|HISTORY|SOURCE_DOCUMENT|AI_FINDING/i.test(e.source_type);
    });
    const supporting = relevant.filter((e) => e.presence === "PRESENT" && e.trust_level !== "REJECTED").map(ref);
    const contradicting = relevant.filter((e) => e.conflict_ids.length > 0 || e.presence === "ABSENT").map(ref);
    const conditionIds = conditionIdsFor(specialty);
    const possible_conditions = allConditions.filter((c) => domain === "COMPREHENSIVE" || conditionIds.some((id) => c.condition_id.includes(id) || c.category.includes(id)));
    const model_status: SpecialistModelStatus = available_models.length === 0 ? "NO_VALIDATED_MODEL_AVAILABLE" : available_models.some((m) => /VALIDATED/i.test(m.status)) ? "MIXED_RESEARCH_AND_UNAVAILABLE" : "RESEARCH_ONLY";
    const limitations = [
      "This package is deterministic evidence organization, not an AI diagnosis.",
      "Research model outputs are uncalibrated and narrow; a negative target result does not exclude other disease.",
      ...(domain === "GLAUCOMA" ? ["No validated glaucoma disease-classification model is available in this deployment."] : []),
      ...(available_models.length === 0 && input.allSpecialties ? ["NO COMPATIBLE IMAGE MODEL"] : []),
    ];
    return {
      specialty,
      available_models,
      model_status,
      observed_findings,
      supporting_evidence: supporting,
      contradicting_evidence: contradicting,
      missing_evidence: missingFor(specialty, evidence, analysis),
      possible_conditions,
      urgency_notes: urgencyFor(evidence, possible_conditions),
      limitations,
      requires_clinician_review: true,
      provenance: { package_version: SPECIALIST_PACKAGE_VERSION, generated_at: generatedAt, source_evidence_ids: evidence.map((e) => e.id), source_analysis_present: !!analysis },
    };
  });
}

export function specialistIdToRegistryId(id: SpecialistPackageId): SpecialtyId {
  if (id === "COMPREHENSIVE") return "COMPREHENSIVE_OPHTHALMOLOGY";
  if (id === "MACULA_OCT") return "RETINA";
  return id;
}
