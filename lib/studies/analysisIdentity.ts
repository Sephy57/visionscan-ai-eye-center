/**
 * Immutable analysis ids are versioned when a study's input envelope changes.
 * The study keeps a mutable pointer to the newest id; legacy studies without
 * that pointer continue to resolve through the original canonical id.
 */
export function canonicalAnalysisId(studyId: string): string {
  return `anl_${studyId}`;
}

export function currentAnalysisId(study: { study_id: string; latest_analysis_id?: string | null }): string {
  return study.latest_analysis_id ?? canonicalAnalysisId(study.study_id);
}

export function versionedAnalysisId(studyId: string, inputEnvelopeSha256: string): string {
  return `${canonicalAnalysisId(studyId)}_v${inputEnvelopeSha256.slice(0, 24)}`;
}
