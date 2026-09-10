# Python bridge release policy

Status for the current local research release: **OPTIONAL_NOT_RELEASE_BLOCKING**.

The generic `PythonBridgeProvider` in `lib/models/pythonBridgeProvider.ts` is
candidate-only reference infrastructure. It is not present in the live
`PROVIDERS` map, is not present in `MODELS`, is not imported by the clinical
pipeline, and cannot produce findings. Its environment probe therefore stays
explicitly opt-in (`VISIONSCAN_RUN_LIVE_PYTHON=1`). A clean checkout or the
DEMO workflow must not fail readiness merely because `torch` or `torchvision`
is absent.

The model-specific research providers (`FundusLesionLocalProvider`,
`DrGradeLocalProvider`, and `OctLocalProvider`) are a separate, explicitly
installed research path. When their local artifacts and reviewed runtime are
present, they use their own provider contracts and bounded subprocesses; when
they are absent, model analysis fails closed or is skipped according to the
documented model-test contract. Their optional research runtime must not be
confused with the generic candidate bridge.

Evidence for the boundary:

- `defaultProvider()` remains the deterministic `demo-fundus-synthetic-v0`
  provider.
- `getProviderForModel()` returns `null` for generic candidate dossiers; no
  candidate is reachable through the live registry.
- `tests/s7-python-bridge.test.ts` only runs the real interpreter probe when
  `VISIONSCAN_RUN_LIVE_PYTHON=1`; default clean-checkout runs preserve the
  structured fail-closed/skip contract.
- The current host's opt-in probe reports missing `torch`/`torchvision`.
  That is an environment readiness result for optional candidate work, not a
  production startup failure.

No package installation is prescribed solely to turn this optional status
green. If a future release explicitly promotes a Python bridge to a required
runtime component, that change must add a pinned CPU-only requirements lock,
installation verification, artifact integrity evidence, and a separate
release decision before changing this classification.

## CI browser boundary

`.github/workflows/ci.yml` includes `verify-browser`, a lightweight hosted
smoke job. It starts an isolated local server and SQLite database, bootstraps a
synthetic local admin account, and checks login plus dashboard, patients,
analyze, result, and report rendering, navigation, HTTP status, landmarks,
language, duplicate IDs, skip-link presence, and fatal browser errors. It does
not use real credentials, patient bytes, model weights, or external providers.
The larger local browser gates (`browser:responsive`, `browser:a11y`,
`browser:keyboard`, and `browser:asset-e2e`) remain separate and are not
replaced by this hosted smoke job.
