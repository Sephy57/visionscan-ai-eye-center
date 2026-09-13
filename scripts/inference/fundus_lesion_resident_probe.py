#!/usr/bin/env python3
"""Finite resident-model experiment for the pinned lesion checkpoint.

This deliberately lives outside the normal provider path. It loads the same
SafeTensors artifact once, processes a bounded manifest serially, emits only
aggregate-compatible per-index results, and reports progress on stderr so the
Node harness can sample memory at checkpoints. It is not a production worker.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fundus_lesion_batch_probe import (  # noqa: E402
    EXPECTED_MODEL_ID,
    EXPECTED_SHA256,
    fatal,
    image_summary,
    path_contains_reparse_point,
    read_manifest,
    require_isolated_runtime,
    sha256_file,
)


MAX_RESIDENT_ITEMS = 20


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
    paths = read_manifest(args.manifest)
    if len(paths) > MAX_RESIDENT_ITEMS:
        fatal("resident experiment is bounded to 20 entries")

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

    artifact_path = args.model_dir / "model.safetensors"
    if path_contains_reparse_point(artifact_path):
        fatal("symbolic-link/reparse-point model artifact is not accepted")
    artifact_sha256 = sha256_file(artifact_path)
    if artifact_sha256 != EXPECTED_SHA256:
        fatal("model SHA-256 mismatch")
    intra_threads = max(1, min(int(args.threads), 16))
    inter_threads = 1
    torch.set_num_threads(intra_threads)
    try:
        torch.set_num_interop_threads(inter_threads)
    except RuntimeError:
        pass

    load_started = time.perf_counter()
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
    load_ms = round((time.perf_counter() - load_started) * 1000, 3)

    results = []
    for index, image_path in enumerate(paths):
        item = image_summary(index, image_path, cv2, np, Image, torch, model, artifact_sha256, intra_threads)
        results.append(item)
        print(json.dumps({"resident_progress": {"completed": index + 1, "status": item.get("inference_status")}}), file=sys.stderr, flush=True)

    print(json.dumps({
        "batch_status": "complete",
        "output_contract": "fundus-lesion-segmentation-resident-summary/1",
        "model_id": EXPECTED_MODEL_ID,
        "artifact_sha256": artifact_sha256,
        "serial": True,
        "count": len(results),
        "resident_load_ms": load_ms,
        "thread_governance": {"intra_op": intra_threads, "inter_op": inter_threads},
        "results": results,
    }))


if __name__ == "__main__":
    main()
