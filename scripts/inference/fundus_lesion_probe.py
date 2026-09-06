#!/usr/bin/env python3
"""Offline, fail-closed probe for the ClementP lesion checkpoint.

This is intentionally not imported by the live Next.js pipeline. It is a
research worker that only runs when an operator explicitly supplies a local
artifact and a local image. It never calls Hugging Face, loads pickle, enables
remote code, trusts filenames, or turns logits into calibrated probabilities.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("PYTHONNOUSERSITE", "1")

EXPECTED_MODEL_ID = "fundus-lesions-clementp-unet-seresnext50"
EXPECTED_OUTPUT_ORDER = ["background", "cotton_wool_spot", "hard_exudate", "retinal_hemorrhage", "microaneurysm_like_lesion"]
EXPECTED_SHA256 = "a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2"
MAX_IMAGE_BYTES = 64 * 1024 * 1024
MAX_PIXELS = 64 * 1024 * 1024


def fail(message: str) -> None:
    print(json.dumps({"inference_status": "failed", "inference_error": message[:500], "findings": []}))
    raise SystemExit(0)


def sha256_file(path: Path) -> str:
    if not path.is_file() or path.stat().st_size > 2 * 1024 * 1024 * 1024:
        fail("model artifact is missing, not a regular file, or exceeds the size limit")
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def crop_and_pad(rgb, cv2, np, size: int):
    # Pinned reconstruction of the publisher's preprocessing helper. The
    # explicit shape checks prevent OpenCV-version drift from being silently
    # interpreted as a different crop.
    max_img = np.max(rgb, axis=2)
    threshold = 0.05 * float(max_img.max())
    _, roi = cv2.threshold(max_img, threshold, 1, cv2.THRESH_BINARY)
    points = cv2.findNonZero(roi)
    if points is None or len(points) == 0:
        raise ValueError("fundus field could not be located")
    points = points.reshape(-1, 2)
    xmin, xmax = int(points[:, 0].min()), int(points[:, 0].max())
    ymin, ymax = int(points[:, 1].min()), int(points[:, 1].max())
    if xmax <= xmin or ymax <= ymin:
        raise ValueError("fundus crop is empty")
    h, w = rgb.shape[:2]
    cropped = rgb[ymin:ymax, xmin:xmax]
    scale = size / max(cropped.shape[:2])
    resized = cv2.resize(cropped, dsize=None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    ph = size - resized.shape[0]
    pw = size - resized.shape[1]
    if ph < 0 or pw < 0:
        raise ValueError("resize exceeded declared model input")
    top, left = ph // 2, pw // 2
    return np.pad(resized, ((top, ph - top), (left, pw - left), (0, 0)), mode="constant")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("model_dir", type=Path)
    parser.add_argument("image", type=Path)
    parser.add_argument("--model-sha256", default=EXPECTED_SHA256)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    try:
        import cv2
        import numpy as np
        import torch
        from safetensors.torch import load_file
        import torchseg
    except Exception as exc:
        fail(f"approved local runtime unavailable: {exc}")

    artifact = (args.model_dir / "model.safetensors").resolve()
    if sha256_file(artifact) != args.model_sha256.lower():
        fail("model SHA-256 mismatch")
    if not args.image.is_file() or args.image.stat().st_size > MAX_IMAGE_BYTES:
        fail("image is missing or exceeds the byte limit")
    raw = args.image.read_bytes()
    image_id = hashlib.sha256(raw).hexdigest()
    bgr = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if bgr is None or bgr.ndim != 3 or bgr.shape[2] != 3:
        fail("image decode failed or image is not three-channel color")
    if int(bgr.shape[0]) * int(bgr.shape[1]) > MAX_PIXELS:
        fail("decoded image dimensions exceed the pixel limit")
    try:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        prepared = crop_and_pad(rgb, cv2, np, 1024)
        tensor = torch.from_numpy(prepared.astype(np.float32) / 255.0).permute(2, 0, 1).unsqueeze(0)
        mean = torch.tensor([0.485, 0.456, 0.406], dtype=tensor.dtype).view(1, 3, 1, 1)
        std = torch.tensor([0.229, 0.224, 0.225], dtype=tensor.dtype).view(1, 3, 1, 1)
        tensor = (tensor - mean) / std
        torch.set_num_threads(max(1, min(args.threads, 16)))
        model = torchseg.create_model(arch="unet", encoder_name="seresnext50_32x4d", encoder_weights=None, in_channels=3, classes=5)
        state = load_file(str(artifact), device="cpu")
        # Hash again after the SafeTensors read to detect a hash-then-load
        # replacement in a writable research directory. Production packaging
        # must additionally make the package directory non-writable.
        if sha256_file(artifact) != args.model_sha256.lower():
            fail("model artifact changed during load")
        if not state or any(not isinstance(k, str) for k in state):
            fail("SafeTensors state is empty or malformed")
        if all(k.startswith("model.") for k in state):
            state = {k[6:]: v for k, v in state.items()}
        model.load_state_dict(state, strict=True)
        model.eval()
        with torch.inference_mode():
            probabilities = torch.softmax(model(tensor), dim=1).squeeze(0)
        if tuple(probabilities.shape) != (5, 1024, 1024) or not bool(torch.isfinite(probabilities).all()):
            fail("model output shape or finite-value contract failed")
        labels = torch.argmax(probabilities, dim=0).numpy()
        regions = []
        masks = []
        for index, class_name in enumerate(EXPECTED_OUTPUT_ORDER):
            mask = labels == index
            area = int(mask.sum())
            masks.append({"class_name": class_name, "width": 1024, "height": 1024, "mask_ref": None, "area_pixels": area})
            if index == 0 or area == 0:
                continue
            ys, xs = np.where(mask)
            regions.append({"class_name": class_name, "area_pixels": area,
                            "centroid": {"x": float(xs.mean() / 1024), "y": float(ys.mean() / 1024)},
                            "bounding_box": {"x": float(xs.min() / 1024), "y": float(ys.min() / 1024), "w": float((xs.max() - xs.min() + 1) / 1024), "h": float((ys.max() - ys.min() + 1) / 1024)},
                            "mask_ref": None, "raw_score": None})
        summary = "NO_TARGET_ABNORMALITY_DETECTED" if not regions else ("MULTIPLE_ABNORMALITIES" if len(regions) > 1 else "SUSPICIOUS_ABNORMALITY")
        print(json.dumps({"inference_status": "completed", "model_id": EXPECTED_MODEL_ID, "model_version": "a2cfcb594e483", "image_id": image_id, "raw_output_shape": [5, 1024, 1024], "output_order": EXPECTED_OUTPUT_ORDER, "preprocessing_version": "clementp-source-pinned-1024-v1", "threshold_version": "argmax-only-no-calibration", "validation_status": "CANDIDATE_ONLY", "image_level_summary": summary, "class_masks": masks, "class_scores": [{"class_name": c, "score_semantics": "NOT_CALIBRATED", "score": None} for c in EXPECTED_OUTPUT_ORDER], "lesion_regions": regions, "limitations": ["CANDIDATE_ONLY; no clinical or independent validation", "Argmax masks are not calibrated probabilities"]}))
    except SystemExit:
        raise
    except Exception as exc:
        fail(f"local inference failed closed: {exc}")


if __name__ == "__main__":
    main()
