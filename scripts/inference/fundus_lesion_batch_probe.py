#!/usr/bin/env python3
"""Serial batch probe for the hash-pinned ClementP lesion checkpoint.

The ordinary lesion probe intentionally starts one isolated Python process per
image. That is useful for a short-lived provider boundary, but it is too slow
for a bounded 400-image evidence run on a CPU-only workstation. This probe
keeps the same model, preprocessing, artifact checks, coordinate mapping, and
fail-closed output rules while loading one model in one finite worker and
processing the manifest strictly serially.

The manifest is operator-owned scratch input. The output contains only an
index and aggregate-relevant counts; it never emits patient/image paths or
case identifiers.
"""
from __future__ import annotations

import argparse
import gc
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import time

# ``-I`` deliberately omits the script directory from sys.path. Re-add this
# trusted, repository-owned directory explicitly so the batch probe can reuse
# the ordinary probe's pure helper functions without importing third-party
# code from a user site or temporary overlay.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fundus_lesion_probe import (
    EXPECTED_MODEL_ID,
    EXPECTED_OUTPUT_ORDER,
    EXPECTED_SHA256,
    MAX_COMPONENTS,
    MAX_IMAGE_BYTES,
    MAX_PIXELS,
    crop_and_pad,
    model_box_to_original,
    model_point_to_original,
    path_contains_reparse_point,
    require_isolated_runtime,
)

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

MAX_MANIFEST_ITEMS = 1_000


def fatal(message: str) -> None:
    print(json.dumps({"batch_status": "failed", "error": message[:500]}))
    raise SystemExit(2)


def sha256_file(path: Path) -> str:
    if not path.is_file() or path.stat().st_size > 2 * 1024 * 1024 * 1024:
        fatal("model artifact is missing, not a regular file, or exceeds the size limit")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def read_manifest(path: Path) -> list[Path]:
    if path_contains_reparse_point(path) or not path.is_file():
        fatal("batch manifest is missing or unsafe")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fatal(f"batch manifest is not valid JSON: {exc}")
    if not isinstance(payload, list) or not payload or len(payload) > MAX_MANIFEST_ITEMS:
        fatal("batch manifest must contain between 1 and 1000 entries")
    paths: list[Path] = []
    for item in payload:
        if not isinstance(item, dict) or not isinstance(item.get("image_path"), str):
            fatal("batch manifest entry must contain an image_path")
        image_path = Path(item["image_path"])
        if not image_path.is_absolute():
            fatal("batch image paths must be absolute")
        paths.append(image_path)
    return paths


