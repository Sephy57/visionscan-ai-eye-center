# Model Registry Persistence

Status: **IMPLEMENTED**

## The problem this fixes

The Phase 4 audit (`docs/PHASE4_AUDIT.md`, gap #1) found that an approved
model lifecycle transition mutated the in-memory `MODELS` registry object
only. The transition *decision* was durably recorded in the `transitions`
collection, but the live gate state itself reverted to the source-code
default (`DEMO`) on every process restart.

## Design

- `lib/models/registry.ts` still defines the source-controlled DEFAULT
  record for every model (id, name, modalities, findings, etc.) - that part
  was never the problem and is unchanged.
- `lib/models/registryPersistence.ts` adds a new persisted collection,
  `model_registry_state`, holding only the mutable lifecycle fields:
  `status`, `external_validation_status`, `clinical_validation_status`,
  plus `last_transition_id`, `updated_at`, `updated_by`.
- `ensureRegistryHydrated()` reads that collection and overlays it onto the
  in-memory `MODELS` objects. It is memoized (runs once per process) and is
  called at every real entry point that reads the registry before doing so:
  `runPipeline()` (the actual analysis path), `POST /api/models/[id]/transitions`,
  `GET /api/models`, `GET /api/models/[id]`, and `whyStatus()` /
  `requestStatusTransition()` in `lib/models/transitions.ts`.
- `lib/models/transitions.ts`'s `finalize()` now calls `persistModelState()`
  immediately after mutating the in-memory object on an **approved**
  transition, in the same request - the in-memory state and the persisted
  snapshot are updated together, not as two independently-fallible steps.

## Why hydration is async-and-called, not synchronous-at-import

`MODELS` is read synchronously from many call sites (`getModel()`,
`gateModelUse()`, etc.), which makes a purely synchronous file read at
module-import time tempting. That was rejected: the underlying store
(`lib/storage/db.ts`) is a single shared async JSON file used by every other
collection in the app, and duplicating a second, synchronous-read code path
just for this one collection would be an inconsistent, harder-to-reason-about
special case. Because every real caller of the registry is already inside an
`async` function (an API route handler, or `runPipeline()` awaited from
`analyzeStudy()`), calling `await ensureRegistryHydrated()` first is no
different from any other await already on those call paths, and it keeps
one single, consistent storage abstraction.

## Transition safety (unchanged, verified)

`lib/models/transitions.ts` was already evidence-gated before this phase and
is untouched in that respect:
- No ladder-skipping (`DEMO -> CLINICALLY_VALIDATED` is rejected; only
  `status -> next status` is accepted).
- Each ladder step has an explicit `TransitionRequirement`
  (`minEvidence`, `evidenceMustIncludeExternalStudy`,
  `requiresValidationDate`, `requiresCalibration`).
- Every evidence reference is resolved against the real evidence registry
  and checked to belong to the model being transitioned - a bare
  `evidence_refs: ["made-up-id"]` is rejected.
- Every request (approved or rejected) is written to the `transitions`
  collection and to the append-only audit log - a rejected request is not
  silently dropped.

New in this phase: `POST /api/models/[id]/transitions` is the first
reachable API route for this workflow (previously `requestStatusTransition`
had no route calling it at all - a gap noted in the Phase 4 audit). It is
restricted to the `ADMIN` role (`lib/auth/rbac.ts requireRole`).

## What "atomic" means here, precisely

Each individual `dbPut` to the shared JSON store is atomic in the
filesystem sense (write to a unique temp file, then `rename()`, which is
atomic on the same volume - see `lib/storage/db.ts`). Writing the
`transitions` record and the `model_registry_state` snapshot are two
sequential `dbPut` calls within one `finalize()` execution, serialized
through the same store's write queue, so they cannot interleave with a
*different* transition request's writes. This is **not** multi-document
ACID transactionality (there is no rollback if the process crashes between
the two writes) - a real database with multi-statement transactions would
be needed for that guarantee. This is disclosed here rather than implied.

## Verified behavior

- `tests/phase5b-security.test.ts` - "model registry persistence survives
  re-hydration (simulated restart)" and the transition-safety tests
  (ladder-skip rejection, unknown-model rejection, an approved transition on
  a disposable test model actually persisting).
- Manually verified: `data/database/eye-ai.json`'s `model_registry_state`
  collection is empty in the current repository state (no model has ever
  been promoted past `DEMO`) - consistent with `data/models/` remaining
  empty and no real model being installed.

## Remaining, explicitly out of scope for this phase

- A real database (e.g. SQLite, already noted as a "planned upgrade" in
  `lib/storage/db.ts`) would provide genuine multi-document transactions.
  The current JSON store's serialized-write-queue-plus-atomic-rename is
  correct for a single-process deployment but is not a substitute for that.
