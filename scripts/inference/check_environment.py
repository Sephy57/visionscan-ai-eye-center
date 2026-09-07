#!/usr/bin/env python3
"""
S7 - Python inference environment readiness check.

Prints ONE line of JSON to stdout and exits 0 always (the caller decides
what "not ready" means; a non-zero exit here would be ambiguous between
"environment not ready" and "this script itself is broken"). This script
performs NO inference, loads NO model weights, and makes NO network calls -
it only checks whether the packages a real inference bridge would need are
importable in this Python interpreter.

Called by lib/models/pythonBridgeProvider.ts via child_process.spawn, never
by the analysis pipeline directly.
"""
import argparse
import json
import sys

REQUIRED_PROFILES = {
    "base": ["torch", "torchvision", "numpy", "PIL"],
    "fundus-lesion": ["torch", "torchvision", "numpy", "PIL", "cv2", "safetensors", "torchseg", "timm", "einops"],
}


def check_package(name: str):
    try:
        mod = __import__(name)
        version = getattr(mod, "__version__", "unknown")
        return {"available": True, "version": version}
    except Exception as exc:  # noqa: BLE001 - deliberately broad; this is a readiness probe, not inference
        return {"available": False, "error": str(exc)[:200]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", choices=sorted(REQUIRED_PROFILES), default="base")
    args = parser.parse_args()
    isolated_required = args.profile == "fundus-lesion"
    isolated = bool(sys.flags.isolated and sys.flags.no_user_site)
    if isolated_required and not isolated:
        packages = {name: {"available": False, "error": "not imported because interpreter isolation is required"} for name in REQUIRED_PROFILES[args.profile]}
        print(json.dumps({
            "profile": args.profile,
            "python_version": sys.version,
            "packages": packages,
            "missing": list(REQUIRED_PROFILES[args.profile]),
            "isolated_interpreter": False,
            "ready": False,
            "limitations": ["fundus-lesion profile requires Python -I -s startup isolation"],
        }))
        return
    packages = {name: check_package(name) for name in REQUIRED_PROFILES[args.profile]}
    missing = [name for name, info in packages.items() if not info["available"]]
    result = {
        "profile": args.profile,
        "python_version": sys.version,
        "packages": packages,
        "missing": missing,
        "isolated_interpreter": isolated,
        "ready": len(missing) == 0 and (isolated or not isolated_required),
        "limitations": [] if not isolated_required or isolated else ["fundus-lesion profile requires Python -I -s startup isolation"],
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
