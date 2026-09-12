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
import io
import json
import os
from pathlib import Path
import sys

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

EXPECTED_MODEL_ID = "fundus-lesions-clementp-unet-seresnext50"
EXPECTED_OUTPUT_ORDER = ["background", "cotton_wool_spot", "hard_exudate", "retinal_hemorrhage", "microaneurysm_like_lesion"]
EXPECTED_SHA256 = "a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2"
MAX_IMAGE_BYTES = 64 * 1024 * 1024
MAX_PIXELS = 64 * 1024 * 1024
MAX_COMPONENTS = 10_000


def fail(message: str) -> None:
    print(json.dumps({"inference_status": "failed", "inference_error": message[:500], "findings": []}))
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
    transform = {
        "coordinate_space": "MODEL_PIXELS_TO_ORIGINAL_IMAGE",
        "original": {"width": int(w), "height": int(h)},
        "crop": {"x": xmin, "y": ymin, "w": int(cropped.shape[1]), "h": int(cropped.shape[0])},
        "model": {"width": size, "height": size},
        "resized": {"width": int(resized.shape[1]), "height": int(resized.shape[0])},
        "padding": {"left": left, "top": top, "right": pw - left, "bottom": ph - top},
    }
    prepared = np.pad(resized, ((top, ph - top), (left, pw - left), (0, 0)), mode="constant")
    return prepared, transform


def model_box_to_original(box, transform):
    """Map a half-open model-pixel box through crop/letterbox to source-normalized geometry."""
    left = transform["padding"]["left"]
    top = transform["padding"]["top"]
    resized_w = transform["resized"]["width"]
    resized_h = transform["resized"]["height"]
    x0 = max(float(left), float(box[0]))
    y0 = max(float(top), float(box[1]))
    x1 = min(float(left + resized_w), float(box[0] + box[2]))
    y1 = min(float(top + resized_h), float(box[1] + box[3]))
    if x1 <= x0 or y1 <= y0:
        return None
    crop = transform["crop"]
    original = transform["original"]
    ox0 = crop["x"] + (x0 - left) * crop["w"] / resized_w
    oy0 = crop["y"] + (y0 - top) * crop["h"] / resized_h
    ox1 = crop["x"] + (x1 - left) * crop["w"] / resized_w
    oy1 = crop["y"] + (y1 - top) * crop["h"] / resized_h
    nx0 = min(1.0, max(0.0, ox0 / original["width"]))
    ny0 = min(1.0, max(0.0, oy0 / original["height"]))
    nx1 = min(1.0, max(0.0, ox1 / original["width"]))
    ny1 = min(1.0, max(0.0, oy1 / original["height"]))
    if nx1 <= nx0 or ny1 <= ny0:
        return None
    return {"x": nx0, "y": ny0, "w": nx1 - nx0, "h": ny1 - ny0}


def model_point_to_original(point, transform):
    left = transform["padding"]["left"]
    top = transform["padding"]["top"]
    resized = transform["resized"]
    crop = transform["crop"]
    original = transform["original"]
    x = crop["x"] + (float(point[0]) - left) * crop["w"] / resized["width"]
    y = crop["y"] + (float(point[1]) - top) * crop["h"] / resized["height"]
    return {
        "x": min(1.0, max(0.0, x / original["width"])),
        "y": min(1.0, max(0.0, y / original["height"])),
    }


