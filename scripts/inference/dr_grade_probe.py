#!/usr/bin/env python3
"""Offline, fail-closed probe for the ClementP DR-grading checkpoint.

Mirrors scripts/inference/fundus_lesion_probe.py discipline: isolated
interpreter, pinned SHA-256, SafeTensors only, no network, no
trust_remote_code, no pickle. Input is real image pixels; output is the
model's real single-logit grade plus provenance.

Preprocessing is pinned to the publisher source
(ClementPla/FundusDRGrading, src/fundusClassif/data/fundus.py,
albumentations 1.4.4, opencv 4.9.0.80):
  1. cv2 BGR decode (nntools ClassificationDataset uses IMREAD_COLOR, so
     channel 0 — the crop channel despite its `r_img` name — is BLUE).
  2. fundus_autocrop: threshold channel 0 at 10, bounding box of nonzero
     pixels, numpy-exclusive slicing; degenerate (empty/line) -> whole image.
  3. LongestMaxSize(512): INTER_LINEAR longest side to 512.
  4. PadIfNeeded to 512x512, BORDER_CONSTANT, center position.
  5. /255 then ImageNet mean/std normalize in the same channel order,
     HWC->CHW float32 tensor.
Grade mapping pinned to my_lightning_module.regression_to_prediction:
  torch.round(logit).clamp(0, 4) (banker's rounding, exact).
Residual caveat: cv2 4.9-vs-5.0 INTER_LINEAR may differ in last-bit
rounding; disclosed, does not affect determinism within this environment.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import sys

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

EXPECTED_MODEL_ID = "fundus-dr-grading-effb0"
EXPECTED_MODEL_VERSION = "aa5741419b90"
EXPECTED_SHA256 = "0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b"
MAX_IMAGE_BYTES = 64 * 1024 * 1024
MAX_PIXELS = 64 * 1024 * 1024
SIZE = 512
GRADE_LABELS = ["no_dr", "mild_npdr", "moderate_npdr", "severe_npdr", "proliferative_dr"]


def fail(message: str) -> None:
    print(json.dumps({"inference_status": "failed", "inference_error": message[:500]}))
    raise SystemExit(2)


def sha256_file(path: Path) -> str:
    if not path.is_file() or path.stat().st_size > 2 * 1024 * 1024 * 1024:
        fail("model artifact is missing, not a regular file, or exceeds the size limit")
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def path_contains_reparse_point(path: Path) -> bool:
    current = path.absolute()
    while True:
        if current.exists():
            stat = current.lstat()
            if current.is_symlink() or bool(getattr(stat, "st_file_attributes", 0) & 0x400):
                return True
        if current.parent == current:
            return False
        current = current.parent


def require_isolated_runtime(modules) -> None:
    if not sys.flags.isolated or not sys.flags.no_user_site:
        fail("isolated interpreter required; invoke the dedicated Python with -I -s")
    prefix = Path(sys.prefix).resolve()
    for name, module in modules.items():
        module_file = getattr(module, "__file__", None)
        if not module_file:
            fail(f"dependency {name} has no auditable module path")
        try:
            Path(module_file).resolve().relative_to(prefix)
        except ValueError:
            fail(f"dependency {name} was imported outside the dedicated environment")


def autocrop(bgr, cv2, np):
    # Exact port of fundus_autocrop (threshold 10 on channel 0, exclusive-max
    # slicing, degenerate input returns the whole image).
    _, mask = cv2.threshold(bgr[:, :, 0], 10, 1, cv2.THRESH_BINARY)
    points = cv2.findNonZero(mask)
    if points is None or len(points) == 0:
        return bgr, None
    points = points.reshape(-1, 2)
    xmin, xmax = int(points[:, 0].min()), int(points[:, 0].max())
    ymin, ymax = int(points[:, 1].min()), int(points[:, 1].max())
    if xmax <= xmin or ymax <= ymin:
        return bgr, None
    return bgr[ymin:ymax, xmin:xmax], {"x": xmin, "y": ymin, "w": xmax - xmin, "h": ymax - ymin}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("model_dir", type=Path)
    parser.add_argument("image", type=Path)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if not sys.flags.isolated or not sys.flags.no_user_site:
        fail("isolated interpreter required; invoke the dedicated Python with -I -s")
    try:
        import cv2
        import numpy as np
        import timm
        import torch
        from PIL import Image
        from safetensors.torch import load_file
    except Exception as exc:
        fail(f"approved local runtime unavailable: {exc}")

    require_isolated_runtime({"cv2": cv2, "numpy": np, "PIL": sys.modules["PIL"], "timm": timm, "torch": torch, "safetensors": sys.modules["safetensors"]})

    artifact_path = args.model_dir / "model.safetensors"
    if path_contains_reparse_point(args.model_dir) or path_contains_reparse_point(args.image) or path_contains_reparse_point(artifact_path):
        fail("symbolic-link/reparse-point model or image paths are not accepted")
    artifact = artifact_path.resolve()
    if sha256_file(artifact) != EXPECTED_SHA256:
        fail("model SHA-256 mismatch")
    if not args.image.is_file() or args.image.stat().st_size > MAX_IMAGE_BYTES:
        fail("image is missing or exceeds the byte limit")
    raw = args.image.read_bytes()
    image_id = hashlib.sha256(raw).hexdigest()
    try:
        with Image.open(io.BytesIO(raw)) as header:
            header_width, header_height = header.size
            if header_width <= 0 or header_height <= 0 or header_width * header_height > MAX_PIXELS:
                fail("declared image dimensions exceed the pixel limit")
    except SystemExit:
        raise
    except Exception as exc:
        fail(f"image header validation failed: {exc}")
    bgr = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if bgr is None or bgr.ndim != 3 or bgr.shape[2] != 3:
        fail("image decode failed or image is not three-channel color")
    if int(bgr.shape[0]) * int(bgr.shape[1]) > MAX_PIXELS:
        fail("decoded image dimensions exceed the pixel limit")
    try:
        original = {"width": int(bgr.shape[1]), "height": int(bgr.shape[0])}
        cropped, crop = autocrop(bgr, cv2, np)
        scale = SIZE / max(cropped.shape[:2])
        resized = cv2.resize(cropped, dsize=None, fx=scale, fy=scale, interpolation=cv2.INTER_LINEAR)
        ph = SIZE - int(resized.shape[0])
        pw = SIZE - int(resized.shape[1])
        if ph < 0 or pw < 0:
            fail("resize exceeded declared model input")
        # PadIfNeeded center position (albumentations 1.4.x default).
        top, left = ph // 2, pw // 2
        prepared = cv2.copyMakeBorder(resized, top, ph - top, left, pw - left, cv2.BORDER_CONSTANT, value=0)
        tensor = torch.from_numpy(prepared.astype(np.float32) / 255.0).permute(2, 0, 1).unsqueeze(0)
        mean = torch.tensor([0.485, 0.456, 0.406], dtype=tensor.dtype).view(1, 3, 1, 1)
        std = torch.tensor([0.229, 0.224, 0.225], dtype=tensor.dtype).view(1, 3, 1, 1)
        tensor = (tensor - mean) / std
        intra_threads = max(1, min(int(os.environ.get("VISIONSCAN_PYTORCH_INTRA_OP_THREADS", args.threads)), 16))
        inter_threads = max(1, min(int(os.environ.get("VISIONSCAN_PYTORCH_INTER_OP_THREADS", "1")), 16))
        torch.set_num_threads(intra_threads)
        try:
            torch.set_num_interop_threads(inter_threads)
        except RuntimeError:
            # The process may already have initialized a parallel runtime;
            # the environment remains the authoritative cooperative hint.
            pass
        model = timm.create_model("efficientnet_b0", num_classes=1, pretrained=False)
        state = load_file(str(artifact), device="cpu")
        if sha256_file(artifact) != EXPECTED_SHA256:
            fail("model artifact changed during load")
        if not state or any(not isinstance(k, str) for k in state):
            fail("SafeTensors state is empty or malformed")
        model.load_state_dict(state, strict=True)
        model.eval()
        with torch.inference_mode():
            logit = model(tensor).flatten()
        if tuple(logit.shape) != (1,) or not bool(torch.isfinite(logit).all()):
            fail("model output shape or finite-value contract failed")
        raw_logit = float(logit[0].item())
        grade = int(torch.round(logit).clamp(0, 4)[0].item())
        print(json.dumps({
            "inference_status": "completed",
            "model_id": EXPECTED_MODEL_ID,
            "model_version": EXPECTED_MODEL_VERSION,
            "artifact_sha256": EXPECTED_SHA256,
            "image_id": image_id,
            "preprocessing_version": "clementp-dr-source-pinned-512-v1",
            "preprocessing_transform": {
                "original": original,
                "crop": crop,
                "model": {"width": SIZE, "height": SIZE},
            },
            "raw_logit": raw_logit,
            "score_semantics": "MODEL_SCORE_NOT_CALIBRATED",
            "thread_governance": {"intra_op": intra_threads, "inter_op": inter_threads},
            "predicted_grade": grade,
            "grade_label": GRADE_LABELS[grade],
            "referable_dr": grade >= 2,
            "validation_status": "CANDIDATE_ONLY",
            "calibration_state": "NOT_CALIBRATED",
            "limitations": [
                "CANDIDATE_ONLY; no clinical or independent validation",
                "Single regression logit rounded to a grade; not a probability",
                "No calibrated confidence exists for any grade",
            ],
        }))
    except SystemExit:
        raise
    except Exception as exc:
        fail(f"local inference failed closed: {exc}")


if __name__ == "__main__":
    main()
