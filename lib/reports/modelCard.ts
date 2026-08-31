import { ModelRecord, STATUS_CAPABILITIES } from "../models/registry";

/**
 * Automatic model card generation - built ONLY from registry fields.
 * The card can never claim validation the registry does not record.
 */

export function generateModelCard(model: ModelRecord): string {
  const perf = model.performance;
  const fmt = (x: number | null) => (x === null ? "Not measured" : (x * 100).toFixed(1) + "%");
  const caps = STATUS_CAPABILITIES[model.status];

  return `# Model Card: ${model.model_name}

**Model ID:** \`${model.model_id}\`
**Version:** ${model.version}
**Status:** ${model.status}${caps.requires_label ? `\n**Mandatory label:** ${caps.requires_label}` : ""}

## Intended use
${model.intended_use}

## Contraindications
${model.contraindications.map((c) => `- ${c}`).join("\n") || "- Not specified"}

## Limitations / failure modes
${model.limitations.map((l) => `- ${l}`).join("\n") || "- Not specified"}

## Supported modalities
${model.modalities.join(", ") || "None declared"}

## Supported devices
${model.devices.length === 0 ? "None - device compatibility has not been validated." : model.devices.map((d) => `- ${d.manufacturer} ${d.model}${d.scan_protocol ? ` (${d.scan_protocol})` : ""}`).join("\n")}

## Anatomy / findings
- Anatomy: ${model.supported_anatomy.join(", ") || "None declared"}
- Findings: ${model.supported_findings.join(", ") || "None declared"}

## Training data
${model.training_dataset ? `${model.training_dataset.name} v${model.training_dataset.version} - ${model.training_dataset.size_studies ?? "?"} studies, ${model.training_dataset.size_patients ?? "?"} patients. ${model.training_dataset.population ?? ""} Provenance: ${model.training_dataset.provenance_reference ?? "not recorded"}` : "Not trained on any dataset (placeholder/demo model)."}

## Validation data
${model.validation_dataset ? `${model.validation_dataset.name} v${model.validation_dataset.version} - ${model.validation_dataset.size_studies ?? "?"} studies. Provenance: ${model.validation_dataset.provenance_reference ?? "not recorded"}` : "No validation dataset recorded."}

## Validation methodology
- Patient-level split: ${model.patient_level_split === null ? "Not documented" : model.patient_level_split ? "Yes" : "NO - NOT ACCEPTABLE"}
- Validation date: ${model.validation_date ?? "Never validated"}
- External validation: ${model.external_validation_status}
- Clinical validation: ${model.clinical_validation_status}

## Performance
| Metric | Value |
|---|---|
| Sensitivity | ${fmt(perf.sensitivity)} |
| Specificity | ${fmt(perf.specificity)} |
| PPV | ${fmt(perf.ppv)} |
| NPV | ${fmt(perf.npv)} |
| AUROC | ${perf.auroc === null ? "Not measured" : perf.auroc.toFixed(3)} |
| AUPRC | ${perf.auprc === null ? "Not measured" : perf.auprc.toFixed(3)} |
| Calibration | ${perf.calibration ?? "Not measured"} |
| Evidence reference | ${perf.evidence_reference ?? "None"} |

## Regulatory status
${model.regulatory_status === "none" ? "None. This model has no regulatory authorization. REGULATORY REVIEW REQUIRED before any clinical use." : model.regulatory_status}

## Artifact
- Format: ${model.format ?? "none"}
- SHA-256: ${model.sha256 ?? "No artifact on disk"}
- Path: ${model.file_path ?? "none"}
`;
}
