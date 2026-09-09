import { createHash } from "crypto";

/**
 * Small process-local cache for successful, immutable model outputs. It is
 * intentionally not persisted: a restart clears all entries and no patient
 * bytes/results are written to disk by this layer. Keys include the study
 * scope, source hash, model revision, and preprocessing contract so a result
 * cannot be reused across patients, artifacts, or model upgrades.
 */
const MAX_ENTRIES = 32;
const TTL_MS = 15 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  createdAt: number;
}

const entries = new Map<string, CacheEntry<unknown>>();

export function inferenceCacheKey(input: {
  scope: string;
  sourceHash: string;
  modelId: string;
  modelVersion: string;
  preprocessingVersion: string;
  eye: string;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function getInferenceCache<T>(key: string): T | undefined {
  const hit = entries.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.createdAt > TTL_MS) {
    entries.delete(key);
    return undefined;
  }
  // Touch the entry for simple insertion-order LRU behaviour.
  entries.delete(key);
  entries.set(key, hit);
  return hit.value as T;
}

export function setInferenceCache<T>(key: string, value: T): void {
  entries.delete(key);
  entries.set(key, { value, createdAt: Date.now() });
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
}

/** Test/diagnostic hook; no production code needs to clear the cache. */
export function clearInferenceCache(): void {
  entries.clear();
}
