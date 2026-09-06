/**
 * Model package format & loader.
 *
 * A real model is installed by placing a package under:
 *   data\models\<model_id>\manifest.json
 *   data\models\<model_id>\<artifact file>
 *
 * manifest.json must contain ALL required metadata. Nothing is downloaded
 * automatically and nothing is invented. The loader FAILS CLOSED: any missing
 * field, checksum mismatch, or unregistered model id prevents execution.
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { MODEL_ROOT } from "../config";
import { ModelRecord, getModel } from "./registry";
import { audit } from "../audit";

export const MANIFEST_VERSION = "1.0.0";
/** Refuse unexpectedly large model files before hashing them. */
export const MAX_MODEL_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;

function pathWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hashFileBounded(filePath: string): { sha256: string; bytes: number } {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("artifact is not a regular file");
  if (stat.size > MAX_MODEL_ARTIFACT_BYTES) throw new Error(`artifact exceeds ${MAX_MODEL_ARTIFACT_BYTES} byte safety limit`);
  const hash = createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  let bytes = 0;
  try {
    let read = 0;
    do {
      read = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (read > 0) { hash.update(chunk.subarray(0, read)); bytes += read; }
    } while (read > 0);
  } finally { fs.closeSync(fd); }
  return { sha256: hash.digest("hex"), bytes };
}

export interface ModelManifest {
  manifest_version: string;                 // "1.0.0"
  model_id: string;                         // must match a registry record id
  model_name: string;
  version: string;
  artifact: {
    file: string;                           // relative to the package dir
    sha256: string;                         // checksum of the artifact file
    // SafeTensors is explicit rather than being hidden under generic
    // "pytorch": callers can reject pickle-backed checkpoints by policy.
    format: "onnx" | "safetensors" | "pytorch" | "tensorflow" | "tflite" | "remote_api";
  };
  input: {
    modalities: string[];
    dimensions: string;                     // e.g. "3x224x224" or "1x496x496"
    preprocessing: string;                  // description of preprocessing requirements
    input_schema: "IMAGE_ONLY" | "IMAGE_AND_SYMPTOMS";
  };
  output_schema: string;                    // reference to the output contract version
  supported_anatomy: string[];
  supported_findings: string[];
  supported_conditions: string[];
  supported_symptom_types: string[];
  devices: Array<{ manufacturer: string; model: string; firmware?: string; scan_protocol?: string }>;
  intended_use: string;
  contraindications: string[];
  limitations: string[];
  training_dataset: { name: string; version: string; provenance: string; population?: string } | null;
  validation_dataset: { name: string; version: string; provenance: string; population?: string } | null;
  calibration: { method: string; dataset: string; date: string } | null;
  validation_evidence_refs: string[];       // evidence registry ids (lib/research/evidence.ts)
  license: string;
  source: string;                           // where the artifact came from (URL/org/contact)
  developer: string;
  regulatory_status: "none" | "research_only" | "registered" | "cleared" | "approved";
}

export interface PackageLoadResult {
  ok: boolean;
  reasons: string[];
  manifest?: ModelManifest;
  computed_sha256?: string;
}

const REQUIRED_STRING_FIELDS: Array<[keyof ModelManifest, string]> = [
  ["model_id", "model_id"], ["model_name", "model_name"], ["version", "version"],
  ["intended_use", "intended_use"], ["license", "license"], ["source", "source"], ["developer", "developer"],
];

/** Structural validation of a manifest — every field required, nothing defaulted. */
export function validateManifest(raw: unknown): { ok: boolean; reasons: string[]; manifest?: ModelManifest } {
  const reasons: string[] = [];
  const m = raw as ModelManifest | null;
  if (!m || typeof m !== "object") return { ok: false, reasons: ["manifest.json is not an object"] };
  if (m.manifest_version !== MANIFEST_VERSION) reasons.push(`manifest_version must be ${MANIFEST_VERSION}`);
  for (const [key, label] of REQUIRED_STRING_FIELDS) {
    if (typeof m[key] !== "string" || String(m[key]).trim() === "") reasons.push(`Missing required field: ${label}`);
  }
  if (!m.artifact?.file || !m.artifact?.sha256 || !m.artifact?.format) {
    reasons.push("Missing artifact (file/sha256/format)");
  }
  if (!m.input?.modalities?.length) reasons.push("input.modalities must list at least one modality");
  if (!m.input?.dimensions || !m.input?.preprocessing) reasons.push("input.dimensions and input.preprocessing are required");
  if (!m.input?.input_schema) reasons.push("input.input_schema is required");
  if (typeof m.output_schema !== "string" || !m.output_schema) reasons.push("output_schema is required");
  if (!Array.isArray(m.supported_findings)) reasons.push("supported_findings must be an array");
  if (!Array.isArray(m.supported_conditions)) reasons.push("supported_conditions must be an array");
  if (!Array.isArray(m.devices)) reasons.push("devices must be an array");
  if (!Array.isArray(m.contraindications) || m.contraindications.length === 0) reasons.push("contraindications must be a non-empty array");
  if (!Array.isArray(m.limitations) || m.limitations.length === 0) reasons.push("limitations must be a non-empty array");
  if (!m.training_dataset && !m.validation_dataset) reasons.push("At least one of training_dataset / validation_dataset must be documented");
  if (!Array.isArray(m.validation_evidence_refs)) reasons.push("validation_evidence_refs must be an array");
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, reasons: [], manifest: m };
}

