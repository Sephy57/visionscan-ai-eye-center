# Model Governance — Candidate Review Process

## 2026-09-07 lesion-candidate addendum

The ClementP four-class lesion checkpoint has now been acquired under an
immutable revision and independently loaded in an isolated offline probe with
444/444 strict state-dict compatibility. This is a **candidate evidence
record**, not an approval: its SafeTensors remains under gitignored
`scratch/models/`, it is absent from `MODELS`, and the live pipeline cannot
call it. See `docs/FUNDUS_LESION_MODEL_INTEGRATION.md` for the hash, package
versions, preprocessing caveat, legal/data provenance blockers, and exact
promotion gate.

> **STATUS: ALL GATES CLOSED.** No candidate model has been approved for
> installation. `lib/models/candidateDossiers.ts` holds four researched,
> due-diligence dossiers — nothing more. None of them is registered in
> `MODELS` (`lib/models/registry.ts`), none has a `data/models/` package,
> and none has been reviewed by a human decision-maker for license,
> security, or clinical suitability. This document describes the approval
> process that would have to happen before any of that changes.

## The dossier format and where dossiers live

`lib/models/candidateDossiers.ts` defines `CandidateModelDossier` and
exports `CANDIDATE_MODEL_DOSSIERS` (currently 4 entries) plus a lookup map.
Every field the type requires:

| Field | Purpose |
|---|---|
| `candidate_id` / `model_name` / `version_or_release` / `source` | Identity and provenance |
| `license` / `license_compatible_for_commercial_clinical_use` | License text and a `boolean \| "UNKNOWN"` compatibility flag — never defaulted to `true` |
| `modality` / `intended_task` / `input_requirements` / `output_format` | What the candidate claims to do and on what input |
| `training_dataset` / `validation_dataset` / `patient_level_split_confirmed` / `external_validation_performed` | Evidence-adjacent fields, each `boolean \| "UNKNOWN"` where unverified — never guessed |
| `known_limitations` / `demographic_coverage` / `device_coverage` | Documented scope gaps |
| `preprocessing_requirements` / `inference_runtime` / `hardware_requirements` | What running it would actually require |
| `model_weights_integrity_hash` | **Always `null`** for a dossier — the type comment says why: "never populated for an uninstalled candidate" (`candidateDossiers.ts:46`) |
| `security_considerations` | Supply-chain and deserialization risk notes specific to this candidate |
| `evidence_quality` | `"none" \| "single_publication" \| "peer_reviewed" \| "prospective_multi_site"` |
| `clinical_claims` | What the source itself claims (usually: nothing clinical) |
| `unresolved_blockers` | The concrete list a human must clear — see below |
| `status` | Always the literal type `"CANDIDATE_ONLY"` |
| `sources` / `researched_at` | Citations and research date |

The file's own header states the hard rule explicitly (`candidateDossiers.ts:1-21`):
dossier entries are **never** inserted into `MODELS`, never given weights
on disk, never referenced by `lib/analysis/pipeline.ts`, and never used to
produce a `Finding`. This is a due-diligence record, structurally and
physically separate from the live model registry — a different file, a
different type, imported by nothing in the live analysis path. Populating
this file is explicitly **not** the same as clearing a model for use.

## The four example candidates and their license findings

License review is the first gate, because a license blocker makes every
other review moot:

- **RETFound** (`retfound-mae`) — `license: "CC-BY-NC-4.0 (non-commercial)"`,
  `license_compatible_for_commercial_clinical_use: false`. A hard block
  unless a separate commercial license is negotiated with the publishing
  institution. S7 separately authorized proceeding with this candidate
  scoped strictly to internal, non-commercial research use, consistent
  with this license — see `docs/MODEL_INTEGRATION.md`'s "S7 update" section
  for the isolated Python runtime that was built for that purpose and the
  (unrelated, still-open) HuggingFace gated-access blocker that stopped
  the checkpoint from actually being downloaded this session.
