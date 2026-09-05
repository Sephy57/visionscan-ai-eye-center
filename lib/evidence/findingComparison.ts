/**
 * AI Finding Longitudinal Comparison (Phase 5, §14-17).
 *
 * HARD RULE: findings from two visits are only meaningfully comparable when
 * the SAME model/capability, SAME eye, and roughly compatible acquisition
 * context produced both. A model-version or device change never silently
 * becomes "the finding resolved" - it becomes NOT_COMPARABLE/MODEL_CHANGED/
 * DEVICE_CHANGED, with the real reason preserved (§17 - "not detected
 * later" must never collapse into "resolved").
 */

import type { Finding } from "../analysis/schema";

export type FindingComparisonState =
  | "NEW_AI_FINDING"
  | "PERSISTENT_AI_FINDING"
  | "NO_LONGER_OBSERVED"
  | "MODEL_UNAVAILABLE"
  | "MODEL_CHANGED"
  | "DEVICE_CHANGED"
  | "NOT_COMPARABLE";

export interface VisitFindingContext {
  study_id: string;
  eye: string; // canonical clinical laterality string as stored on StudyRecord
  findings: Finding[];
  model_available: boolean; // false if inference did not run at all (MODEL_UNAVAILABLE, quality/OOD block, etc.)
  device: { manufacturer?: string; model?: string } | null;
  quality_status: "pass" | "borderline" | "fail" | "unknown";
}

export interface FindingComparisonResult {
  finding_type: string;
  eye: string;
  state: FindingComparisonState;
  prior_finding_id: string | null;
  current_finding_id: string | null;
  note: string;
}

function deviceKey(d: VisitFindingContext["device"]): string {
  if (!d || (!d.manufacturer && !d.model)) return "unknown";
  return `${d.manufacturer ?? "?"}::${d.model ?? "?"}`;
}

/**
 * Deterministic comparison between two visits' AI findings. Every
 * cross-cutting comparability check (eye, model identity, device) runs
 * BEFORE any finding-type comparison - if any of them fails, the whole
 * comparison for that eye returns one NOT_COMPARABLE/MODEL_CHANGED/
 * DEVICE_CHANGED/MODEL_UNAVAILABLE result rather than a misleading
 * per-finding diff.
 */
export function compareFindings(prior: VisitFindingContext, current: VisitFindingContext): FindingComparisonResult[] {
  if (prior.eye !== current.eye) {
    return [{
      finding_type: "*", eye: `${prior.eye} vs ${current.eye}`, state: "NOT_COMPARABLE",
      prior_finding_id: null, current_finding_id: null,
      note: `Prior visit's declared eye (${prior.eye}) differs from the current visit's (${current.eye}) - cross-eye comparison is never performed.`,
    }];
  }
  const eye = current.eye;

  if (!prior.model_available || !current.model_available) {
    return [{
      finding_type: "*", eye, state: "MODEL_UNAVAILABLE", prior_finding_id: null, current_finding_id: null,
      note: "Automated analysis did not run (or was blocked by quality/OOD) for at least one of the two visits - no finding comparison is possible. This is not evidence the eye is unchanged.",
    }];
  }

  const priorModelIds = new Set(prior.findings.map((f) => `${f.model_id}::${f.model_status ?? ""}`));
  const currentModelIds = new Set(current.findings.map((f) => `${f.model_id}::${f.model_status ?? ""}`));
  const modelsChanged = prior.findings.length > 0 && current.findings.length > 0 &&
    (priorModelIds.size > 0 && currentModelIds.size > 0 && [...priorModelIds].some((m) => !currentModelIds.has(m)));
  if (modelsChanged) {
    return [{
      finding_type: "*", eye, state: "MODEL_CHANGED", prior_finding_id: null, current_finding_id: null,
      note: "The model/version that produced findings differs between the two visits - outputs from different model versions are not directly compared unless validated cross-version comparability exists (it does not, in this deployment).",
    }];
  }

  if (deviceKey(prior.device) !== deviceKey(current.device)) {
    return [{
      finding_type: "*", eye, state: "DEVICE_CHANGED", prior_finding_id: null, current_finding_id: null,
      note: `Acquisition device differs between visits (${deviceKey(prior.device)} vs ${deviceKey(current.device)}) - findings are not treated as a continuous measurement source across a device change.`,
    }];
  }

  // Same eye, same model identity, same device - a real per-finding-type diff is meaningful.
  const priorTypes = new Map(prior.findings.map((f) => [f.type, f]));
  const currentTypes = new Map(current.findings.map((f) => [f.type, f]));
  const allTypes = [...new Set([...priorTypes.keys(), ...currentTypes.keys()])].sort();

  return allTypes.map((type): FindingComparisonResult => {
    const p = priorTypes.get(type), c = currentTypes.get(type);
    if (p && c) {
      return { finding_type: type, eye, state: "PERSISTENT_AI_FINDING", prior_finding_id: p.id, current_finding_id: c.id, note: `${type} was observed in both visits.` };
    }
    if (!p && c) {
      return { finding_type: type, eye, state: "NEW_AI_FINDING", prior_finding_id: null, current_finding_id: c.id, note: `${type} was not observed in the prior visit and is present now.` };
    }
    return {
      finding_type: type, eye, state: "NO_LONGER_OBSERVED", prior_finding_id: p!.id, current_finding_id: null,
      note: `${type} was observed previously but is not observed now, under the same model/device/eye conditions. This does NOT establish that the underlying finding resolved - only that it was not detected in the current image under otherwise-comparable acquisition conditions.`,
    };
  });
}
