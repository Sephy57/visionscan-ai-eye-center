#!/usr/bin/env python3
"""
S9 - real research inference for the segformer-optic-disc-cup-refuge
candidate (pamixsun/segformer_for_optic_disc_cup_segmentation, Apache-2.0).

SAFETY:
 - loads ONLY model.safetensors (use_safetensors=True; never the pickle
   pytorch_model.bin sibling)
 - native transformers SegformerForSemanticSegmentation class - no
   trust_remote_code, no custom modeling files
 - local_files_only=True - no network access at inference time
 - performs NO clinical interpretation; prints raw segmentation only

Usage: python segformer_infer.py <model_dir> <image_path>
Prints one line of JSON to stdout (RawModelOutput-shaped) and exits 0 on
success. On any failure (bad image, model error, NaN/Inf output) prints
{"inference_status": "failed", ...} and exits 1 - the caller must fail
closed on a non-zero exit or a "failed" inference_status.
"""
import hashlib
import json
import sys
import time

MODEL_ID = "segformer-optic-disc-cup-refuge"
MODEL_VERSION = "1"
ARTIFACT_SHA256 = "22e45131b64eb07a5d29a2e5388a7709d10696b13f48d2d0cdcf56cafa1f9ea5"


def main() -> int:
    if len(sys.argv) != 3:
        print(json.dumps({"inference_status": "failed", "inference_error": "usage: segformer_infer.py <model_dir> <image_path>"}))
        return 1
    model_dir, image_path = sys.argv[1], sys.argv[2]

    t0 = time.time()
    try:
        import torch
        from transformers import SegformerForSemanticSegmentation, SegformerImageProcessor
        from PIL import Image
    except Exception as exc:
        print(json.dumps({"inference_status": "failed", "inference_error": f"import failure: {exc}"[:300]}))
        return 1
    t_import = time.time() - t0

    try:
        model = SegformerForSemanticSegmentation.from_pretrained(model_dir, use_safetensors=True, local_files_only=True)
        model.eval()
        processor = SegformerImageProcessor.from_pretrained(model_dir, local_files_only=True)
    except Exception as exc:
        print(json.dumps({"inference_status": "failed", "inference_error": f"model load failure: {exc}"[:300]}))
        return 1
    t_load = time.time() - t0 - t_import

    try:
        image = Image.open(image_path).convert("RGB")
        image_sha256 = hashlib.sha256(open(image_path, "rb").read()).hexdigest()
    except Exception as exc:
        print(json.dumps({"inference_status": "failed", "inference_error": f"image load failure: {exc}"[:300]}))
        return 1

    try:
        t1 = time.time()
        inputs = processor(images=image, return_tensors="pt")
        with torch.no_grad():
            outputs = model(**inputs)
        logits = outputs.logits
        upsampled = torch.nn.functional.interpolate(logits, size=image.size[::-1], mode="bilinear", align_corners=False)
        pred_mask = upsampled.argmax(dim=1)[0]
        t_inference = time.time() - t1
    except Exception as exc:
        print(json.dumps({"inference_status": "failed", "inference_error": f"inference failure: {exc}"[:300]}))
        return 1

    if bool(torch.isnan(logits).any().item()) or bool(torch.isinf(logits).any().item()):
        print(json.dumps({"inference_status": "failed", "inference_error": "model output contains NaN/Inf"}))
        return 1

    id2label = {0: "background", 1: "optic_disc", 2: "optic_cup"}
    unique_classes = sorted(set(pred_mask.unique().tolist()))
    class_pixel_counts = {id2label.get(int(c), str(c)): int((pred_mask == c).sum().item()) for c in unique_classes}
    total_px = int(pred_mask.numel())
    img_h, img_w = pred_mask.shape

    findings = []
    for cls_id, cls_name in id2label.items():
        if cls_id == 0:
            continue
        px = class_pixel_counts.get(cls_name, 0)
        if px == 0:
            continue
        # Real bounding box of the predicted mask region for this class -
        # computed directly from the actual predicted pixels, never invented.
        ys, xs = torch.where(pred_mask == cls_id)
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        localization = {
            "kind": "bounding_box",
            "coordinates": {
                "x": round(x0 / img_w, 4),
                "y": round(y0 / img_h, 4),
                "w": round((x1 - x0 + 1) / img_w, 4),
                "h": round((y1 - y0 + 1) / img_h, 4),
            },
        }
        findings.append({
            "finding_type": f"research_segmented_{cls_name}_area",
            "laterality": "unknown",  # never inferred from pixels - see docs/S9_REAL_MODEL_INTEGRATION.md
            # no "confidence" key: this model exposes no calibrated per-instance
            # confidence at this abstraction level - the field is OMITTED, not
            # set to null (the output contract's RawFinding.confidence is a
            # plain optional number, not nullable - see lib/models/outputContract.ts)
            "evidence": f"{px} px / {total_px} px ({100.0 * px / total_px:.2f}%)",
            "localization": localization,
        })

    result = {
        "inference_status": "completed",
        "model_id": MODEL_ID,
        "model_version": MODEL_VERSION,
        "artifact_sha256": ARTIFACT_SHA256,
        "preprocessing_version": "segformer-pamixsun-image-processor-v1",
        "modality": "FUNDUS",
        "laterality": "unknown",
        "findings": findings,
        "confidence": None,
        "calibrated_confidence": None,
        "limitations": [
            "RESEARCH_INFERENCE only - NOT CLINICALLY VALIDATED.",
            "No published validation metrics exist for this checkpoint (see lib/models/candidateDossiers.ts).",
            "Model exhibits no internal rejection of degenerate/unsuitable input images - upstream quality/OOD gating is mandatory, not optional.",
        ],
        "_debug": {
            "image_sha256": image_sha256,
            "image_original_size": list(image.size),
            "logits_shape": list(logits.shape),
            "pred_mask_shape": list(pred_mask.shape),
            "class_pixel_counts": class_pixel_counts,
            "timing_seconds": {"import": round(t_import, 3), "model_load": round(t_load, 3), "inference": round(t_inference, 3)},
            "torch_version": torch.__version__,
        },
    }
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