- **DENet** (`denet-glaucoma-refuge`) — `license: "UNKNOWN — not confirmed
  from a LICENSE file at dossier research time; must be verified before any
  further evaluation"`, compatibility flag `"UNKNOWN"`. Not a "no" — an
  open question that must be resolved (by a human contacting the
  maintainer or finding an authoritative license grant) before any other
  review step is worth spending time on.
- **APTOS 2019 community DR grading** (`aptos2019-community-dr-grading`) —
  `license: "UNKNOWN / not formally granted for redistribution... these
  are competition submission archives, not licensed software releases"`,
  compatibility flag `false`. Blocked independent of any individual
  repository's own (usually absent) `LICENSE` file, because the underlying
  Kaggle/APTOS competition terms themselves restrict commercial use and
  redistribution of the dataset — and, by extension, of weights trained
  directly on it.
- **ClementP fundus lesion segmentation**
  (`clementp-fundus-lesions-unet-seresnext50`) — the artifact is tagged MIT,
  but the publisher reports DDR, FGADR, IDRiD, MESSIDOR, and RETLES in
  training. Underlying data-use rights, patient-level independence, and
  validation evidence remain unresolved; it is recorded as a candidate only
  in `docs/FUNDUS_LESION_MODEL_INTEGRATION.md`.

## Required approvals before any candidate could move toward installation

None of the following has happened for any candidate. Each is a distinct,
required human review:

1. **License review.** Resolve every `license_compatible_for_commercial_clinical_use`
   flag to a definite `true` with a named legal basis (a specific
   agreement, or written confirmation from the rights holder) before
   proceeding — an `"UNKNOWN"` or `false` value blocks all further review.
2. **Source / artifact verification.** Confirm the canonical, maintained
   source repository (not "a class of independently trained community
   models" as the APTOS dossier itself flags,
   `candidateDossiers.ts:176`), and compute and record a real SHA-256 for
   whatever specific file would be downloaded — the dossier's
   `model_weights_integrity_hash` stays `null` until this happens, and
   nothing may be installed under `data/models/` before it does.
3. **Security review.** Every dossier's `security_considerations` array
   documents candidate-specific supply-chain risk that a human reviewer
   must actually address, not merely note:
   - RETFound: *"Public checkpoints are typically distributed as PyTorch
     .pth/.pt files — these can execute arbitrary code via pickle
     deserialization unless loaded with `weights_only=True` (or an
     equivalent safe-loading path) and the checksum is verified against a
     source the maintainer trusts."* (`candidateDossiers.ts:84`)
   - DENet: *"Provenance/maintenance status of this repository was not
     independently verified... older, single-maintainer research
     repositories carry higher supply-chain risk (unclear provenance of
     any pretrained weights offered for download)."* (`candidateDossiers.ts:126`)
   - APTOS: *"Community competition repositories are the highest
     supply-chain-risk category considered in this dossier set — no formal
     release process, no guaranteed provenance chain."* (`candidateDossiers.ts:168`)

   See `docs/MODEL_INTEGRATION.md`'s security section for the safe-loading,
   checksum-before-load, and no-runtime-network-fetch requirements any
   real loader must satisfy regardless of which candidate is involved.
4. **Clinical / regulatory review.** Confirm the candidate's own
   `clinical_claims` (none of the four claim to be validated diagnostic
   devices — all present as research/screening tools), and separately
   determine what regulatory status this platform would need to claim for
   its intended use once installed (`ModelManifest.regulatory_status` and
   `ModelRecord.regulatory_status` both exist as required fields precisely
   so this can never be left unrecorded). This review only makes sense
   after the validation requirements in `docs/MODEL_VALIDATION.md` have a
   credible plan to be met — none of the four candidates currently has
   one; see that document's worked examples for each dossier's specific
   `unresolved_blockers`.

## No code path may act without a human

This is enforced by absence, not by a runtime check — verified by
inspection of the current codebase:

- `lib/analysis/pipeline.ts` hardcodes model selection to the single DEMO
  entry (`getModel("demo-fundus-synthetic-v0")`, `pipeline.ts:74`). There is
  no code path anywhere that reads a dossier and installs it.
