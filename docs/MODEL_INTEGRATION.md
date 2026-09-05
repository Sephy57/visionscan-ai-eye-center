# Model Integration Architecture

> **STATUS: NO REAL MODEL IS INSTALLED.**
> `data/models/` is empty. Gate A (real-model installation) is **CLOSED**.
> `lib/analysis/pipeline.ts` hardcodes a single model lookup —
> `getModel("demo-fundus-synthetic-v0")` — and produces only synthetic,
> DEMO-labeled output. Every structure described below (`RawModelOutput`,
> the calibration registry, `CandidateOnlyProvider`, the manifest loader)
> is real, tested infrastructure — but none of it is wired to a live
> inference path, and none of it has ever produced a clinical finding.
> This document describes the architecture a real model would integrate
> into, not something that has happened.

## Purpose

This is the technical companion to `docs/MODEL_GOVERNANCE.md` (who must
approve a real model before it is installed) and `docs/MODEL_VALIDATION.md`
(what evidence it must have before its lifecycle status can advance). This
document covers the code-level mechanics: the pipeline stages a model's
output must pass through, the provider contract it must implement, artifact
integrity, and the concrete installation steps — none of which have been
taken this session.

## The full pipeline, ingestion to Finding

```
UPLOAD
  -> FORMAT VALIDATION (DICOM detection, lib/imaging/dicom.ts — unsupported
     formats are rejected before anything else runs)
  -> QUALITY GATE (lib/imaging/quality.ts — sharpness, illumination,
     clipping, resolution; deterministic heuristics, NOT clinically
     validated thresholds)
  -> MODEL REGISTRY GATE (lib/models/registry.ts: gateModelUse() — is this
     model's lifecycle status allowed to produce findings right now, does
     it declare the input modality, is the device compatible)
  -> OOD / COMPATIBILITY CHECK (lib/analysis/ood.ts: assessOod())
  -> classifyImageSuitability() (lib/analysis/imageSuitability.ts) — collapses
     the signals above into ONE of seven named states. Only SUITABLE may
     proceed to inference:
       SUITABLE               -> proceed
       LOW_QUALITY             -> blocked (quality_status === "fail")
       INSUFFICIENT_FOV        -> blocked (field-of-view artifact detected)
       UNSUPPORTED_MODALITY    -> blocked (model does not declare this modality)
       OUT_OF_DISTRIBUTION     -> blocked (OOD gate tripped, non-device reason)
       DEVICE_UNSUPPORTED      -> blocked (OOD reason mentions device)
       INFERENCE_UNAVAILABLE   -> blocked (no model registered/available at all)
  -> EyeModelProvider.analyzeStudy() (lib/models/provider.ts) — the one
     method allowed to run inference
  -> RAW OUTPUT CONTRACT (lib/models/outputContract.ts: RawModelOutput /
     RawFinding) — the only shape a provider's raw inference result may take
     before it is trusted further
  -> convertRawModelOutputToFindings() (lib/models/outputConversion.ts) —
     the single chokepoint that turns a validated RawModelOutput into
     pipeline-native Finding[]
  -> CALIBRATION (lib/models/calibration.ts / calibrationRegistry.ts) —
     applied ONLY if an evidence-backed CalibrationRecord exists for this
     exact model_id + model_version; otherwise raw_score is shown as raw,
     never relabeled as a probability
  -> Finding[] (lib/analysis/schema.ts)
  -> S5 EVIDENCE LAYER: evidenceFromFindings() (lib/evidence/adapters.ts),
     assembled with symptom/test-result evidence in lib/evidence/synthesize.ts
  -> clinical triage, safety validation, report/result presentation
```

`classifyImageSuitability()` is pure and adds no new detection logic of its
own — it only names the state that `assessQuality()` and `assessOod()`
already computed, so a provider makes one fail-closed decision instead of
re-deriving it from two separate result shapes (see the file's header
comment, `lib/analysis/imageSuitability.ts:1-20`). It is **not currently
called from `lib/analysis/pipeline.ts`** — the DEMO provider never inspects
distribution, so wiring it in today would change tested pipeline behavior
for no benefit. It exists as ready-to-integrate infrastructure for the day
a real provider needs it.

## The `EyeModelProvider` contract

Defined in `lib/models/provider.ts:47-56`:

