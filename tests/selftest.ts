import sharp from "sharp";
import { createStudy, analyzeStudy, getStudyBundle, deleteStudy, submitReview } from "@/lib/studies/service";
import { runSafetyChecks } from "@/lib/clinical/safety";
import { validateAnalysisResult } from "@/lib/analysis/schema";
import { runTriage } from "@/lib/clinical/triage";
import { buildDemoFindings, pickDemoScenario } from "@/lib/analysis/findings";
import { DeviceMetadata } from "@/lib/devices/adapter";
import { verifyModelIntegrity } from "@/lib/models/integrity";
import { assessOod } from "@/lib/analysis/ood";
import type { QualityResult } from "@/lib/imaging/quality";

/**
 * End-to-end self-test of the safety-critical pipeline.
 * Runs against the real storage on D:. Creates synthetic test images,
 * never uses patient data, and cleans up after itself.
 */

export interface SelfTestCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface SelfTestReport {
  total: number;
  passed: number;
  all_passed: boolean;
  checks: SelfTestCheck[];
  timestamp: string;
}

async function makeTestImage(kind: "clean" | "dark"): Promise<Buffer> {
  // Deterministic synthetic fundus-like image (NOT a medical image).
  const w = 1024, h = 768;
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#7a1f1f"/>
     <circle cx="512" cy="384" r="300" fill="#8e2626"/>
     <circle cx="640" cy="384" r="70" fill="#c96a2a"/>
     <circle cx="660" cy="384" r="28" fill="#e8d9b0"/>
     <path d="M 600 384 Q 500 300 380 260" stroke="#d94f2a" stroke-width="10" fill="none"/>
     <path d="M 600 384 Q 500 470 380 520" stroke="#d94f2a" stroke-width="8" fill="none"/></svg>`
  );
  const base = await sharp(svg).png().toBuffer();
  if (kind === "dark") {
    return sharp(base).linear(0.08, 0).png().toBuffer(); // nearly black -> quality fail
  }
  return base;
}

const DECLARED: DeviceMetadata = {
  scanType: "fundus",
  eye: "OD",
  providedBy: "none",
};

export async function runSelfTest(): Promise<SelfTestReport> {
  const checks: SelfTestCheck[] = [];
  const t = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, detail });

  let cleanStudyId: string | null = null;
  let darkStudyId: string | null = null;

  try {
    // 1. Upload clean synthetic image.
    const cleanBytes = await makeTestImage("clean");
    const clean = await createStudy("selftest-clean.png", "image/png", cleanBytes, DECLARED);
    cleanStudyId = clean.study_id;
    t("upload_clean_image", !!clean.study_id, clean.original_sha256.slice(0, 12));

    // 2. Analyze -> schema valid.
    const { analysis } = await analyzeStudy(clean.study_id);
    const v = validateAnalysisResult(analysis);
    t("structured_output_validates", v.valid, v.errors.map((e) => `${e.path}:${e.message}`).join("; ") || undefined);

    // 3. Safety checks pass.
    const s = runSafetyChecks(analysis);
    t("safety_checks_pass", s.ok, JSON.stringify(s.checks.filter((c) => !c.passed)));

    // 4. All findings labeled synthetic + demo label present.
    t(
      "findings_labeled_synthetic",
      analysis.findings.every((f) => f.synthetic) && analysis.demo.synthetic_result === true
    );

    // 5. Report exists with mandatory wording when negative.
    const bundle = await getStudyBundle(clean.study_id);
    t("report_generated", !!bundle.report, bundle.report?.overall_result);

    // 6. Poor-quality image is rejected: no findings, mandatory message.
    const darkBytes = await makeTestImage("dark");
    const dark = await createStudy("selftest-dark.png", "image/png", darkBytes, DECLARED);
    darkStudyId = dark.study_id;
    const darkRes = await analyzeStudy(dark.study_id);
    t(
      "quality_gate_blocks_poor_image",
      darkRes.analysis.quality.acceptable === false && darkRes.analysis.findings.length === 0,
      `status=${darkRes.analysis.quality.status}`
    );

    // 7. Red-flag symptom escalates to emergency triage.
    const redFlag = runTriage({
      findings: [],
      qualityAcceptable: true,
      qualityScore: 0.95,
      uncertainty: 0.1,
      modality: "fundus",
      redFlagSymptoms: ["sudden_vision_loss"],
    });
    t("red_flag_escalates_to_emergency", redFlag.priority === "emergency_evaluation");

    // 8. Deterministic demo scenarios never fabricate high confidence without ensemble.
    const demoFindings = buildDemoFindings(pickDemoScenario(cleanBytes), 0.95);
    t("demo_findings_confidence_capped", demoFindings.every((f) => f.confidence <= 0.85));

    // 9. Model registry integrity: unknown model refused; DEMO placeholder trusted only via gate.
    t("model_integrity_refuses_unknown", verifyModelIntegrity("no-such-model").trusted === false);
    t("model_integrity_demo_gate", verifyModelIntegrity("demo-fundus-synthetic-v0").trusted === true);

    // 10. OOD layer: missing metadata + unknown model -> outside operating conditions, no normality claim.
    const ood = assessOod({
      modality: "unknown",
      quality: {
        quality_score: 0.9, quality_status: "pass", detected_artifacts: [], affected_regions: [],
        recommended_reacquisition: false,
        metrics: { width: 1024, height: 768, sharpness_score: 0.8, illumination_mean: 120, illumination_p5: 30, illumination_p95: 230, highlight_clip_ratio: 0, shadow_clip_ratio: 0, colorfulness: 0.4, grayscale_only: false },
        thresholds: {}, limitations: [],
      } as QualityResult,
      model: null,
      device: null,
      metadataProvided: false,
    });
    t("ood_flags_unverified_input", ood.detected === true && ood.message.includes("outside the validated operating conditions"));

    // 11. OOD result cannot claim normality (triage rule).
    const oodTriage = runTriage({ findings: [], qualityAcceptable: true, qualityScore: 0.95, uncertainty: 0.1, modality: "fundus", ood: { detected: true, message: ood.message } });
    t("ood_prevents_normality_claim", !oodTriage.action.toLowerCase().includes("no significant abnormality detected"));

    // 12. Treatment information is honestly empty for the DEMO deployment, and
    // the clinician treatment-review workflow keeps the AI output immutable.
    t(
      "treatment_information_empty_for_demo",
      analysis.treatment_information === undefined,
      "DEMO model must never surface treatment information"
    );
    const treatmentReview = await submitReview(clean.study_id, {
      reviewer_id: "selftest_clinician", action: "treatment_note", condition_id: "diabetic_retinopathy", note: "self-test note",
    });
    t(
      "treatment_review_recorded_without_mutating_ai_output",
      treatmentReview?.treatment_review?.decisions.some((d) => d.condition_id === "diabetic_retinopathy") === true &&
        treatmentReview?.treatment_information === undefined,
      "clinician treatment note recorded separately; AI treatment_information (absent for DEMO) left untouched"
    );

    // 13. Delete removes study.
    if (darkStudyId) {
      await deleteStudy(darkStudyId);
      const gone = await getStudyBundle(darkStudyId);
      t("delete_study", gone.study === null);
      darkStudyId = null;
    }
  } catch (err) {
    t("selftest_execution", false, String(err instanceof Error ? err.message : err).slice(0, 300));
  } finally {
    // Cleanup remaining test artifacts.
    try { if (cleanStudyId) await deleteStudy(cleanStudyId); } catch {}
    try { if (darkStudyId) await deleteStudy(darkStudyId); } catch {}
  }

  const passed = checks.filter((c) => c.passed).length;
  return {
    total: checks.length,
    passed,
    all_passed: passed === checks.length,
    checks,
    timestamp: new Date().toISOString(),
  };
}