- `MODELS` (`lib/models/registry.ts:243-290`) has exactly one entry. No
  function in this codebase inserts a `CandidateModelDossier` into `MODELS`
  — `candidateDossiers.ts` and `registry.ts` are not connected by any
  import in either direction beyond documentation comments.
- Inserting any of the four candidates into `MODELS` was deliberately
  **not done this session** — the dossier file and the provider reference
  implementation (`CandidateOnlyProvider`, `lib/models/candidateProvider.ts`)
  were built specifically to demonstrate the pattern *without* performing
  the insertion, and `CandidateOnlyProvider` is never registered in
  `PROVIDERS` (`lib/models/provider.ts:152-154`).
- `requestStatusTransition()` (`lib/models/transitions.ts:89`) — the only
  function that can change a `ModelRecord.status` — always requires a
  `requested_by` string identifying a human actor, records it on every
  `TransitionRecord`, and audits every call. There is no automated caller
  of this function anywhere in the codebase.

## Gate status

| Gate | Scope | Status |
|---|---|---|
| Gate A | Real-model installation (weights on disk, registered in `MODELS`) | **CLOSED** |
| Gate B | Lifecycle advance `DEMO -> RESEARCH` for a real model | CLOSED (no real model exists to advance) |
| Gate C | `RESEARCH -> INTERNAL_VALIDATION` | CLOSED |
| Gate D | `INTERNAL_VALIDATION -> EXTERNALLY_VALIDATED` | CLOSED |
| Gate E | `EXTERNALLY_VALIDATED -> CLINICALLY_VALIDATED` | CLOSED |
| Gate F | Clinical deployment enablement | CLOSED |

**Opening Gate A concretely requires:**
1. An explicitly authorized human decision — a named person, not an agent
   or automated process, choosing to proceed with a specific candidate
   after the four reviews above are actually complete (not merely
   dossier-documented as needed).
2. Everything described in `docs/MODEL_INTEGRATION.md`'s installation
   steps (register in `MODELS`, provide a verified manifest+artifact under
   `data/models/`, implement and register a real `EyeModelProvider`, wire
   model selection into `pipeline.ts`) — currently none of it done.
3. A credible plan to meet `docs/MODEL_VALIDATION.md`'s evidence
   requirements before any status advances past `DEMO`/`RESEARCH` —
   currently none of the four candidates has one; see that document for
   each dossier's specific gaps.

Gates B–F cannot open before Gate A does, by construction — there is no
real model registered for a status transition to apply to.

## How to propose a new candidate

1. Add a new `CandidateModelDossier` entry to
   `CANDIDATE_MODEL_DOSSIERS` in `lib/models/candidateDossiers.ts`, filled
   in honestly — `"UNKNOWN"` rather than a guess wherever verification
   wasn't actually done, and a real `unresolved_blockers` list covering at
   minimum license, artifact integrity, and validation-evidence gaps.
2. Get it reviewed against the four approval areas above (license, source/
   artifact, security, clinical/regulatory) by the appropriate human
   reviewer(s) for this deployment.
3. **Do not write installation code — do not touch `MODELS`,
   `data/models/`, `PROVIDERS`, or `pipeline.ts`'s model selection — until
   a human has explicitly authorized proceeding.** A dossier existing, even
   a thoroughly researched one, is due diligence, not authorization.

## Cross-references

- `docs/MODEL_INTEGRATION.md` — the technical architecture and installation
  steps this document assumes.
- `docs/MODEL_VALIDATION.md` — the evidence bar for lifecycle advancement,
  with the same four dossiers used as worked "not ready" examples.
- `docs/MODEL_REGISTRY.md` / `docs/MODEL_REGISTRY_PERSISTENCE.md` — the
  live registry these candidates are deliberately excluded from.
- `docs/DATA_GOVERNANCE.md` — patient data handling constraints relevant to
  any future remote-inference candidate.
