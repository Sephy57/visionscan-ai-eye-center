/**
 * Deterministic safety classification for text extracted from documents.
 *
 * PDF/OCR text is untrusted data. It can contain instructions aimed at an
 * AI system, but it is never an instruction channel for VisionScan. This
 * classifier is deliberately narrow: ordinary clinical phrases such as
 * "diagnosis: glaucoma" remain source-document claims, while imperative
 * prompt-injection language is marked and excluded from structured fact
 * extraction.
 */

export type DocumentTextSafetyClass = "NO_INSTRUCTION_SIGNAL" | "INSTRUCTION_LIKE";

export interface DocumentTextSafety {
  classification: DocumentTextSafetyClass;
  matched_patterns: string[];
  safe_for_structured_extraction: boolean;
  note: string;
}

const INSTRUCTION_PATTERNS: Array<[string, RegExp]> = [
  ["role_impersonation", /\byou\s+are\s+(?:a|an)\s+(?:doctor|physician|clinician|medical\s+assistant)\b/i],
  ["safety_bypass", /\b(?:ignore|disregard|bypass)\s+(?:all\s+)?(?:safety|the\s+safety|previous\s+instructions|these\s+instructions)\b/i],
  ["diagnosis_command", /\b(?:diagnose|make\s+a\s+diagnosis)\s+(?:the\s+patient|this\s+patient|glaucoma|retinal|the\s+eye)\b/i],
  ["prescribing_command", /\b(?:prescribe|start|change|stop)\s+(?:prednisolone|medication|a\s+medication|treatment)\b/i],
  ["normality_command", /\b(?:mark|label|declare)\s+(?:this\s+)?(?:patient|eye|scan)\s+(?:normal|healthy)\b/i],
  ["system_override", /\b(?:system\s+message|developer\s+message|assistant\s+instruction|new\s+rule)\s*:/i],
];

export function classifyDocumentTextSafety(text: string): DocumentTextSafety {
  const matched_patterns = INSTRUCTION_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
  const instructionLike = matched_patterns.length > 0;
  return {
    classification: instructionLike ? "INSTRUCTION_LIKE" : "NO_INSTRUCTION_SIGNAL",
    matched_patterns,
    safe_for_structured_extraction: !instructionLike,
    note: instructionLike
      ? "Instruction-like document text is untrusted data and is ignored by the structured clinical extractor. It cannot change system behavior or create a clinical claim."
      : "No supported prompt-injection signal was detected; extracted facts remain unreviewed, provenance-bound candidates.",
  };
}

export function isInstructionLikeDocumentText(text: string): boolean {
  return classifyDocumentTextSafety(text).classification === "INSTRUCTION_LIKE";
}
