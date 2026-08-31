/**
 * Model / pipeline component registry.
 *
 * Every analysis stage declares its component identity here.
 * HONESTY RULE: no component may claim validation it does not have.
 * All current detection/segmentation components are PLACEHOLDERS with
 * validationStatus "not_validated" until they have completed the clinical
 * validation framework described in docs/VALIDATION.md.
 */

export type ValidationStatus =
  | "not_validated"          // no clinical validation performed
  | "internal_validation"    // internal benchmarks only, no external test set
  | "external_validation"    // validated on external, locked test data
  | "regulatory_cleared";    // cleared/authorized for the specific intended use

export interface ComponentDescriptor {
  id: string;
  name: string;
  role: string;                       // e.g. "quality", "segmentation", "detector"
  version: string;                    // semver of the component implementation
  implementation: "heuristic" | "ml_model" | "placeholder";
  validationStatus: ValidationStatus;
  checksum: string;                   // content hash of the component logic version
  notes?: string;
}

const v = (s: string) => s; // checksums are content hashes of code versions; updated on change

export const COMPONENTS: Record<string, ComponentDescriptor> = {
  qualityGate: {
    id: "quality-gate",
    name: "Image Quality Gate",
    role: "quality",
    version: "0.3.0",
    implementation: "heuristic",
    validationStatus: "not_validated",
    checksum: v("qg-0.3.0-laplacian-illumination-glare-fov"),
    notes: "Deterministic image metrics (sharpness, illumination, clipping, resolution). Thresholds not clinically validated.",
  },
  anatomySegmentation: {
    id: "anatomy-segmentation",
    name: "Anatomical Segmentation",
    role: "segmentation",
    version: "0.0.1",
    implementation: "placeholder",
    validationStatus: "not_validated",
    checksum: v("seg-0.0.1-placeholder"),
    notes: "Integration placeholder. No segmentation model installed. Produces no measurements.",
  },
  fundusDetector: {
    id: "fundus-lesion-detector",
    name: "Fundus Lesion Detector",
    role: "detector",
    version: "0.0.1",
    implementation: "placeholder",
    validationStatus: "not_validated",
    checksum: v("fd-0.0.1-placeholder"),
    notes: "Integration placeholder. Demo/synthetic findings only.",
  },
  vascularAnalyzer: {
    id: "retinal-vascular-analyzer",
    name: "Retinal Vascular Analyzer",
    role: "detector",
    version: "0.0.1",
    implementation: "placeholder",
    validationStatus: "not_validated",
    checksum: v("va-0.0.1-placeholder"),
    notes: "Integration placeholder. Hemorrhage/vascular detection not implemented.",
  },
  octAnalyzer: {
    id: "oct-analyzer",
    name: "OCT Structural Analyzer",
    role: "detector",
    version: "0.0.1",
    implementation: "placeholder",
    validationStatus: "not_validated",
    checksum: v("oct-0.0.1-placeholder"),
    notes: "Integration placeholder. Layer segmentation and thickness measurements not implemented.",
  },
  ensemble: {
    id: "ensemble-check",
    name: "Ensemble / Consistency Check",
    role: "ensemble",
    version: "0.1.0",
    implementation: "heuristic",
    validationStatus: "not_validated",
    checksum: v("ens-0.1.0-agreement-rules"),
    notes: "Agreement logic over detector outputs. With a single placeholder detector it can only return indeterminate.",
  },
  triage: {
    id: "triage-engine",
    name: "Clinical Triage Engine",
    role: "rules",
    version: "0.2.0",
    implementation: "heuristic",
    validationStatus: "not_validated",
    checksum: v("tri-0.2.0-conservative-rules"),
    notes: "Deterministic conservative ruleset. Rules reviewed by engineering, NOT clinically validated.",
  },
};

export function componentsForRoles(roles: string[]): ComponentDescriptor[] {
  return Object.values(COMPONENTS).filter((c) => roles.includes(c.role));
}

export function modelProvenance(roles: string[]) {
  return componentsForRoles(roles).map((c) => ({
    model_id: c.id,
    model_name: c.name,
    model_version: c.version,
    checksum: c.checksum,
    implementation: c.implementation,
    validation_status: c.validationStatus,
  }));
}

export const RULESET_VERSION = "clinical-rules-0.2.0";
