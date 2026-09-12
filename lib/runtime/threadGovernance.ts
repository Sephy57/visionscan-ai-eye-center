/**
 * Centralized thread environment for short-lived research model workers.
 *
 * These variables are a cooperative runtime budget, not an operating-system
 * limit. The durable resource lease is the admission authority; this helper
 * keeps the native numerical libraries and the Python runtimes aligned with
 * the reservation that was admitted.
 */

export interface ThreadGovernanceOptions {
  readonly interOpThreads?: number;
  readonly environment?: NodeJS.ProcessEnv;
}

function boundedPositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) return fallback;
  return Math.min(64, value as number);
}

export function buildThreadGovernedEnv(
  threads: number,
  options: ThreadGovernanceOptions = {},
): NodeJS.ProcessEnv {
  const intraOpThreads = boundedPositiveInteger(threads, 1);
  const interOpThreads = boundedPositiveInteger(options.interOpThreads, 1);
  const environment = { ...(options.environment ?? process.env) };
  const values: Record<string, string> = {
    OMP_NUM_THREADS: String(intraOpThreads),
    MKL_NUM_THREADS: String(intraOpThreads),
    OPENBLAS_NUM_THREADS: String(intraOpThreads),
    NUMEXPR_NUM_THREADS: String(intraOpThreads),
    VISIONSCAN_PYTORCH_INTRA_OP_THREADS: String(intraOpThreads),
    VISIONSCAN_PYTORCH_INTER_OP_THREADS: String(interOpThreads),
    VISIONSCAN_ONNX_INTRA_OP_THREADS: String(intraOpThreads),
    VISIONSCAN_ONNX_INTER_OP_THREADS: String(interOpThreads),
  };
  return { ...environment, ...values };
}
