#!/usr/bin/env python3
"""Bounded local RetGuard parity investigation.

The released RetGuard archive contains an ONNX graph and a model card, but it
does not contain the publisher's framework logits, preprocessing tensors, or
the six verification inputs. This probe therefore records what can be
reproduced safely: local environment, graph metadata, a deterministic
synthetic-input hash, and the local ONNX output. It never changes the fixed
0.001 tolerance and never fabricates a publisher-vs-local difference.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import platform
import sys


EXPECTED_SHA256 = "f0e19fa86d5a27a05731550d1d6708c01f6f363f45a1fa57849de988f91e775b"
PUBLISHER_LOGIT_MAX = 0.002526
PUBLISHER_PROBABILITY_MAX = 0.000626
DECLARED_TOLERANCE = 0.001


def fail(message: str) -> None:
    print(json.dumps({"status": "FAILED", "error": message[:500]}, sort_keys=True))
    raise SystemExit(2)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def package_version(name: str) -> str | None:
    try:
        module = __import__(name)
        return str(getattr(module, "__version__", "unknown"))
    except Exception:
        return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("model", type=Path)
    args = parser.parse_args()
    if not args.model.is_file():
        fail("RetGuard ONNX artifact is unavailable")
    artifact_sha256 = sha256_file(args.model)
    if artifact_sha256 != EXPECTED_SHA256:
        fail("RetGuard ONNX artifact SHA-256 mismatch")

    try:
        import numpy as np
        import onnxruntime as ort
    except Exception as exc:
        fail(f"Local ONNX Runtime unavailable: {exc}")

    # A deterministic input is useful for local graph reproducibility only. It
    # is not one of the publisher's six parity samples.
    synthetic = np.linspace(-1.0, 1.0, num=3 * 480 * 480, dtype=np.float32).reshape(1, 3, 480, 480)
    input_sha256 = hashlib.sha256(synthetic.tobytes(order="C")).hexdigest()
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    try:
        session = ort.InferenceSession(str(args.model), sess_options=options, providers=["CPUExecutionProvider"])
        if session.get_providers() != ["CPUExecutionProvider"]:
            fail("Non-CPU execution provider was selected")
        input_meta = session.get_inputs()[0]
        outputs = session.run(None, {input_meta.name: synthetic})
    except SystemExit:
        raise
    except Exception as exc:
        fail(f"Local graph execution failed: {exc}")

    output_meta = session.get_outputs()
    compact_outputs = []
    for meta, value in zip(output_meta, outputs):
        flattened = np.asarray(value, dtype=np.float64).reshape(-1)
        if flattened.size > 32 or not bool(np.isfinite(flattened).all()):
            fail("Local output exceeded the bounded finite-value contract")
        compact_outputs.append({
            "name": meta.name,
            "shape": list(np.asarray(value).shape),
            "values": [float(item) for item in flattened],
        })

    result = {
        "schema_version": "visionscan-phase7-retguard-parity-investigation-v1",
        "status": "UNRESOLVED_PARITY_SOURCE_OUTPUTS_UNAVAILABLE",
        "candidate_id": "retguard-dr-v1.0.0",
        "artifact": {"format": "onnx", "sha256": artifact_sha256},
        "publisher_observation": {
            "verification_samples": 6,
            "max_logit_difference": PUBLISHER_LOGIT_MAX,
            "max_probability_difference": PUBLISHER_PROBABILITY_MAX,
            "declared_logit_tolerance": DECLARED_TOLERANCE,
            "logit_parity": "FAILED",
            "probability_parity": "PASSED",
            "source": "released MODEL_CARD_dr.md; publisher framework logits and sample tensors are not in the acquired archive",
        },
        "local_environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "numpy": package_version("numpy"),
            "onnxruntime": package_version("onnxruntime"),
            "execution_providers": list(ort.get_available_providers()),
            "selected_provider": session.get_providers(),
            "opset_observation": "graph metadata inspected by ONNX Runtime",
        },
        "input": {
            "kind": "DETERMINISTIC_SYNTHETIC_NOT_PUBLISHER_SAMPLE",
            "shape": list(synthetic.shape),
            "dtype": str(synthetic.dtype),
            "sha256": input_sha256,
            "preprocessing": "No image preprocessing was applied; synthetic tensor was supplied directly to the graph.",
        },
        "graph": {
            "input_name": input_meta.name,
            "input_shape": [str(value) for value in input_meta.shape],
            "outputs": compact_outputs,
            "graph_load": "PASSED",
            "inference": "PASSED_FOR_SYNTHETIC_INPUT_ONLY",
        },
        "comparison": {
            "publisher_framework_logits": None,
            "onnx_logits": None,
            "onnx_probabilities": None,
            "absolute_differences": None,
            "reason": "The release does not contain the publisher's framework output or six input tensors; no local-vs-publisher numerical difference can be recomputed.",
        },
        "stop_rule_preserved": True,
        "final_decision": "CANDIDATE_ONLY / RIGHTS_RESTRICTED / NOT_BENCHMARK_READY",
        "phi_included": False,
        "limitations": [
            "The synthetic graph run is not publisher parity evidence.",
            "No output tuning, tolerance change, preprocessing guess, or candidate prediction was used to clear the failed gate.",
            "A legitimate resolution requires publisher framework outputs and exact six-sample input/preprocessing provenance or a corrected immutable export.",
        ],
    }
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