```ts
export interface EyeModelProvider {
  readonly providerId: string;
  readonly modelId: string;
  loadModel(): Promise<void>;
  validateModel(): Promise<IntegrityResult & { gate: ModelGateResult }>;
  analyzeStudy(study: NormalizedStudy, ctx: ModelAnalysisContext): Promise<ModelAnalysisOutput>;
  getCapabilities(): Promise<ModelCapabilities>;
  getModelMetadata(): Promise<ModelRecord | null>;
  unloadModel(): Promise<void>;
}
```

Guarantees each method must uphold, per the file's own contract comment
(lines 6-12) and the two reference implementations:

- **`validateModel()` MUST pass before `analyzeStudy()` may be called.**
  Both reference implementations enforce this via `gateOrThrow()`
  (`lib/models/provider.ts:66-74`), which looks up the model's registry
  record and calls `gateModelUse()` — a provider cannot self-declare that
  it is validated.
- **`analyzeStudy()` returns structured `Finding[]` only.** It cannot alter
  triage, disclaimers, or safety output — those are separate, later stages.
- **A provider reports metadata from the registry**, never invents it:
  `getModelMetadata()` calls `getModel(this.modelId)` (registry lookup),
  never a locally hardcoded object.

### `PlaceholderDemoProvider` — the one working reference implementation

`lib/models/provider.ts:80-149`. Registered in `PROVIDERS` (line 153) as
the only entry; `defaultProvider()` and `getProviderForModel()` can only
ever return it. It:
- Has nothing to load (`loadModel()` is a no-op — deterministic generator).
- `validateModel()` calls the real `verifyModelIntegrity()` + `gateOrThrow()`
  paths (not a stub), which pass only because its registry record
  (`demo-fundus-synthetic-v0`) is `format: "placeholder"`, `status: "DEMO"`,
  `file_path: null` — the one case `verifyModelIntegrity()` trusts without
  an artifact on disk (`lib/models/integrity.ts:44-47`).
- `analyzeStudy()` still runs the real modality-compatibility check
  (`checkModalitySupported`) before deferring to the deterministic synthetic
  generator (`buildDemoFindings`), and tags every finding
  `taxonomy_level: "observation"`.
- Every finding note says explicitly: *"Output is synthetic (DEMO status).
  No medical model is installed."*

### `CandidateOnlyProvider` — the fail-closed reference for an uninstalled candidate

`lib/models/candidateProvider.ts`. Demonstrates that the *interface* can
host a real integration without any interface change, while guaranteeing
every method fails closed because no artifact exists:
- `loadModel()` throws `CandidateOnlyModelError`.
- `validateModel()` returns `trusted: false` and a gate with
  `allowed: false`, reason `"CANDIDATE_ONLY: not registered, not installed,
  requires explicit human authorization before any further step."`
- `analyzeStudy()` throws — it is unreachable in practice because
  `validateModel()` can never pass, but it throws anyway rather than
  relying on caller discipline.
- `getModelMetadata()` returns `null` — a candidate has no `ModelRecord`.

It is never registered in `PROVIDERS` or `MODELS`, and never imported by
`lib/analysis/pipeline.ts` (verified in this file's own header comment,
lines 8-16, and confirmed by inspection — `pipeline.ts` imports only from
`../models/registry`, not `candidateProvider`).

## Model artifact integrity

Two layers, both fail-closed:

1. **`lib/models/integrity.ts` — `verifyModelIntegrity(modelId)`.**
   `MODEL FILE -> SHA-256 -> REGISTRY -> MATCH?`. Unknown model id, missing
   artifact, a path that escapes `MODEL_ROOT`, or a checksum mismatch all
   produce `trusted: false`. The only artifact-free trust path is the
   DEMO placeholder case described above.

