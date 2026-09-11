# Active-source lifecycle and closure policy

This policy is the canonical definition used by `scripts/data-closure.mjs`.
It is an integrity policy, not a clinical interpretation, and it does not
change `release:data-check` semantics.

## ACTIVE_REQUIRED_SOURCE

An entity is active only when a current study/patient workflow exists, the
workflow expects an original source, the entity is not explicitly deleted,
retired, superseded, or on a terminal historical path, and the source bytes
are present and hash-consistent at the canonical storage location.  A row with
`deleted_at IS NULL` alone is not enough.  An active row whose bytes are
missing is still a release blocker; it is not silently converted to legacy.

## Evidence-based classifications

The scanner emits one of the following states for an unresolved dependency:

* `ACTIVE_REQUIRED_SOURCE` — an exact, scope- and type-consistent candidate was
  observed; two-person review is still required before any copy-on-write
  recovery.
* `ACTIVE_INCOMPLETE_UPLOAD` — an explicit uploading/processing/failure state
  with no downstream workflow evidence; it remains blocked until reviewed.
* `ACTIVE_SOURCE_LOST` — source is required and unavailable, with sufficient
  lifecycle evidence to call it lost.
* `ABANDONED_PREPROCESSING_RECORD`, `ABANDONED_ANALYSIS`,
  `SYNTHETIC_TEST_RECORD`, `DELETED_USER_RECORD_RESIDUE`,
  `LEGACY_MISCLASSIFIED_ACTIVE`, `EXTERNAL_SOURCE_NOT_IMPORTED` — only when
  persisted evidence proves the corresponding state.
* `DERIVATIVE_WITHOUT_REQUIRED_PARENT` — an analysis or other derivative has a
  missing parent; a derivative is never promoted to an original source.
* `UNKNOWN_REQUIRES_REVIEW` — evidence is incomplete or contradictory.  This
  is the conservative state used for the current 233 missing study originals;
  it remains blocked and `UNREVIEWED`.

## Retirement

Retirement is administrative and normally non-destructive.  A future apply
workflow may use `RETIRED_INCOMPLETE_UPLOAD`, `RETIRED_SYNTHETIC_TEST_RECORD`,
`RETIRED_DELETED_ENTITY_RESIDUE`, or `RETIRED_LEGACY_UNREPLAYABLE` only after
an independent reviewer confirms: no active finalized assessment, report,
longitudinal chain, or analysis depends on the entity; no legal hold applies;
tenant/patient scope is known; and the audit history supports the transition.
The original state, evidence, reviewer, timestamp, source availability, and
dependency counts must be retained.  Retirement is never permitted merely to
reduce a release count.

## Recovery and reasoning

Recovery requires an expected SHA-256, an exact byte match, compatible asset
type, exact tenant/patient scope, and provenance supporting the relationship.
Filename or timestamp matches are not evidence.  Quarantine and verified
backup candidates are inspected in isolation; recovery is staged and
copy-on-write, then atomically published only after two-person review and an
immutable audit event.  Thumbnails, OCR, ROI crops, masks, page renders, and
AI output remain derivatives and cannot satisfy the source requirement.

When original bytes are unavailable, replay is explicitly
`SOURCE_UNAVAILABLE_FOR_REPLAY` and the entity is excluded from new reasoning
runs as verified source evidence.  Historical finalized reports remain
immutable and may be retained with that replay limitation.

## Current decision

The current run found 233 unresolved active study-source rows and two active
analyses whose required study parent is absent.  No exact, scope-consistent
recovery was proven; no retirement was justified.  All 235 remain blocked and
`UNREVIEWED`.

The clinical boundary is unchanged:

```text
NOT CLINICALLY VALIDATED
NOT A MEDICAL DEVICE
NOT FOR AUTONOMOUS DIAGNOSIS
```
