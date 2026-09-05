import { SYMPTOM_MAP, SymptomTypeDef, DurationBand, Onset, Laterality } from "../../clinical/symptoms";

/**
 * Automatic clinical extraction (eye-center workspace).
 *
 * WHAT THIS IS: a deterministic, rule-based extractor that turns the text
 * of an already-extracted document artifact (text layer or OCR) into
 * CANDIDATE structured facts:
 *   - symptoms (restricted to the controlled vocabulary in
 *     lib/clinical/symptoms.ts - anything outside the vocabulary is NOT
 *     extracted, never invented into a near-match type)
 *   - medications (raw-name only; normalization is a separate, explicit
 *     step in lib/treatment/medicationNormalization.ts)
 *   - allergies (raw allergen text; reaction only when explicitly written)
 *   - chief complaint, history/family-history and exam-text candidates
 *   - systemic-history candidates (diabetes / hypertension)
 *
 * HARD RULES:
 *  - NOTHING is fabricated. A fact exists only because its text appears in
 *    the document. Every extracted item carries `raw_text` quoted from the
 *    document (the provenance anchor) and the page it came from.
 *  - Fields are set ONLY when the document states them: laterality, onset,
 *    duration, severity are omitted (never guessed) when absent. Absence
 *    here means NOT_REPORTED - it never means "no".
 *  - Documented negations ("no photophobia", "denies floaters", "NKDA") are
 *    recorded as EXPLICIT_NEGATIONS - they are the opposite of a symptom
 *    and are kept separately; they never create a positive symptom.
 *  - Everything extracted is UNREVIEWED data with provenance
 *    DOCUMENT_EXTRACTED. It must pass clinician verification before it is
 *    treated as anything more than a candidate.
 *  - Extraction confidence is EXTRACTION-ONLY (how sure the pattern match
 *    is). It is NOT clinical or diagnostic confidence and must never be
 *    presented as one.
 *  - This module never calls the network, never calls an LLM, and never feeds
 *    the image model or diagnosis gate directly. Its candidates are included
 *    in the evidence workspace with AUTO_EXTRACTED provenance and may raise a
 *    clearly labelled pre-review urgency signal; only a clinician promotes
 *    them to HUMAN_VERIFIED evidence.
 */

export const CLINICAL_EXTRACTION_VERSION = "clinical-extraction-1.0.0";

export type ExtractionVerification = "UNREVIEWED" | "VERIFIED_BY_CLINICIAN" | "CORRECTED_BY_CLINICIAN" | "REJECTED_BY_CLINICIAN";

/** Extraction certainty is separate from clinician verification. A phrase
 * such as "possible flashes" remains useful review evidence, but is not an
 * explicit report. This is never a clinical/model confidence score. */
export type ExtractionCertainty = "EXPLICIT" | "UNCERTAIN";

export interface ExtractedSymptom {
  item_id: string;
  type: string;                 // always a key of SYMPTOM_MAP (controlled vocabulary)
  raw_text: string;             // quoted from the document - the provenance anchor
  page_index: number;           // 0-based page the sentence came from
  laterality?: Laterality;      // only when the document states it in the same sentence
  onset?: Onset;                // only when the document states it
  duration?: DurationBand;      // only when the document states it
  severity?: "mild" | "moderate" | "severe"; // only when the document states it
  certainty?: ExtractionCertainty; // UNCERTAIN for "possible/may have" language
  extraction_confidence: number; // 0..1 EXTRACTION confidence (pattern-match quality), NOT clinical
  confidence_basis: "EXACT_PHRASE" | "SENTENCE_CO_OCCURRENCE";
  source: "DOCUMENT_EXTRACTED";
  verification: ExtractionVerification;
}

export interface ExplicitNegation {
  item_id: string;
  kind: "SYMPTOM" | "ALLERGY" | "SYSTEMIC_CONDITION";
  type?: string;                // symptom vocabulary key, when resolvable
  raw_text: string;
  page_index: number;
}

export interface ExtractedMedication {
  item_id: string;
  name_raw: string;             // exactly as written in the document
  form_hint?: "eye_drops" | "oral" | "injection" | "unknown"; // only from explicit wording
  dose_raw?: string;            // only when written next to the name
  page_index: number;
  normalization_status: "UNNORMALIZED"; // normalization is a separate explicit step
  source: "DOCUMENT_EXTRACTED";
  verification: ExtractionVerification;
}

export interface ExtractedAllergy {
  item_id: string;
  allergen_raw: string;
  reaction_raw?: string;        // only when the document states the reaction
  page_index: number;
  source: "DOCUMENT_EXTRACTED";
  verification: ExtractionVerification;
}

/** A non-diagnostic history/exam candidate copied from a source document. */
export interface ExtractedHistoryCandidate {
  item_id: string;
  kind: "OCULAR_HISTORY" | "OCULAR_SURGERY" | "FAMILY_HISTORY" | "EXAM_FINDING";
  value_raw: string;
  raw_text: string;
  page_index: number;
  laterality?: Laterality;
  date_raw?: string;
  source: "DOCUMENT_EXTRACTED";
  verification: ExtractionVerification;
}

