# VisionScan Phase 3 — Local Performance and Worker Report

**Observed:** 2026-09-12 on the Windows CPU-only development host.  
**Scope:** model subprocess timing, process-tree memory sampling, queue/worker architecture, crash recovery, and performance evidence limits.  
**Disposition:** research benchmark evidence only; no throughput, capacity, or service-level guarantee is claimed.

## Model timing baseline

The historical three-run bounded model benchmark recorded the following fresh-process values. “Warm” means a later fresh probe after filesystem/interpreter warm-up, not a resident model server.

| Model | Cold p50 / p95 (ms) | Warm p50 / p95 (ms) |
|---|---:|---:|
| Fundus lesion | 8,601.1 / 9,374.8 | 8,550.5 / 8,978.9 |
| DR grade | 5,313.2 / 5,354.3 | 5,326.2 / 5,389.3 |
| OCT retinal | 3,130.1 / 4,161.0 | 3,118.6 / 3,138.4 |
| Isolated SegFormer | 9,959.1 / 16,307.5 | 9,751.3 / 10,164.2 |

Historical sampled process-tree peak working sets were:

| Model | Cold | Warm |
|---|---:|---:|
| Fundus lesion | 1,340,567,552 bytes | 1,393,590,272 bytes |
| DR grade | 441,774,080 bytes | 441,843,712 bytes |
| OCT retinal | 1,069,690,880 bytes | 1,069,977,600 bytes |
| Isolated SegFormer | 1,235,030,016 bytes | 1,244,504,064 bytes |

These samples show that lesion and SegFormer probes are materially heavier than DR on this host. The benchmark samples Windows working set and process-tree CPU, not a portable resident-set high-water mark or production utilization percentage.

## Bounded diagnostic result

A fresh one-run diagnostic used `MODEL_BENCHMARK_RUNS=1`, a 30-second timeout, and 500 ms sampling. The command exited 0 with status `RESEARCH_BENCHMARK_ONLY`, but three of four probes were partial/time-limited:

| Model | Cold | Warm | Interpretation |
|---|---|---|---|
| Fundus lesion | timed out at ~30.15 s | timed out at ~30.13 s | no successful latency measurement in this run |
| DR grade | timed out at ~30.12 s | completed ~8.93 s | partial run; not comparable to historical three-run baseline |
| OCT retinal | completed ~9.63 s | completed ~3.19 s | one bounded observation |
| SegFormer | timed out at ~30.13 s | completed ~18.00 s | partial run; not a capacity result |

The diagnostic used the benchmark’s `scratch/models` path, while the registered providers use configured local model packages under `data/models`. The two result sets must not be silently merged. A successful process exit from the benchmark is not itself a green performance gate when the JSON status is partial.

## Queue and worker architecture

The durable queue records created, claimed, started, and completed timestamps and uses a lease/heartbeat/retry state machine. Defaults observed in the worker code are a 15-minute lease, 30-second heartbeat, 60-second recovery grace, exponential retry backoff, and a maximum of three attempts. A separate `scripts/worker.ts` process can recover stale work during polling. Lease ownership and fencing tests pass.

The current worker executes one job per worker pass (`maxJobs` is clamped to 1). In-process dispatch is fire-and-forget, and provider mutexes are process-local. Multiple worker processes can therefore launch multiple heavy model subprocesses without a host-wide memory governor. PyTorch fundus probes request four threads, but inter-op, OpenMP/MKL, ONNX Runtime, and SegFormer thread budgets are not uniformly pinned.

## Missing performance measurements

The repository does not yet have defensible measurements for queue wait, claim-to-start time, service duration histograms, jobs/second, backlog age, fairness, worker startup, resident model warm time, host CPU utilization, cross-process memory pressure, or concurrent-worker behavior. `peak_rss_bytes` is Windows working set sampled periodically, not a portable RSS guarantee.

The crash suite demonstrates a temporary child process that claims a job and exits, followed by stale recovery/reclaim. It does not yet kill the real worker at provider execution, persistence, report finalization, heartbeat, OOM, DB-lock, or process-tree boundaries, and no orphan-child assertion is established. Provider subprocess timeouts do not yet prove complete Windows process-tree termination, and `processJob()` has no demonstrated overall job deadline.

## Safe next engineering gates

Before any service or multi-worker claim, add:

- per-attempt queue-wait, claim, start, finish, and retry metrics;
- a host-wide memory/concurrency budget and explicit effective thread settings;
- centralized Windows process-tree termination and a queue-level deadline;
- real-worker crash-matrix tests at every durable transition;
- measured worker throughput/capacity with model hash, process count, CPU, working set, private bytes, and settings;
- heartbeat/recovery counters and bounded graceful shutdown;
- a separate worker benchmark whose partial results return nonzero.

## Classification

**Local performance:** `PARTIAL — SOFTWARE BENCHMARK EVIDENCE ONLY`.

The measurements are adequate to expose local resource risk and inform future engineering work. They are not evidence of production capacity, low latency, safe concurrent operation, or clinical utility.