2. **`lib/models/package.ts` — the manifest + SHA-256 package loader.**
   A real model is installed as a directory under `MODEL_ROOT`
   (`data/models/<model_id>/`) containing `manifest.json` plus the artifact
   file. `validateManifest()` requires every field non-empty — model
   identity, artifact file/sha256/format, input modalities/dimensions/
   preprocessing/input_schema, output_schema, non-empty
   `contraindications` and `limitations`, at least one of
   `training_dataset`/`validation_dataset`, and an array (possibly empty)
   of `validation_evidence_refs`. `loadModelPackage(modelId)` then:
   - refuses if `modelId` is not already registered in `MODELS`,
   - refuses if the package path would escape `MODEL_ROOT`,
   - refuses if `manifest.json` is missing or not valid JSON,
   - refuses if the manifest fails structural validation,
   - recomputes the artifact's SHA-256 from disk and refuses on any
     mismatch against `manifest.artifact.sha256`,
   - audits every load attempt (`lib/audit`), success or rejection.

   `manifestToRecordPatch()` (`lib/models/package.ts:151-177`) converts a
   verified manifest into a `Partial<ModelRecord>` a provider could merge
   into the registry at load time — but nothing in this codebase currently
   calls it, because no provider has ever called `loadModelPackage()` for
   a real package (there is none to load).

## How a new real model would actually get installed (not done this session)

Concretely, step by step, at the code level:

1. **Register it in `MODELS`** (`lib/models/registry.ts`) with a complete,
   honest `ModelRecord` — `status` starting at `DEMO` or `RESEARCH` per
   `docs/MODEL_VALIDATION.md`'s lifecycle rules, `sha256: null` and
   `file_path: null` until step 2 is done, empty `devices`/`performance`
   until real evidence exists. `MODELS` currently has exactly one entry
   (`demo-fundus-synthetic-v0`).
2. **Provide weights under `data/models/<model_id>/`** — a `manifest.json`
   conforming to `ModelManifest` plus the artifact file, so
   `loadModelPackage()` can verify it. `data/models/` is currently empty.
3. **Implement a provider** satisfying `EyeModelProvider`, following the
   pattern in `PlaceholderDemoProvider` (call `gateOrThrow()`, respect
   `checkModalitySupported()`, call `convertRawModelOutputToFindings()`
   rather than constructing `Finding[]` by hand) and register it in
   `PROVIDERS` (`lib/models/provider.ts:152-154`).
4. **Wire it into `lib/analysis/pipeline.ts`'s model selection.**
   `pipeline.ts:74` currently reads:
   ```ts
   const modelRecord = getModel("demo-fundus-synthetic-v0"); // the only registered model
   ```
   A real integration would replace this hardcoded lookup with actual
   model-selection logic (by modality, by configured deployment model,
   etc.) and would need to call the newly registered provider's
   `analyzeStudy()` instead of directly invoking `buildDemoFindings()`
   (`pipeline.ts:94-100`, currently the only inference path the pipeline
   executes).

**None of steps 1–4 were performed this session.** `MODELS` still has one
entry, `data/models/` is still empty, `PROVIDERS` still has one entry, and
`pipeline.ts` line 74 is unchanged.

## Security considerations for loading model artifacts

- **Safe deserialization.** Public PyTorch checkpoints (`.pt`/`.pth`) can
  execute arbitrary code via unrestricted pickle deserialization. Any
  future PyTorch-format loader must use a safe-loading path (e.g.
  `torch.load(..., weights_only=True)` or an equivalent restricted
  unpickler) — never a bare, unrestricted load of a downloaded file. This
  exact risk is called out in the RETFound candidate dossier's
  `security_considerations` (`lib/models/candidateDossiers.ts:83-86`).
- **Checksum-before-load, always.** Both `verifyModelIntegrity()` and
  `loadModelPackage()` compute SHA-256 from the bytes on disk and refuse
  to proceed on any mismatch — checksum verification happens before any
  attempt to construct a runtime session from the artifact, not after.
- **No network fetch of weights at runtime.** The loader only ever reads
  from `MODEL_ROOT` on the local filesystem (with a path-escape check on
  every resolved path); nothing in `lib/models/*` performs an HTTP fetch
  of model weights. A real installation step (human-run, offline) is
  expected to place vetted files under `data/models/` before the
  application ever starts — the running application does not go get them.
- **Local-inference-only default.** The provider contract
  (`ModelAnalysisOutput`) assumes a local runtime call; nothing in this
  codebase sends images, PDFs, OCR text, or symptom data to a cloud AI API.
  Any future provider that would call an external inference service (e.g.
  `format: "remote_api"`, already present as an enum value in
  `ModelManifest.artifact.format` for exactly this future case) requires
  explicit human authorization before implementation — patient imagery and
  reported symptoms must not leave the local deployment without that
  authorization, per `docs/DATA_GOVERNANCE.md`.