/** A labelled chief-complaint field, retained separately from symptoms. */
export interface ExtractedChiefComplaint {
  value_raw: string;
  raw_text: string;
  page_index: number;
  source: "DOCUMENT_EXTRACTED";
  verification: ExtractionVerification;
}

/** A diagnosis claim copied from a source document, never a VisionScan diagnosis. */
export interface SourceDocumentDiagnosis {
  item_id: string;
  document_id: string;
  diagnosis_raw: string;
  raw_text: string;
  page_index: number;
  /** 1-based page alias for reviewers and API consumers. */
  page: number;
  /** Optional source-document labels; absent means the document did not state them. */
  date_raw?: string;
  source_clinician_raw?: string;
  source: "DOCUMENT_EXTRACTED";
  verification: ExtractionVerification;
}

export interface SystemicCandidate {
  item_id: string;
  condition: "diabetes" | "hypertension";
  raw_text: string;
  page_index: number;
  source: "DOCUMENT_EXTRACTED";
  verification: ExtractionVerification;
}

export interface RecordExtraction {
  document_id: string;
  study_id: string;
  patient_ref?: string;
  extracted_at: string;
  extraction_version: string;
  status: "COMPLETE" | "FAILED";
  error_code?:
    | "NO_TEXT_EXTRACTED"
    | "EXTRACTION_FAILED";
  symptoms: ExtractedSymptom[];
  explicit_negations: ExplicitNegation[];
  medications: ExtractedMedication[];
  allergies: ExtractedAllergy[];
  systemic_candidates: SystemicCandidate[];
  source_document_diagnoses: SourceDocumentDiagnosis[];
  ocular_history_candidates: ExtractedHistoryCandidate[];
  family_history_candidates: ExtractedHistoryCandidate[];
  exam_findings: ExtractedHistoryCandidate[];
  chief_complaint?: ExtractedChiefComplaint;
  counts: { pages_scanned: number; sentences_scanned: number };
}

// ---------------------------------------------------------------------------
// Controlled-vocabulary phrase map. Every entry maps to a SYMPTOM_MAP key.
// Phrases are lowercase; matching is case-insensitive word-boundary based.
// ---------------------------------------------------------------------------

type SymptomPhraseSpec = {
  type: string;
  phrases: string[];            // any of these alone extracts the symptom
};

const SYMPTOM_PHRASES: SymptomPhraseSpec[] = [
  { type: "blurred_vision", phrases: ["blurred vision", "blurring of vision", "blurring", "vision is blurry", "blurry vision", "hazy vision"] },
  { type: "sudden_vision_loss", phrases: ["sudden loss of vision", "sudden vision loss", "sudden painless loss of vision", "painless loss of vision", "sudden decrease in vision", "sudden deterioration of vision", "acutely lost vision"] },
  { type: "gradual_vision_loss", phrases: ["gradual loss of vision", "gradual vision loss", "progressive vision loss", "gradually worsening vision", "slowly worsening vision"] },
  { type: "reduced_central_vision", phrases: ["central vision is reduced", "loss of central vision", "central scotoma"] },
  { type: "reduced_peripheral_vision", phrases: ["peripheral vision", "side vision is reduced", "loss of side vision", "peripheral field loss"] },
  { type: "distorted_vision", phrases: ["distorted vision", "metamorphopsia", "distortion of vision", "straight lines appear wavy"] },
  { type: "double_vision", phrases: ["double vision", "diplopia", "seeing double"] },
  { type: "night_vision_difficulty", phrases: ["night vision", "difficulty seeing at night", "difficulty driving at night", "nyctalopia"] },
  { type: "reduced_contrast", phrases: ["contrast sensitivity", "reduced contrast", "washed out colors", "colours look faded", "colors look faded"] },
  { type: "transient_vision_changes", phrases: ["transient vision", "transient loss of vision", "transient blurring", "vision comes and goes"] },
  { type: "floaters", phrases: ["floaters"] },
  { type: "new_floaters", phrases: ["new floaters", "new onset of floaters", "recent floaters", "sudden floaters"] },
  { type: "flashes", phrases: ["flashes of light", "flashing lights", "photopsia", "flashes in", "light flashes", "flashes"] },
  { type: "curtain_shadow", phrases: ["curtain", "shadow over", "shade over", "dark curtain", "veil over"] },
  { type: "spots_in_vision", phrases: ["spots in", "black spots", "dark spots in"] },
  { type: "wavy_lines", phrases: ["wavy lines", "lines look wavy", "wavy vision"] },
  { type: "missing_vision_areas", phrases: ["missing areas", "gap in my vision", "gap in vision", "blank area"] },
  { type: "eye_pain", phrases: ["eye pain", "ocular pain", "pain in the eye", "pain in my eye", "painful eye", "painful red eye", "painful red right eye", "painful red left eye", "painful right eye", "painful left eye", "aching eye", "eye ache", "sore eye"] },
  { type: "redness", phrases: ["redness", "red eye", "red right eye", "red left eye", "eyes are red", "injected conjunctiva", "bloodshot"] },
  { type: "burning", phrases: ["burning", "stinging"] },
  { type: "itching", phrases: ["itching", "itchy"] },
  { type: "light_sensitivity", phrases: ["photophobia", "light sensitivity", "sensitive to light", "light hurts"] },
  { type: "foreign_body_sensation", phrases: ["foreign body sensation", "foreign-body sensation", "something in my eye", "gritty"] },
  { type: "pressure_sensation", phrases: ["pressure sensation", "feeling of pressure", "pressure behind the eye", "pressure in the eye"] },
  { type: "recent_eye_trauma", phrases: ["eye trauma", "ocular trauma", "eye injury", "injured eye", "hit in the eye", "struck in the eye", "poked in the eye"] },
  { type: "recent_eye_procedure", phrases: ["eye surgery", "cataract surgery", "post-operative day", "postoperative day", "status post cataract", "after eye surgery", "vitrectomy", "retinal laser", "eye injection", "intravitreal injection"] },
  { type: "chemical_exposure", phrases: ["chemical exposure", "chemical splash", "chemical burn", "acid in the eye", "alkali in the eye", "cement in the eye", "splashed with"] },
];