def require_isolated_runtime(modules) -> None:
    # PYTHONNOUSERSITE set inside a script is too late: startup already built
    # sys.path. Require interpreter isolation and reject dependencies imported
    # from a user/temporary overlay instead of this dedicated environment.
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
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument(
        "--save-masks",
        type=Path,
        default=None,
        help="Optional operator-owned directory receiving per-class argmax PNG masks "
        "(model raster, letterbox-suppressed). Default: no mask artifact is written.",
    )
    args = parser.parse_args()
    # Reject before importing any third-party package: otherwise a malicious
    # user-site/overlay module could execute before isolation is checked.
    if not sys.flags.isolated or not sys.flags.no_user_site:
        fail("isolated interpreter required; invoke the dedicated Python with -I -s")
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
        fail(f"approved local runtime unavailable: {exc}")

    require_isolated_runtime({"cv2": cv2, "einops": einops, "numpy": np, "PIL": sys.modules["PIL"], "timm": timm, "torch": torch, "torchvision": torchvision, "safetensors": sys.modules["safetensors"], "torchseg": torchseg})

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
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        prepared, transform = crop_and_pad(rgb, cv2, np, 1024)
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
            # See the DR probe: late inter-op changes can be rejected after
            # runtime initialization, while the process remains bounded.
            pass
        model = torchseg.create_model(arch="unet", encoder_name="seresnext50_32x4d", encoder_weights=None, in_channels=3, classes=5)
        state = load_file(str(artifact), device="cpu")
        # Hash again after the SafeTensors read to detect a hash-then-load
        # replacement in a writable research directory. Production packaging
        # must additionally make the package directory non-writable.
        if sha256_file(artifact) != EXPECTED_SHA256:
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
        # Predictions in artificial letterbox pixels are never source-image
        # evidence. Force those pixels to background before any area or region
        # is derived.
        left, top = transform["padding"]["left"], transform["padding"]["top"]
        resized_w, resized_h = transform["resized"]["width"], transform["resized"]["height"]
        content = np.zeros((1024, 1024), dtype=bool)
        content[top:top + resized_h, left:left + resized_w] = True
        labels[~content] = 0
        if args.save_masks is not None:
            mask_dir = args.save_masks
            if mask_dir.exists() and not mask_dir.is_dir():
                fail("mask output path exists and is not a directory")
            if path_contains_reparse_point(mask_dir):
                fail("symbolic-link/reparse-point mask output paths are not accepted")
            mask_dir.mkdir(parents=True, exist_ok=True)
            for mask_index, mask_class in enumerate(EXPECTED_OUTPUT_ORDER):
                mask_path = mask_dir / f"{image_id}_cls{mask_index}_{mask_class}.png"
                if mask_path.exists():
                    fail("mask output would overwrite an existing file")
                Image.fromarray(((labels == mask_index) * 255).astype(np.uint8)).save(mask_path)
        regions = []
        masks = []
        component_count = 0
        for index, class_name in enumerate(EXPECTED_OUTPUT_ORDER):
            mask = labels == index
            area = int(mask.sum())
            masks.append({"class_name": class_name, "width": 1024, "height": 1024, "mask_ref": None, "area_pixels": area})
            if index == 0 or area == 0:
                continue
            count, _, stats, centroids = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
            component_count += count - 1
            if component_count > MAX_COMPONENTS:
                fail("candidate output exceeds the bounded connected-component limit")
            for component in range(1, count):
                x, y, width, height, component_area = [int(v) for v in stats[component]]
                mapped = model_box_to_original((x, y, width, height), transform)
                if mapped is None:
                    fail("non-background component could not be mapped to source-image coordinates")
                regions.append({
                    "class_name": class_name,
                    "area_pixels": component_area,
                    "centroid": model_point_to_original((centroids[component][0] + 0.5, centroids[component][1] + 0.5), transform),
                    "bounding_box": mapped,
                    "mask_ref": None,
                    "raw_score": None,
                    "region_semantics": "UNFILTERED_ARGMAX_COMPONENT_NOT_VALIDATED_AS_LESION",
                })
        summary = "NO_TARGET_ABNORMALITY_DETECTED" if not regions else ("MULTIPLE_ABNORMALITIES" if len(regions) > 1 else "SUSPICIOUS_ABNORMALITY")
        print(json.dumps({"inference_status": "completed", "model_id": EXPECTED_MODEL_ID, "model_version": "a2cfcb594e483", "artifact_sha256": EXPECTED_SHA256, "image_id": image_id, "coordinate_space": "ORIGINAL_IMAGE_NORMALIZED", "original_image_size": transform["original"], "preprocessing_transform": transform, "raw_output_shape": [5, 1024, 1024], "output_order": EXPECTED_OUTPUT_ORDER, "preprocessing_version": "clementp-source-pinned-1024-v1", "threshold_version": "argmax-components-no-threshold-no-calibration", "validation_status": "CANDIDATE_ONLY", "thread_governance": {"intra_op": intra_threads, "inter_op": inter_threads}, "image_level_summary": summary, "class_masks": masks, "class_scores": [{"class_name": c, "score_semantics": "NOT_CALIBRATED", "score": None} for c in EXPECTED_OUTPUT_ORDER], "lesion_regions": regions, "limitations": ["CANDIDATE_ONLY; no clinical or independent validation", "Connected components are unfiltered argmax regions, not validated lesions", "Argmax masks are not calibrated probabilities", "No auditable mask artifact is persisted"]}))
    except SystemExit:
        raise
    except Exception as exc:
        fail(f"local inference failed closed: {exc}")


if __name__ == "__main__":
    main()