## S7 update — isolated Python runtime and checkpoint acquisition status

> **This section extends, and does not replace, everything above.** All of
> it was written for the S6-era state — no Python bridge existed, and
> `lib/models/candidateProvider.ts` was the only fail-closed reference for
> an uninstalled candidate. S7 built a second, more concrete fail-closed
> reference (`lib/models/pythonBridgeProvider.ts`) and attempted, but did
> not complete, real checkpoint acquisition for the RETFound candidate. The
> bottom line has not changed: **no model artifact exists anywhere in this
> repository or on this machine as a result of this session.**
> `data/models/` remains empty, Gate A remains **CLOSED**, and nothing
> described below is reachable from `lib/analysis/pipeline.ts`.

### The isolated Python virtual environment

A project-scoped virtual environment was created at
`D:\AI EYE ANALYSIS PLATFORM\.venv-ophthalmic\` via
`python -m venv .venv-ophthalmic`, using the Windows-side Python 3.12.10
install at `C:\Users\pc\AppData\Local\Programs\Python\Python312` — not the
WSL/Linux Python, which remains PEP-668-locked (no pip, no sudo available)
and is unaffected by any of this work; that blocker still applies to WSL
specifically.

Packages were installed with:

```
pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision
pip install numpy pillow
```

The official PyTorch CPU wheel index was used deliberately — this machine's
GPU is an AMD Radeon integrated chip with no CUDA support, confirmed live
via `torch.cuda.is_available()` returning `False`. Exact pinned versions
(from `pip freeze`): `torch==2.14.0+cpu`, `torchvision==0.29.0+cpu`,
`numpy==2.5.2`, `pillow==12.3.0`, plus their transitive dependencies
(`filelock`, `fsspec`, `jinja2`, `MarkupSafe`, `mpmath`, `networkx`,
`setuptools`, `sympy`, `typing_extensions`).

A real health check passed: `import torch` succeeded, `torch.cuda
.is_available()` correctly returned `False`, and a CPU tensor matrix
multiplication (`torch.rand(3,3) @ torch.rand(3,3)`) executed and returned
the expected shape. System specs recorded during this work: 261.4 GB free
on `D:`, 15.3 GB RAM, AMD Radeon integrated GPU (no CUDA).

`.venv-ophthalmic/` (~735 MB) was added to `.gitignore` and is confirmed
never committed — it is a local, machine-specific runtime, not project
source.

### `PythonBridgeProvider` and `checkPythonInferenceEnvironment()`

`lib/models/pythonBridgeProvider.ts` is a real `EyeModelProvider`
implementation — `PythonBridgeProvider` — that spawns a local Python
subprocess (`scripts/inference/check_environment.py`, via `child_process
.spawn`) to check ML-runtime readiness. It tries the isolated venv
interpreter first (`.venv-ophthalmic/Scripts/python.exe` on Windows,
`.venv-ophthalmic/bin/python3` elsewhere), then falls back to `python3`/
`python` on PATH — a command-resolution fallback for portability only,
never a fallback that changes what "not ready" means. The probe script
imports `torch`, `torchvision`, `numpy`, and `PIL`, performs no inference,
loads no model weights, and makes no network calls; it prints one JSON
line to stdout and always exits 0, so the caller (not the exit code)
decides readiness.

This provider is never registered in `PROVIDERS` (`lib/models/
provider.ts`) or `MODELS` (`lib/models/registry.ts`), and is never
imported by `lib/analysis/pipeline.ts` — identical hard rules to
`CandidateOnlyProvider`. It demonstrates **two independent fail-closed
layers**, not one:

1. **Environment readiness** — `checkPythonInferenceEnvironment()` reports
   the actual, live state of this machine. It now reports `ready: true`
   with all four required packages available (verified by
   `tests/s7-python-bridge.test.ts`, a real integration test with no
   mocking).
2. **Artifact-installed** — even with a ready environment, `loadModel()`
   still throws: *"No installed artifact for candidate ... — dossier
   status is CANDIDATE_ONLY."* `validateModel()` returns `trusted: false`
   with three checks (`python_environment` passing, `artifact_installed`
   failing, `license_scope` failing), so `gateOrThrow()` can never pass and
   `analyzeStudy()` can never legally be reached — it throws anyway rather
   than relying on caller discipline.

In short: **a ready Python environment does not mean a model can load.**
Layer 1 turning green this session changes nothing about layer 2, which
has no artifact to check and therefore stays closed regardless.

`tests/s7-python-bridge.test.ts` also confirms no candidate is reachable
through the live model registry/provider map — `getModel()`,
`getProviderForModel()`, and `defaultProvider()` all behave exactly as
before this session.

### RETFound checkpoint acquisition status: BLOCKED (credentials/access, not license or technical)

S7 attempted to actually obtain the RETFound checkpoint referenced in
`lib/models/candidateDossiers.ts` (`retfound-mae`). The license itself was
already separately authorized in a prior decision for internal,
non-commercial research use (see that dossier's `unresolved_blockers`
comment, dated 2026-09-02) — this is **not** a licensing blocker. It is
also not a technical blocker: the isolated venv above proves the runtime
side works. What actually stopped the download:

- HuggingFace's API confirmed every RETFound repository — `natureCFP`,
  `natureOCT`, `meh`, `shanghai`, and the `dinov2` variant — is a **gated**
  repo: `https://huggingface.co/api/models/YukunZhou/RETFound_mae_natureCFP`
  (and the four sibling repos) returned `"gated": "auto"`.
