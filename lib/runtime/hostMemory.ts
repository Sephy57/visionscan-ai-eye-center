import os from "node:os";

/**
 * Best-effort host observation. This is deliberately not an enforcement
 * mechanism: an operating system can reclaim memory or start unrelated work
 * after the observation. Resource admission must still use durable leases.
 */
export interface HostMemoryObservation {
  readonly platform: NodeJS.Platform;
  readonly totalBytes: number | null;
  readonly availableBytes: number | null;
  readonly source: "node_os_freemem" | "unavailable" | "test_injected";
  readonly enforcement: "observation_only";
}

export function observeHostMemory(): HostMemoryObservation {
  try {
    const total = os.totalmem();
    const available = os.freemem();
    return {
      platform: process.platform,
      totalBytes: Number.isSafeInteger(total) && total > 0 ? total : null,
      availableBytes: Number.isSafeInteger(available) && available >= 0 ? available : null,
      source: "node_os_freemem",
      enforcement: "observation_only",
    };
  } catch {
    return {
      platform: process.platform,
      totalBytes: null,
      availableBytes: null,
      source: "unavailable",
      enforcement: "observation_only",
    };
  }
}
