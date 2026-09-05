/**
 * Model registry state persistence (Phase 5B, Priority 1).
 *
 * Fixes the Phase 4 audit finding: "an approved status transition mutates
 * an in-memory object only; it does not survive a process restart."
 *
 * Design: the base MODELS record (lib/models/registry.ts) stays the
 * source-controlled DEFAULT for each model. On top of that, this module
 * persists the CURRENT lifecycle state (status + validation flags) to the
 * durable JSON store and re-applies it to the in-memory MODELS objects at
 * process start, before any registry read. Every registry read in this
 * codebase goes through an async function already (getModel/gateModelUse
 * are called from async pipeline/API code), so hydration is done once,
 * memoized, and awaited at each real entry point rather than relying on
 * unsafe synchronous file I/O at module import time.
 *
 * Full transition history (who/when/why/evidence) is already durably
 * recorded in the "transitions" collection (lib/models/transitions.ts) -
 * this module only needs to persist the CURRENT snapshot for fast, correct
 * hydration; the transitions collection remains the audit trail of record.
 */

import { dbAll, dbPut } from "../storage/db";
import { MODELS, ModelStatus } from "./registry";

export interface PersistedModelState {
  model_id: string;
  status: ModelStatus;
  external_validation_status: "none" | "in_progress" | "completed";
  clinical_validation_status: "none" | "in_progress" | "completed";
  last_transition_id: string | null;
  updated_at: string;
  updated_by: string;
}

let hydrated = false;
let hydrating: Promise<void> | null = null;

/**
 * Apply any persisted lifecycle state on top of the source-controlled
 * defaults. Idempotent and safe to call from every entry point that reads
 * the registry - the actual hydration work runs exactly once per process.
 */
export async function ensureRegistryHydrated(): Promise<void> {
  if (hydrated) return;
  if (hydrating) return hydrating;
  hydrating = (async () => {
    const states = await dbAll<PersistedModelState>("model_registry_state");
    for (const s of states) {
      const model = MODELS[s.model_id];
      if (!model) continue; // persisted state for a model no longer in the source registry - ignore, never crash
      model.status = s.status;
      model.external_validation_status = s.external_validation_status;
      model.clinical_validation_status = s.clinical_validation_status;
    }
    hydrated = true;
  })();
  try {
    await hydrating;
  } finally {
    hydrating = null;
  }
}

/** Durably persist the current lifecycle state for a model after an approved transition. */
export async function persistModelState(params: {
  model_id: string;
  status: ModelStatus;
  external_validation_status: PersistedModelState["external_validation_status"];
  clinical_validation_status: PersistedModelState["clinical_validation_status"];
  last_transition_id: string;
  updated_by: string;
}): Promise<void> {
  const rec: PersistedModelState = { ...params, updated_at: new Date().toISOString() };
  await dbPut("model_registry_state", params.model_id, rec);
}

/** Test-only: reset hydration memoization so tests can exercise hydration repeatedly. */
export function _resetHydrationForTests(): void {
  hydrated = false;
  hydrating = null;
}