// Sentence-level co-occurrence combos (handoff §19/§12): both halves must
// occur in the SAME sentence, otherwise nothing is extracted.
const CO_OCCURRENCE_RULES: Array<{
  type: string;
  requires: string[][];         // ALL groups must each match somewhere in the sentence
  phraseForProvenance: string;  // which first match becomes raw_text
}> = [
  { type: "severe_pain_with_nausea", requires: [["severe pain", "severe eye pain", "excruciating"], ["nausea", "vomiting", "nauseous"]], phraseForProvenance: "pain+nausea" },
  { type: "headache_with_visual_symptoms", requires: [["headache"], ["vision", "visual", "see"]], phraseForProvenance: "headache" },
  { type: "trauma_with_vision_loss", requires: [["trauma", "injury", "injured", "hit in the eye", "struck"], ["vision loss", "loss of vision", "cannot see", "can't see", "decreased vision", "reduced vision"]], phraseForProvenance: "trauma" },
];

const NEGATION_TRIGGERS = /\b(no|not|denies|denied|deny|without|free of|negative for|never had)\b/i;
const UNCERTAINTY_TRIGGERS = /\b(possible|possibly|questionable|uncertain|may have|might have|could have|cannot exclude|can't exclude)\b/i;
const NKDA_PATTERNS = [/\bnkda\b/i, /\bno known (drug )?allerg/i, /\bdenies allerg/i];

const MEDICATION_NAMES = [
  // ophthalmic
  "timolol", "latanoprost", "travoprost", "bimatoprost", "dorzolamide", "brinzolamide", "acetazolamide",
  "brimonidine", "apraclonidine", "pilocarpine", "atropine", "homatropine", "tropicamide",
  "prednisolone", "dexamethasone", "loteprednol", "fluorometholone",
  "ofloxacin", "moxifloxacin", "ciprofloxacin", "tobramycin", "gentamicin", "erythromycin", "bacitracin",
  "azithromycin", "doxycycline", "trifluridine", "ganciclovir", "acyclovir", "valacyclovir",
  "ketorolac", "nepafenac", "bromfenac", "diclofenac", "flurbiprofen",
  "artificial tears", "carboxymethylcellulose", "cyclosporine", "lifitegrast",
  "riociguat", "ranibizumab", "bevacizumab", "aflibercept", "faricimab", "brolucizumab",
  // systemic (common)
  "metformin", "insulin", "glipizide", "empagliflozin", "sitagliptin",
  "amlodipine", "lisinopril", "losartan", "valsartan", "atenolol", "metoprolol", "carvedilol", "hydrochlorothiazide", "furosemide",
  "atorvastatin", "simvastatin", "rosuvastatin", "aspirin", "clopidogrel", "warfarin", "apixaban", "rivaroxaban",
  "ibuprofen", "naproxen", "acetaminophen", "paracetamol", "tramadol", "morphine",
  "omeprazole", "pantoprazole", "levothyroxine", "sertraline", "amitriptyline", "gabapentin", "pregabalin",
  "amoxicillin", "penicillin", "cephalexin", "clindamycin", "ciprofloxacin",
];

const ALLERGY_PATTERNS: Array<{ re: RegExp; allergenGroup: number; reactionGroup?: number }> = [
  { re: /\ballergic to\s+([a-z0-9\-\s]{2,40}?)\s+with\s+([a-z0-9\-\s]{2,40}?)(?:[.,;]|$)/gi, allergenGroup: 1, reactionGroup: 2 },
  { re: /\ballergy to\s+([a-z0-9\-\s]{2,40}?)\s+with\s+([a-z0-9\-\s]{2,40}?)(?:[.,;]|$)/gi, allergenGroup: 1, reactionGroup: 2 },
  { re: /\ballergic to\s+([a-z0-9\-\s]{2,60}?)(?:[.,;]| causing| which| since| with|$)/gi, allergenGroup: 1 },
  { re: /\ballergy to\s+([a-z0-9\-\s]{2,60}?)(?:[.,;]| causing| which| since| with|$)/gi, allergenGroup: 1 },
  { re: /\ballergy:\s*([a-z0-9\-\s,]{2,60})/gi, allergenGroup: 1 },
  { re: /\ballergies:\s*([a-z0-9\-\s,]{2,60})/gi, allergenGroup: 1 },
  { re: /([a-z0-9\-\s]{2,40}?)\s+allergy\s+with\s+([a-z0-9\-\s]{2,40}?)(?:[.,;]|$)/gi, allergenGroup: 1, reactionGroup: 2 },
];

const DIABETES_PATTERN = /\b(history of diabetes|known diabetic|diabetic|diabetes mellitus|type 2 diabetes|type 1 diabetes|diabetes)\b/i;
const HYPERTENSION_PATTERN = /\b(history of hypertension|hypertension|high blood pressure|htn)\b/i;
// Only capture an explicitly labelled source claim. Free prose such as
// "diagnosis was considered" is intentionally not normalized into a claim.
const SOURCE_DIAGNOSIS_PATTERN = /\b(?:diagnosis|diagnoses|assessment)\s*:\s*([^\n.;]{2,120})/i;
const SOURCE_DATE_PATTERN = /\b(?:date|dated|encounter date|visit date)\s*[:=-]?\s*([^\s,.;]{2,30})/i;
const SOURCE_CLINICIAN_PATTERN = /\b(?:clinician|provider|physician|author)\s*[:=-]\s*([^\n.;]{2,100})/i;
const CHIEF_COMPLAINT_PATTERN = /\bchief\s+complaint\s*[:=-]\s*([^\n.;]{2,160})/i;
const FAMILY_HISTORY_PATTERN = /\bfamily\s+history\s*(?:of|:|-)?\s*([^\n.;]{2,160})/i;
const OCULAR_SURGERY_PATTERN = /\b(?:status\s+post|s\/p|prior|previous|history\s+of|hx\s+of)\s+([^\n.;]{2,120}\b(?:surgery|procedure|vitrectomy|laser|injection|transplant|lasik|prk))\b/i;
const OCULAR_HISTORY_PATTERN = /\b(?:prior|previous|history\s+of|hx\s+of|known)\s+([^\n.;]{2,120})/i;
const EXAM_FINDING_PATTERN = /\b(?:exam(?:ination)?|slit[- ]lamp|fundus|optic\s+disc|external\s+exam)\s*(?:findings?|exam)?\s*[:=-]\s*([^\n.;]{2,180})/i;

const MAX_ITEMS_PER_CATEGORY = 50;
const MAX_RAW_LEN = 160;

// ---------------------------------------------------------------------------
// Extraction engine
// ---------------------------------------------------------------------------

interface Sentence {
  page: number;
  text: string;
}

function splitSentences(pages: { page: number; text: string }[]): Sentence[] {
  const out: Sentence[] = [];
  for (const p of pages) {
    if (!p.text) continue;
    // Keep a `Diagnosis: ...` label in one sentence; a colon is a field
    // separator, not a clinical sentence boundary.
    for (const raw of p.text.split(/(?<=[.!?;\n])\s+|\n+/)) {
      const t = raw.trim();
      if (t.length >= 3) out.push({ page: p.page, text: t });
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface PhraseMatch {
  raw: string;
  index: number;
}

/** Find the earliest valid phrase, preferring the longest phrase at a given
 * position. This preserves specialized vocabulary such as "new floaters". */
function findPhraseMatch(sentence: string, phrases: string[]): PhraseMatch | null {
  let best: PhraseMatch | null = null;
  for (const phrase of phrases) {
    const match = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i").exec(sentence);
    if (!match) continue;
    if (!best || match.index < best.index || (match.index === best.index && phrase.length > best.raw.length)) {
      best = { raw: match[0], index: match.index };
    }
  }
  return best;
}

function isNegated(sentence: string, matchIndex: number): boolean {
  if (matchIndex < 0) return false;
  const prefix = sentence.slice(0, matchIndex);
  // Keep commas inside a negated list ("no pain, flashes, or floaters"),
  // while treating contrast/positive assertion cues as a new clause
  // ("no pain, but flashes" / "no pain, reports flashes").
  const window = prefix.slice(-160);
  const negations = [...window.matchAll(new RegExp(NEGATION_TRIGGERS.source, "gi"))];
  const lastNegation = negations.at(-1);
  if (!lastNegation || lastNegation.index === undefined) return false;
  const afterNegation = window.slice(lastNegation.index + lastNegation[0].length);
  if (/\b(?:but|however|although|except|yet|instead)\b/i.test(afterNegation)) return false;
  if (/\b(?:reports?|reported|complains? of|experienc(?:es?|ing)|has|have|presents? with|endorses?|suffers? from|noted)\b/i.test(afterNegation)) return false;
  return true;
}

/** Same narrow look-behind as negation, but for explicit uncertainty words. */
function isUncertain(sentence: string, matchIndex: number, matchLength = 0): boolean {
  if (matchIndex < 0) return false;
  const before = sentence.slice(Math.max(0, matchIndex - 120), matchIndex);
  const after = sentence.slice(matchIndex + matchLength, Math.min(sentence.length, matchIndex + matchLength + 120));
  const beforeMatches = [...before.matchAll(new RegExp(UNCERTAINTY_TRIGGERS.source, "gi"))];
  const beforeLast = beforeMatches.at(-1);
  if (beforeLast && beforeLast.index !== undefined) {
    const afterTrigger = before.slice(beforeLast.index + beforeLast[0].length);
    if (!/\b(?:but|however|although|except|yet|instead)\b/i.test(afterTrigger)) return true;
  }
  const afterMatch = UNCERTAINTY_TRIGGERS.exec(after);
  if (afterMatch && afterMatch.index !== undefined) {
    const beforeTrigger = after.slice(0, afterMatch.index);
    if (!/\b(?:but|however|although|except|yet|instead)\b/i.test(beforeTrigger)) return true;
  }
  return false;
}

function extractLaterality(sentence: string): Laterality | undefined {
  if (/\b(bilateral|both eyes|both OU|OU\b|both eye)/i.test(sentence)) return "both";
  if (/\b(right eye|OD\b|oculus dexter|right-sided)\b/i.test(sentence)) return "right";
  if (/\b(left eye|OS\b|oculus sinister|left-sided)\b/i.test(sentence)) return "left";
  return undefined;
}

function extractOnset(sentence: string): Onset | undefined {
  if (/\b(sudden|suddenly|acute onset|abruptly|this morning|since morning|began today|started today)\b/i.test(sentence)) return "sudden";
  if (/\b(gradual|gradually|progressive|progressively|over the past|over weeks|over months|slow onset|insidious)\b/i.test(sentence)) return "gradual";
  return undefined;
}

const DURATION_PATTERNS: Array<{ re: RegExp; band: DurationBand }> = [
  { re: /\b(?:for |of |since |past )?(?:the last |the past )?(?:about |approximately |~)?(?:a few|several|couple of|\d{1,2})\s+hours?\b/i, band: "hours" },
  { re: /\b(this morning|since morning|earlier today|today|since today|for hours)\b/i, band: "hours" },
  { re: /\b(?:for |of |since |past )?(?:the last |the past )?(?:about |approximately )?1 day|yesterday\b/i, band: "1_day" },
  { re: /\b(?:for |of |since |past )?(?:the last |the past )?(?:about |approximately |~)?(?:[2-6]|\d{1,2})\s+days\b/i, band: "days" },
  { re: /\b(?:for |of |since |past )?(?:the last |the past )?(?:about |approximately )?1 week\b/i, band: "1_week" },
  { re: /\b(?:for |of |since |past )?(?:the last |the past )?(?:about |approximately |~)?(?:[2-3]|\d{1,2})\s+weeks\b/i, band: "weeks" },
  { re: /\b(?:for |of |since |past )?(?:the last |the past )?(?:about |approximately )?1 month\b/i, band: "1_month" },
  { re: /\b(?:for |of |since |past )?(?:the last |the past )?(?:about |approximately |~)?\d{1,2}\s+months\b/i, band: "months" },
  { re: /\b(?:for |of |since |past )?(?:the last |the past )?(?:about |approximately |~)?\d+\s+years?\b/i, band: "chronic" },
];

function extractDuration(sentence: string): DurationBand | undefined {
  if (/\bchronic\b/i.test(sentence)) return "chronic";
  for (const p of DURATION_PATTERNS) {
    if (p.re.test(sentence)) return p.band;
  }
  return undefined;
}

function extractSeverity(sentence: string): "mild" | "moderate" | "severe" | undefined {
  if (/\b(mild)\b/i.test(sentence)) return "mild";
  if (/\b(moderate)\b/i.test(sentence)) return "moderate";
  if (/\b(severe|excruciating|unbearable|intense)\b/i.test(sentence)) return "severe";
  return undefined;
}

function clip(s: string): string {
  return s.length > MAX_RAW_LEN ? s.slice(0, MAX_RAW_LEN) + "…" : s;
}

let idCounter = 0;
function nextItemId(): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `x_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/**
 * Main entry: extract candidate clinical facts from already-extracted page
 * texts. Deterministic; no network; nothing fabricated. Empty input (no
 * text) yields an empty result, never an error or invented content.
 */
export function extractClinicalFromPages(
  pages: Array<{ page: number; text: string }>,
  context: { document_id: string; study_id: string; patient_ref?: string }
): RecordExtraction {
  const base: RecordExtraction = {
    document_id: context.document_id,
    study_id: context.study_id,
    patient_ref: context.patient_ref,
    extracted_at: new Date().toISOString(),
    extraction_version: CLINICAL_EXTRACTION_VERSION,
    status: "COMPLETE",
    symptoms: [],
    explicit_negations: [],
    medications: [],
    allergies: [],
    systemic_candidates: [],
    source_document_diagnoses: [],
    ocular_history_candidates: [],
    family_history_candidates: [],
    exam_findings: [],
    counts: { pages_scanned: 0, sentences_scanned: 0 },
  };

  try {
    const withText = pages.filter((p) => typeof p.text === "string" && p.text.trim().length > 0);
    base.counts.pages_scanned = withText.length;
    if (withText.length === 0) {
      base.error_code = "NO_TEXT_EXTRACTED";
      return base;
    }
    const sentences = splitSentences(withText);
    base.counts.sentences_scanned = sentences.length;

    for (const sentence of sentences) {
      // --- explicitly labelled chief complaint --------------------------
      // Keep this as its own field. It is context, not a symptom assertion,
      // and it is never promoted into the image-analysis input.
      if (!base.chief_complaint) {
        const cc = CHIEF_COMPLAINT_PATTERN.exec(sentence.text);
        if (cc?.[1]) {
          base.chief_complaint = {
            value_raw: clip(cc[1].trim()),
            raw_text: clip(sentence.text),
            page_index: sentence.page,
            source: "DOCUMENT_EXTRACTED",
            verification: "UNREVIEWED",
          };
        }
      }

      // --- history and exam context --------------------------------------
      // These are deliberately broad, source-text candidates. The extractor
      // does not normalize free prose into a disease code or infer causality;
      // a clinician must verify the copied phrase before clinical use.
      if (base.family_history_candidates.length < MAX_ITEMS_PER_CATEGORY) {
        const family = FAMILY_HISTORY_PATTERN.exec(sentence.text);
        if (family?.[1]) {
          const value = family[1].trim();
          if (!/^none\b|^negative\b|^no known\b/i.test(value)) {
            const duplicate = base.family_history_candidates.some((h) => h.value_raw.toLowerCase() === value.toLowerCase() && h.page_index === sentence.page);
            if (!duplicate) {
              base.family_history_candidates.push({
                item_id: nextItemId(), kind: "FAMILY_HISTORY", value_raw: clip(value), raw_text: clip(sentence.text),
                page_index: sentence.page, laterality: extractLaterality(sentence.text),
                date_raw: SOURCE_DATE_PATTERN.exec(sentence.text)?.[1], source: "DOCUMENT_EXTRACTED", verification: "UNREVIEWED",
              });
            }
          }
        }
      }
      if (base.exam_findings.length < MAX_ITEMS_PER_CATEGORY) {
        const exam = EXAM_FINDING_PATTERN.exec(sentence.text);
        if (exam?.[1]) {
          const value = exam[1].trim();
          const duplicate = base.exam_findings.some((h) => h.value_raw.toLowerCase() === value.toLowerCase() && h.page_index === sentence.page);
          if (!duplicate) {
            base.exam_findings.push({
              item_id: nextItemId(), kind: "EXAM_FINDING", value_raw: clip(value), raw_text: clip(sentence.text),
              page_index: sentence.page, laterality: extractLaterality(sentence.text),
              date_raw: SOURCE_DATE_PATTERN.exec(sentence.text)?.[1], source: "DOCUMENT_EXTRACTED", verification: "UNREVIEWED",
            });
          }
        }
      }
      if (base.ocular_history_candidates.length < MAX_ITEMS_PER_CATEGORY) {
        const surgery = OCULAR_SURGERY_PATTERN.exec(sentence.text);
        const history = surgery || /\bfamily\s+history\b/i.test(sentence.text) ? null : OCULAR_HISTORY_PATTERN.exec(sentence.text);
        const match = surgery ?? history;
        if (match?.[1]) {
          const value = match[1].trim();
          // Avoid duplicating family/systemic labels and generic HPI headers.
          if (!/^none\b|^negative\b|^no known\b|^present illness\b|^family history\b|^diabetes\b|^hypertension\b|^high blood pressure\b|^htn\b/i.test(value)) {
            const kind = surgery ? "OCULAR_SURGERY" : "OCULAR_HISTORY";
            const duplicate = base.ocular_history_candidates.some((h) => h.kind === kind && h.value_raw.toLowerCase() === value.toLowerCase() && h.page_index === sentence.page);
            if (!duplicate) {
              base.ocular_history_candidates.push({
                item_id: nextItemId(), kind, value_raw: clip(value), raw_text: clip(sentence.text),
                page_index: sentence.page, laterality: extractLaterality(sentence.text),
                date_raw: SOURCE_DATE_PATTERN.exec(sentence.text)?.[1], source: "DOCUMENT_EXTRACTED", verification: "UNREVIEWED",
              });
            }
          }
        }
      }

      // --- source-document diagnosis claim -------------------------------
      // This is a provenance-preserving copy only. It is not added to the
      // VisionScan differential and cannot open the diagnosis gate.
      if (base.source_document_diagnoses.length < MAX_ITEMS_PER_CATEGORY) {
        const diagnosis = SOURCE_DIAGNOSIS_PATTERN.exec(sentence.text);
        if (diagnosis && diagnosis[1]) {
          const diagnosisRaw = diagnosis[1].trim();
          if (!/^none\b|^negative\b|^no diagnosis\b/i.test(diagnosisRaw)) {
            const duplicate = base.source_document_diagnoses.some(
              (d) => d.diagnosis_raw.toLowerCase() === diagnosisRaw.toLowerCase() && d.page_index === sentence.page,
            );
            if (!duplicate) {
              base.source_document_diagnoses.push({
                item_id: nextItemId(),
                document_id: context.document_id,
                diagnosis_raw: clip(diagnosisRaw),
                raw_text: clip(sentence.text),
                page_index: sentence.page,
                page: sentence.page,
                date_raw: SOURCE_DATE_PATTERN.exec(sentence.text)?.[1],
                source_clinician_raw: SOURCE_CLINICIAN_PATTERN.exec(sentence.text)?.[1]?.trim(),
                source: "DOCUMENT_EXTRACTED",
                verification: "UNREVIEWED",
              });
            }
          }
        }
      }

      // --- symptom phrase matches + documented negations -----------------
      for (const spec of SYMPTOM_PHRASES) {
        const def: SymptomTypeDef | undefined = SYMPTOM_MAP[spec.type];
        if (!def) continue; // vocabulary guard - never extract an unknown type
        const match = findPhraseMatch(sentence.text, spec.phrases);
        if (!match) continue;
        // "new floaters" is a more specific controlled symptom than generic
        // floaters. Keep the red-flag type and avoid emitting both for one
        // phrase.
        if (spec.type === "floaters" && findPhraseMatch(sentence.text, SYMPTOM_PHRASES.find((s) => s.type === "new_floaters")?.phrases ?? [])) continue;
        const idx = match.index;
        if (isNegated(sentence.text, idx)) {
          if (base.explicit_negations.length < MAX_ITEMS_PER_CATEGORY) {
            base.explicit_negations.push({
              item_id: nextItemId(),
              kind: "SYMPTOM",
              type: spec.type,
              raw_text: clip(sentence.text),
              page_index: sentence.page,
            });
          }
          continue;
        }
        const exists = base.symptoms.some((s) => s.type === spec.type && s.page_index === sentence.page);
        if (exists || base.symptoms.length >= MAX_ITEMS_PER_CATEGORY) continue;
        base.symptoms.push({
          item_id: nextItemId(),
          type: spec.type,
          raw_text: clip(sentence.text),
          page_index: sentence.page,
          laterality: extractLaterality(sentence.text),
          onset: extractOnset(sentence.text),
          duration: extractDuration(sentence.text),
          severity: extractSeverity(sentence.text),
          certainty: isUncertain(sentence.text, idx, match.raw.length) ? "UNCERTAIN" : "EXPLICIT",
          extraction_confidence: 0.9,
          confidence_basis: "EXACT_PHRASE",
          source: "DOCUMENT_EXTRACTED",
          verification: "UNREVIEWED",
        });
      }

      // --- sentence co-occurrence combos ---------------------------------
      for (const rule of CO_OCCURRENCE_RULES) {
        if (!SYMPTOM_MAP[rule.type]) continue;
        const matchesByGroup = rule.requires.map((group) => group.map((g) => findPhraseMatch(sentence.text, [g])).filter((m): m is PhraseMatch => !!m));
        const all = matchesByGroup.every((group) => group.length > 0);
        if (!all) continue;
        const exists = base.symptoms.some((s) => s.type === rule.type && s.page_index === sentence.page);
        if (exists || base.symptoms.length >= MAX_ITEMS_PER_CATEGORY) continue;
        const matchedParts = matchesByGroup.flat();
        // A co-occurrence symptom requires all component phrases to be
        // asserted in the same sentence. This prevents e.g. "severe eye
        // pain without nausea" from becoming severe-pain-with-nausea, and
        // handles phrase alternatives such as "excruciating ... nausea".
        const negatedParts = matchedParts.filter((m) => isNegated(sentence.text, m.index));
        if (negatedParts.length > 0) {
          if (negatedParts.length === matchedParts.length && base.explicit_negations.length < MAX_ITEMS_PER_CATEGORY) {
            base.explicit_negations.push({
              item_id: nextItemId(),
              kind: "SYMPTOM",
              type: rule.type,
              raw_text: clip(sentence.text),
              page_index: sentence.page,
            });
          }
          continue;
        }
        const firstPart = matchedParts[0];
        base.symptoms.push({
          item_id: nextItemId(),
          type: rule.type,
          raw_text: clip(sentence.text),
          page_index: sentence.page,
          laterality: extractLaterality(sentence.text),
          onset: extractOnset(sentence.text),
          duration: extractDuration(sentence.text),
          severity: extractSeverity(sentence.text),
          certainty: isUncertain(sentence.text, firstPart.index, firstPart.raw.length) ? "UNCERTAIN" : "EXPLICIT",
          extraction_confidence: 0.6,
          confidence_basis: "SENTENCE_CO_OCCURRENCE",
          source: "DOCUMENT_EXTRACTED",
          verification: "UNREVIEWED",
        });
      }

      // --- medications ----------------------------------------------------
      for (const name of MEDICATION_NAMES) {
        if (base.medications.length >= MAX_ITEMS_PER_CATEGORY) break;
        const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
        const m = re.exec(sentence.text);
        if (!m) continue;
        const alreadyOnPage = base.medications.some((med) => med.name_raw.toLowerCase() === name.toLowerCase() && med.page_index === sentence.page);
        if (alreadyOnPage) continue;
        const formHint = /\b(drops?|eye drops)\b/i.test(sentence.text)
          ? "eye_drops"
          : /\b(tablet|tablets|capsule|capsules|oral|pill|po\b)/i.test(sentence.text)
            ? "oral"
            : /\b(injection|injected|intravitreal|iv\b|im\b)/i.test(sentence.text)
              ? "injection"
              : "unknown";
        const doseMatch = /(\b\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|%))/.exec(sentence.text);
        base.medications.push({
          item_id: nextItemId(),
          name_raw: m[0],
          form_hint: formHint,
          dose_raw: doseMatch ? doseMatch[1] : undefined,
          page_index: sentence.page,
          normalization_status: "UNNORMALIZED",
          source: "DOCUMENT_EXTRACTED",
          verification: "UNREVIEWED",
        });
      }

      // --- allergies -------------------------------------------------------
      if (NKDA_PATTERNS.some((re) => re.test(sentence.text))) {
        base.explicit_negations.push({
          item_id: nextItemId(),
          kind: "ALLERGY",
          raw_text: clip(sentence.text),
          page_index: sentence.page,
        });
      } else {
        for (const ap of ALLERGY_PATTERNS) {
          if (base.allergies.length >= MAX_ITEMS_PER_CATEGORY) break;
          ap.re.lastIndex = 0;
          const m = ap.re.exec(sentence.text);
          if (!m) continue;
          const allergen = (m[ap.allergenGroup] ?? "").trim().replace(/[.,;]+$/, "");
          if (!allergen || allergen.length < 2) continue;
          if (/\bno known|none|nkda\b/i.test(allergen)) continue;
          const dup = base.allergies.some((a) => a.allergen_raw.toLowerCase() === allergen.toLowerCase());
          if (dup) continue;
          base.allergies.push({
            item_id: nextItemId(),
            allergen_raw: clip(allergen),
            reaction_raw: ap.reactionGroup ? (m[ap.reactionGroup] ?? "").trim() || undefined : undefined,
            page_index: sentence.page,
            source: "DOCUMENT_EXTRACTED",
            verification: "UNREVIEWED",
          });
        }
      }

      // --- systemic history candidates -------------------------------------
      const systemicChecks: Array<{ condition: "diabetes" | "hypertension"; re: RegExp }> = [
        { condition: "diabetes", re: DIABETES_PATTERN },
        { condition: "hypertension", re: HYPERTENSION_PATTERN },
      ];
      for (const sc of systemicChecks) {
        const m = sc.re.exec(sentence.text);
        if (!m) continue;
        if (isNegated(sentence.text, m.index)) {
          base.explicit_negations.push({
            item_id: nextItemId(),
            kind: "SYSTEMIC_CONDITION",
            raw_text: clip(sentence.text),
            page_index: sentence.page,
          });
          continue;
        }
        const dup = base.systemic_candidates.some((c) => c.condition === sc.condition);
        if (dup || base.systemic_candidates.length >= MAX_ITEMS_PER_CATEGORY) continue;
        base.systemic_candidates.push({
          item_id: nextItemId(),
          condition: sc.condition,
          raw_text: clip(sentence.text),
          page_index: sentence.page,
          source: "DOCUMENT_EXTRACTED",
          verification: "UNREVIEWED",
        });
      }
    }

    return base;
  } catch {
    // Fail-safe: extraction failure never throws into the document pipeline.
    return {
      ...base,
      status: "FAILED",
      error_code: "EXTRACTION_FAILED",
      symptoms: [],
      explicit_negations: [],
      medications: [],
      allergies: [],
      systemic_candidates: [],
      source_document_diagnoses: [],
      ocular_history_candidates: [],
      family_history_candidates: [],
      exam_findings: [],
      chief_complaint: undefined,
    };
  }
}
