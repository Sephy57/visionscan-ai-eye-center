# S9 Model Performance Benchmark

`npm run model:performance` is a bounded, local engineering benchmark for the
existing gitignored `segformer-optic-disc-cup-refuge` research artifact. It
does not download model files, change the provider, enable the model in the
live pipeline, or make a clinical performance or latency claim.

The default run performs three direct cold Python probe subprocesses and three
sequential calls through `runSegformerResearchInference()`. Set
`MODEL_PERF_COLD_RUNS` and `MODEL_PERF_WARM_RUNS` to a value from 1 through 5
for a smaller or repeated sample. `MODEL_PERF_TIMEOUT_MS` bounds each cold
probe and the warm provider process (with a bounded multiple for multiple warm
calls).

The JSON report includes p50, p95, minimum, and maximum wall-clock timings,
plus the probe-reported import/model-load/inference timings for cold runs. The
current provider creates a fresh Python subprocess for every call; therefore
“warm” means later calls after filesystem/module startup warm-up, not a
persistent in-process model. Peak child RSS is reported as unavailable because
the existing probe does not expose it and platform-specific sampling could
perturb the benchmark.

On a checkout without the pinned runtime, S9 artifact, or test image, the
command prints `status: "MODEL_UNAVAILABLE"`, `skipped: true`, and exits 0.
An artifact hash mismatch prints `status: "MODEL_INVALID"` and exits 1.

All measurements are reproducibility evidence for engineering diagnosis only.
The S9 model remains research-only, unvalidated, and unavailable to the live
clinical pipeline.
