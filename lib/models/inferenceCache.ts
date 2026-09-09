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
  contentHash: string;
  roiHash: string | null;
  modelId: string;
  modelVersion: string;
  preprocessingVersion: string;
  eye: string;
}): string {
  const fields = [input.scope, input.contentHash, input.modelId, input.modelVersion, input.preprocessingVersion, input.eye];
  if (fields.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    throw new Error("Inference cache key fields must be non-empty strings");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.contentHash) || (input.roiHash !== null && !/^[a-f0-9]{64}$/i.test(input.roiHash))) {
    throw new Error("Inference cache contentHash/roiHash must be SHA-256 digests");
  }
  // Reconstruct the exact allow-listed shape so runtime callers cannot add
  // undeclared data to the key contract or depend on object insertion order.
  const canonical = {
    scope: input.scope,
    contentHash: input.contentHash.toLowerCase(),
    roiHash: input.roiHash?.toLowerCase() ?? null,
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    preprocessingVersion: input.preprocessingVersion,
    eye: input.eye,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function getInferenceCache<T>(key: string): T | undefined {
  if (!/^[a-f0-9]{64}$/.test(key)) return undefined;
  const hit = entries.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.createdAt > TTL_MS) {
    entries.delete(key);
    return undefined;
  }
  // Touch the entry for simple insertion-order LRU behaviour.
  entries.delete(key);
  entries.set(key, hit);
  // Never return the stored object by reference: a caller annotating one
  // result must not poison later inference for the same immutable asset.
  return structuredClone(hit.value) as T;
}

export function setInferenceCache<T>(key: string, value: T): void {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid inference cache key");
  entries.delete(key);
  entries.set(key, { value: structuredClone(value), createdAt: Date.now() });
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
}

/** Test/diagnostic hook; no production code needs to clear the cache. */
export function clearInferenceCache(): void {
  entries.clear();
}
