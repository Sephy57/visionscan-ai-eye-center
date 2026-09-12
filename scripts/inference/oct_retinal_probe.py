#!/usr/bin/env python3
"""Offline, fail-closed probe for the OCT retinal classifier (ONNX).

Mirrors scripts/inference/dr_grade_probe.py discipline: isolated
interpreter, pinned SHA-256, no network, CPUExecutionProvider only, no
remote code. Input is real OCT B-scan pixels; output is the model's real
4-logit argmax plus provenance.

Preprocessing pinned to the publisher edge snippet
(Animesh-Kr/Human-Eye-Disease-Prediction, edge_inference/run_inference.py):
  1. cv2 BGR decode, BGR->RGB convert.
  2. cv2.resize to 224x224 (INTER_LINEAR default).
  3. /255 then ImageNet mean/std normalize.
  4. NHWC float32 batch of 1.
Class order pinned to the same snippet: [CNV, DME, DRUSEN, NORMAL].
The snippet's raw-max-logit "confidence %" is NOT reproduced: logits are
reported as MODEL_SCORE_NOT_CALIBRATED; no probability is emitted.
A temperature scalar ships with the artifact (temperature.npy, T~1.05);
it is REPORTED for the calibration study, never silently applied.
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

EXPECTED_MODEL_ID = "oct-retinal-weights-fp32"
EXPECTED_MODEL_VERSION = "hf-main-2026"
EXPECTED_SHA256 = "22b1fffb5a0ab88284d4c5817c581bedb1b54c09011d87c3f6472cb2c36b2b1f"
EXPECTED_TEMPERATURE = 1.05042436
MAX_IMAGE_BYTES = 64 * 1024 * 1024
MAX_PIXELS = 64 * 1024 * 1024
SIZE = 224
CLASSES = ["CNV", "DME", "DRUSEN", "NORMAL"]


def env_threads(name: str, fallback: int = 1) -> int:
    try:
        value = int(os.environ.get(name, str(fallback)))
    except ValueError:
        value = fallback
    return max(1, min(value, 16))


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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("model_dir", type=Path)
    parser.add_argument("image", type=Path)
    args = parser.parse_args()
    if not sys.flags.isolated or not sys.flags.no_user_site:
        fail("isolated interpreter required; invoke the dedicated Python with -I -s")
    try:
        import cv2
        import numpy as np
        import onnxruntime as ort
        from PIL import Image
    except Exception as exc:
        fail(f"approved local runtime unavailable: {exc}")

    require_isolated_runtime({"cv2": cv2, "numpy": np, "PIL": sys.modules["PIL"], "onnxruntime": ort})
    if set(ort.get_available_providers()) >= {"CPUExecutionProvider"}:
        pass

    artifact_path = args.model_dir / "human_eye_fp32.onnx"
    if path_contains_reparse_point(args.model_dir) or path_contains_reparse_point(args.image) or path_contains_reparse_point(artifact_path):
        fail("symbolic-link/reparse-point model or image paths are not accepted")
    artifact = artifact_path.resolve()
    if sha256_file(artifact) != EXPECTED_SHA256:
        fail("model SHA-256 mismatch")
    temp_path = args.model_dir / "temperature.npy"
    if temp_path.is_file():
        try:
            import numpy as _np
            reported_temperature = float(_np.load(str(temp_path)).flatten()[0])
        except Exception:
            reported_temperature = None
    else:
        reported_temperature = None
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
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        resized = cv2.resize(rgb, (SIZE, SIZE), interpolation=cv2.INTER_LINEAR)
        normed = (resized.astype(np.float32) / 255.0 - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
        batch = np.expand_dims(normed, axis=0).astype(np.float32)
        intra_threads = env_threads("VISIONSCAN_ONNX_INTRA_OP_THREADS")
        inter_threads = env_threads("VISIONSCAN_ONNX_INTER_OP_THREADS")
        session_options = ort.SessionOptions()
        session_options.intra_op_num_threads = intra_threads
        session_options.inter_op_num_threads = inter_threads
        session = ort.InferenceSession(str(artifact), sess_options=session_options, providers=["CPUExecutionProvider"])
        if session.get_providers() != ["CPUExecutionProvider"]:
            fail("non-CPU execution provider refused")
        outputs = session.run(None, {session.get_inputs()[0].name: batch})
        logits = np.asarray(outputs[0], dtype=np.float32).flatten()
        if logits.shape != (4,) or not bool(np.isfinite(logits).all()):
            fail("model output shape or finite-value contract failed")
        pred = int(np.argmax(logits))
        print(json.dumps({
            "inference_status": "completed",
            "model_id": EXPECTED_MODEL_ID,
            "model_version": EXPECTED_MODEL_VERSION,
            "artifact_sha256": EXPECTED_SHA256,
            "image_id": image_id,
            "preprocessing_version": "oct-edge-source-pinned-224-v1",
            "raw_logits": [float(v) for v in logits],
            "score_semantics": "MODEL_SCORE_NOT_CALIBRATED",
            "predicted_class": CLASSES[pred],
            "predicted_index": pred,
            "reported_temperature": reported_temperature,
            "temperature_applied": False,
            "thread_governance": {"intra_op": intra_threads, "inter_op": inter_threads},
            "validation_status": "CANDIDATE_ONLY",
            "calibration_state": "NOT_CALIBRATED",
            "limitations": [
                "CANDIDATE_ONLY; no clinical or independent validation",
                "Argmax of backbone logits; XGBoost hybrid head not executed",
                "Logits are ranking scores, not probabilities",
                "Single-scanner training distribution; cross-scanner behavior unvalidated",
            ],
        }))
    except SystemExit:
        raise
    except Exception as exc:
        fail(f"local inference failed closed: {exc}")


if __name__ == "__main__":
    main()