- A direct HTTP HEAD request against the checkpoint file returned **401**
  with header `x-error-code: GatedRepo` and body message *"Access to model
  ... is restricted. You must have access to it and be authenticated to
  access it."*
- Gated access requires submitting a form (First Name, Last Name,
  Affiliation, Job title) on HuggingFace and being granted access by the
  repository owner. **No HuggingFace account/credentials were available
  this session to complete that request.**
- Result: **no checkpoint bytes were downloaded, no SHA-256 was computed,
  and `data/models/` remains empty.** `model_weights_integrity_hash` in
  the dossier is still `null`.

For reference (from the HF API's file listing, not from a download): the
CFP-variant repo contains `RETFound_mae_natureCFP.pth` (PyTorch pickle
format), architecture ViT-Large, ~3.68 GiB total repo storage, 224×224
input size per the reference training script.

### Safe-loading requirement, for whenever a checkpoint IS eventually obtained

The RETFound repository (`github.com/rmaphoh/RETFound`) does not document
a safe-loading procedure — it does not mention `weights_only=True`
anywhere. This is a forward-looking risk, not a current one (there is no
checkpoint on disk to load), but it must be recorded now so it isn't
skipped later: **any future load of this checkpoint must use
`torch.load(path, map_location="cpu", weights_only=True)` as the
mandatory default** — PyTorch's safe-deserialization mode, restricting
unpickling to tensor-only types. Falling back to `weights_only=False` is
permitted only with an explicit, separately-authorized risk acceptance,
never as a silent default. This is consistent with, and adds a concrete
API-level instruction to, the general safe-deserialization requirement
already in this document's "Security considerations for loading model
artifacts" section above and in the dossier's `security_considerations`
(`lib/models/candidateDossiers.ts:84`).

### Net effect

- `MODELS` still has exactly one entry (`demo-fundus-synthetic-v0`).
- `PROVIDERS` still has exactly one entry (`PlaceholderDemoProvider`).
- `data/models/` is still empty; no artifact hash exists for any candidate.
- `lib/analysis/pipeline.ts` line 74 is unchanged and still hardcodes the
  DEMO model lookup.
- The only things that are new and real: an isolated, gitignored,
  CPU-only Python/PyTorch environment on this machine, a fail-closed
  provider skeleton that can detect that environment's readiness, and a
  documented, external (HuggingFace access-grant), non-technical blocker
  standing between this session and an actual checkpoint file.

## Cross-references

- `docs/MODEL_VALIDATION.md` — evidence required before a real model's
  lifecycle status may advance past `DEMO`/`RESEARCH`.
- `docs/MODEL_GOVERNANCE.md` — who must approve installation, and why none
  of the candidate dossiers are close to that point.
- `docs/MODEL_REGISTRY.md` — the registry record shape and status ladder.
- `docs/MODEL_REGISTRY_PERSISTENCE.md` — how registry state (including any
  future transition) is persisted across restarts.