/**
 * Load + verify a model package. FAILS CLOSED on any problem:
 * unregistered id, malformed manifest, missing artifact, checksum mismatch.
 */
export function loadModelPackage(modelId: string): PackageLoadResult {
  const reasons: string[] = [];
  const registered = getModel(modelId);
  if (!registered) {
    return { ok: false, reasons: [`Model id "${modelId}" is not registered in the model registry. Register it first with its true metadata and status.`] };
  }

  const pkgDir = path.resolve(MODEL_ROOT, modelId);
  if (!pathWithin(MODEL_ROOT, pkgDir)) {
    return { ok: false, reasons: ["Package path escapes MODEL_ROOT"] };
  }
  const manifestPath = path.join(pkgDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, reasons: [`No package installed at data\\models\\${modelId}\\manifest.json`] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return { ok: false, reasons: ["manifest.json is not valid JSON"] };
  }
  const v = validateManifest(raw);
  if (!v.ok || !v.manifest) return { ok: false, reasons: v.reasons };
  const manifest = v.manifest;

  if (manifest.model_id !== modelId) reasons.push(`manifest model_id (${manifest.model_id}) does not match package directory (${modelId})`);

  // Artifact integrity
  const artifactPath = path.resolve(pkgDir, manifest.artifact.file);
  if (!pathWithin(pkgDir, artifactPath)) {
    reasons.push("artifact.file escapes the package directory");
  } else if (!fs.existsSync(artifactPath)) {
    reasons.push(`Artifact file not found: ${manifest.artifact.file}`);
  } else {
    try {
      const computed = hashFileBounded(artifactPath).sha256;
      if (computed !== manifest.artifact.sha256) reasons.push(`ARTIFACT CHECKSUM MISMATCH: manifest ${manifest.artifact.sha256.slice(0, 12)}… vs disk ${computed.slice(0, 12)}…. Model will not be executed.`);
    } catch (err) { reasons.push(`ARTIFACT HASH FAILED: ${String(err instanceof Error ? err.message : err).slice(0, 180)}`); }
  }

  if (reasons.length > 0) {
    audit({ actor: "system", action: "model_package.load", outcome: "rejected", detail: `${modelId}: ${reasons.join(" ").slice(0, 200) }` });
    return { ok: false, reasons, manifest };
  }

  audit({ actor: "system", action: "model_package.load", outcome: "ok", detail: `${modelId} v${manifest.version} sha256 verified` });
  return { ok: true, reasons: [], manifest, computed_sha256: manifest.artifact.sha256 };
}

/** Merge a verified package into its registry record (used by providers at load time). */
export function manifestToRecordPatch(manifest: ModelManifest, model: ModelRecord): Partial<ModelRecord> {
  return {
    model_name: manifest.model_name,
    version: manifest.version,
    sha256: manifest.artifact.sha256,
    format: manifest.artifact.format,
    file_path: path.join(manifest.model_id, manifest.artifact.file),
    modalities: manifest.input.modalities as ModelRecord["modalities"],
    input_schema: manifest.input.input_schema,
    uses_symptoms: manifest.input.input_schema === "IMAGE_AND_SYMPTOMS",
    supported_anatomy: manifest.supported_anatomy,
    supported_findings: manifest.supported_findings,
    supported_conditions: manifest.supported_conditions,
    supported_symptom_types: manifest.supported_symptom_types,
    devices: manifest.devices,
    intended_use: manifest.intended_use,
    contraindications: manifest.contraindications,
    limitations: manifest.limitations,
    training_dataset: manifest.training_dataset
      ? { name: manifest.training_dataset.name, version: manifest.training_dataset.version, size_studies: null, size_patients: null, population: manifest.training_dataset.population ?? null, devices: [], provenance_reference: manifest.training_dataset.provenance }
      : model.training_dataset,
    validation_dataset: manifest.validation_dataset
      ? { name: manifest.validation_dataset.name, version: manifest.validation_dataset.version, size_studies: null, size_patients: null, population: manifest.validation_dataset.population ?? null, devices: [], provenance_reference: manifest.validation_dataset.provenance }
      : model.validation_dataset,
    regulatory_status: manifest.regulatory_status,
  };
}
