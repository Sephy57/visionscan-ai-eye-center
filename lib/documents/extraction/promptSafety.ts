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

/**
 * Build a detection-only view of extracted text. Document bytes remain
 * immutable and the original text is never rewritten or sent to an
 * instruction executor. NFKD/NFKC handles compatibility/full-width forms;
 * the small confusable map covers common Latin-looking Cyrillic/Greek glyphs.
 */
function safetyDetectionView(text: string): string {
  const confusables: Record<string, string> = {
    "а": "a", "е": "e", "і": "i", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
    "А": "A", "Е": "E", "І": "I", "О": "O", "Р": "P", "С": "C", "У": "Y", "Х": "X",
    "ο": "o", "Ο": "O", "ρ": "p", "Ρ": "P",
  };
  return text
    .normalize("NFKD")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\u0300-\u036F]/g, "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[аеиорсухАЕІОРСУХοΟρΡ]/g, (character) => confusables[character] ?? character)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

/** Join only separator-delimited single-letter runs for the second,
 * detection-only pass. This catches `i g n o r e` and `i-g-n-o-r-e` without
 * collapsing ordinary multi-letter word boundaries such as `you are`. */
function splitTokenDetectionView(text: string): string {
  let previous = "";
  let current = text;
  while (current !== previous) {
    previous = current;
    current = current.replace(/(?<=[A-Za-z])[\s_-]+(?=[A-Za-z](?:\b|[\s_-]))/g, "");
  }
  return current;
}

export function classifyDocumentTextSafety(text: string): DocumentTextSafety {
  const normalized = safetyDetectionView(String(text ?? ""));
  const splitTokenView = splitTokenDetectionView(normalized);
  const matched_patterns = INSTRUCTION_PATTERNS
    .filter(([, pattern]) => pattern.test(normalized) || pattern.test(splitTokenView))
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