def image_summary(index: int, image_path: Path, cv2, np, Image, torch, model, artifact_sha256: str, intra_threads: int) -> dict:
    started = time.perf_counter()
    try:
        if path_contains_reparse_point(image_path) or not image_path.is_file():
            raise ValueError("image is missing or unsafe")
        if image_path.stat().st_size > MAX_IMAGE_BYTES:
            raise ValueError("image exceeds the byte limit")
        raw = image_path.read_bytes()
        with Image.open(io.BytesIO(raw)) as header:
            width, height = header.size
            if width <= 0 or height <= 0 or width * height > MAX_PIXELS:
                raise ValueError("declared image dimensions exceed the pixel limit")
        bgr = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if bgr is None or bgr.ndim != 3 or bgr.shape[2] != 3:
            raise ValueError("image decode failed or image is not three-channel color")
        if int(bgr.shape[0]) * int(bgr.shape[1]) > MAX_PIXELS:
            raise ValueError("decoded image dimensions exceed the pixel limit")

        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        prepared, transform = crop_and_pad(rgb, cv2, np, 1024)
        tensor = torch.from_numpy(prepared.astype(np.float32) / 255.0).permute(2, 0, 1).unsqueeze(0)
        mean = torch.tensor([0.485, 0.456, 0.406], dtype=tensor.dtype).view(1, 3, 1, 1)
        std = torch.tensor([0.229, 0.224, 0.225], dtype=tensor.dtype).view(1, 3, 1, 1)
        tensor = (tensor - mean) / std
        with torch.inference_mode():
            probabilities = torch.softmax(model(tensor), dim=1).squeeze(0)
        if tuple(probabilities.shape) != (5, 1024, 1024) or not bool(torch.isfinite(probabilities).all()):
            raise ValueError("model output shape or finite-value contract failed")
        labels = torch.argmax(probabilities, dim=0).numpy()
        left, top = transform["padding"]["left"], transform["padding"]["top"]
        resized_w, resized_h = transform["resized"]["width"], transform["resized"]["height"]
        content = np.zeros((1024, 1024), dtype=bool)
        content[top:top + resized_h, left:left + resized_w] = True
        labels[~content] = 0

        class_counts = {"MA-like": 0, "HE-like": 0, "EX-like": 0, "CWS-like": 0}
        class_keys = {
            "microaneurysm_like_lesion": "MA-like",
            "retinal_hemorrhage": "HE-like",
            "hard_exudate": "EX-like",
            "cotton_wool_spot": "CWS-like",
        }
        region_count = 0
        for mask_index, class_name in enumerate(EXPECTED_OUTPUT_ORDER):
            mask = labels == mask_index
            area = int(mask.sum())
            if mask_index == 0 or area == 0:
                continue
            count, _, stats, centroids = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
            region_count += count - 1
            if region_count > MAX_COMPONENTS:
                raise ValueError("candidate output exceeds the bounded connected-component limit")
            for component in range(1, count):
                x, y, width, height, _ = [int(value) for value in stats[component]]
                mapped = model_box_to_original((x, y, width, height), transform)
                if mapped is None:
                    raise ValueError("non-background component could not be mapped to source-image coordinates")
                model_point_to_original((centroids[component][0] + 0.5, centroids[component][1] + 0.5), transform)
                class_counts[class_keys[class_name]] += 1

        summary = "NO_TARGET_ABNORMALITY_DETECTED" if region_count == 0 else ("MULTIPLE_ABNORMALITIES" if region_count > 1 else "SUSPICIOUS_ABNORMALITY")
        return {
            "index": index,
            "inference_status": "completed",
            "output_contract": "fundus-lesion-segmentation-batch-summary/1",
            "artifact_sha256": artifact_sha256,
            "region_count": region_count,
            "class_counts": class_counts,
            "image_level_summary": summary,
            "service_ms": round((time.perf_counter() - started) * 1000, 3),
            "thread_governance": {"intra_op": intra_threads, "inter_op": 1},
        }
    except Exception as exc:
        return {
            "index": index,
            "inference_status": "failed",
            "error": str(exc)[:300],
            "service_ms": round((time.perf_counter() - started) * 1000, 3),
        }
    finally:
        for name in ("tensor", "probabilities", "labels", "prepared", "rgb", "bgr"):
            if name in locals():
                del locals()[name]
        gc.collect()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("model_dir", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()

    if not sys.flags.isolated or not sys.flags.no_user_site:
        fatal("isolated interpreter required; invoke the dedicated Python with -I -s")
    if path_contains_reparse_point(args.model_dir):
        fatal("symbolic-link/reparse-point model path is not accepted")
    artifact_path = args.model_dir / "model.safetensors"
    if path_contains_reparse_point(artifact_path):
        fatal("symbolic-link/reparse-point model artifact is not accepted")
    manifest_paths = read_manifest(args.manifest)

    try:
        import cv2
        import einops
        import numpy as np
        import timm
        import torch
        import torchvision
        from PIL import Image
        from safetensors.torch import load_file
        import torchseg
    except Exception as exc:
        fatal(f"approved local runtime unavailable: {exc}")

    require_isolated_runtime({"cv2": cv2, "einops": einops, "numpy": np, "PIL": sys.modules["PIL"], "timm": timm, "torch": torch, "torchvision": torchvision, "safetensors": sys.modules["safetensors"], "torchseg": torchseg})
    artifact_sha256 = sha256_file(artifact_path)
    if artifact_sha256 != EXPECTED_SHA256:
        fatal("model SHA-256 mismatch")
    intra_threads = max(1, min(int(os.environ.get("VISIONSCAN_PYTORCH_INTRA_OP_THREADS", args.threads)), 16))
    inter_threads = max(1, min(int(os.environ.get("VISIONSCAN_PYTORCH_INTER_OP_THREADS", "1")), 16))
    torch.set_num_threads(intra_threads)
    try:
        torch.set_num_interop_threads(inter_threads)
    except RuntimeError:
        pass
    try:
        model = torchseg.create_model(arch="unet", encoder_name="seresnext50_32x4d", encoder_weights=None, in_channels=3, classes=5)
        state = load_file(str(artifact_path), device="cpu")
        if sha256_file(artifact_path) != artifact_sha256:
            fatal("model artifact changed during load")
        if not state or any(not isinstance(key, str) for key in state):
            fatal("SafeTensors state is empty or malformed")
        if all(key.startswith("model.") for key in state):
            state = {key[6:]: value for key, value in state.items()}
        model.load_state_dict(state, strict=True)
        model.eval()
    except SystemExit:
        raise
    except Exception as exc:
        fatal(f"local model load failed closed: {exc}")

    results = [image_summary(index, image_path, cv2, np, Image, torch, model, artifact_sha256, intra_threads) for index, image_path in enumerate(manifest_paths)]
    print(json.dumps({
        "batch_status": "complete",
        "output_contract": "fundus-lesion-segmentation-batch-summary/1",
        "model_id": EXPECTED_MODEL_ID,
        "artifact_sha256": artifact_sha256,
        "serial": True,
        "count": len(results),
        "thread_governance": {"intra_op": intra_threads, "inter_op": inter_threads},
        "results": results,
    }))


if __name__ == "__main__":
    main()
