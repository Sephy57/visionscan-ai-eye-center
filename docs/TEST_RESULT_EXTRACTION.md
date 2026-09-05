# Structured Test-Result Extraction (S3)

> **Status: S3 IMPLEMENTED — deterministic rules-based extraction of ophthalmic test values
> from S2 text/OCR artifacts, with strict ambiguity preservation.**
> **Every result is AUTO_EXTRACTED / UNREVIEWED. NOTHING in this layer reaches triage,
> diagnosis, treatment, or the analysis pipeline — there is no code path connecting them.**
> Reference: OCR artifact (`data\documents\extracted\<id>.json`) → parser →
> `test_results` collection → clinician verification (server core here, UI in S4).

## The one rule that defines S3

**Ambiguity is preserved, never resolved.**

```
Document text:  "IOP OS 2l mmHg"        (OCR misread of "21")
System output:  value_raw: "2l"
                value: undefined
                ambiguity_flags: ["unparseable_value"]
                verification.status: "AUTO_EXTRACTED"
```

The system does NOT "helpfully" interpret `2l` as `21`. There is no LLM anywhere in this
layer. A clinician must look at the source and correct it (S4), and the raw value plus
source snippet stay visible forever.

## Extraction rules

### Test types (controlled vocabulary)

`IOP`, `VISUAL_ACUITY`, `CENTRAL_SUBFIELD_THICKNESS`, `CUP_TO_DISC_RATIO` — each with
deterministic regex grammars over the page text. Anything not matching a grammar is
simply not extracted (no hallucinated results — mandate §69).

### Values — strict numeric grammar

- Accepted: `21`, `0.4`, `289` (`/^\d+(\.\d+)?$/`).
- `2l`, `O.4`, `1O` → **`unparseable_value`** flag, `value` stays undefined.
- `2,1` (comma) → **`ambiguous_value`** flag (decimal vs separator) — never guessed.
- No unit token → **`missing_unit`** flag — mmHg is NEVER assumed.

### Units — registry-based, conversion only when deterministic

| Raw unit | Canonical | Conversion |
|---|---|---|
| mmHg, mm Hg | mmHg | none (reference) |
| kPa | kPa | → mmHg × 7.5006168307 (`1 kPa = 7.5006168307 mmHg`), recorded in `conversion` |
| µm / μm / um / micron(s) | um | none (reference) |
| mm | mm | → um × 1000 (SI), recorded in `conversion` |
| Snellen (20/20, 6/6) | snellen | **never converted** across scales — `unconvertible_scale` |
| logMAR | logMAR | **never converted** — `unconvertible_scale` |
| anything else | — | **`unknown_unit`** flag; no conversion, no guessing |

The ORIGINAL value and unit are always preserved beside the normalized pair.

### Reference ranges — never invented

Attached ONLY when found in the source text (patterns: `normal`, `reference (range)`,
`NR` followed by `low – high`), with `source: "document_text"`, the raw string, and page.
Otherwise the field is absent (= UNKNOWN). No hardcoded clinical ranges exist anywhere
in this layer.

### Laterality — explicit tokens only

`OD` / `OS` / `OU` are accepted as whole-word tokens in the source snippet. Missing →
`UNKNOWN` + `missing_laterality`. Multiple distinct tokens in one snippet →
`contradictory_laterality`. `OU` is kept as `OU` — never merged into a single eye.
Lowercase/inferred/positional inference is deliberately not accepted.

### Dates

ISO `YYYY-MM-DD` accepted as `timestamp`. Loose formats (`2026.03.04`, `2026/3/4`) are
kept as `date_raw` only + `ambiguous_date` (day/month order ambiguity is not resolved).

### Conflicts — surfaced, never chosen

Results with the same `test_type + laterality` but distinct parsed values are cross-
referenced in each record's `conflicts` array. The system never picks a winner —
that is the clinician's job (and S5 synthesizes cross-source conflicts).

## Provenance chain (mandate §20)

```
Study → Document (sha256) → Page → source_text snippet → value_raw → structured fields
```

Every record carries `document_id`, `page`, `source_text` (the exact text window the
value came from), `extraction_method` (text_layer | ocr), and `extraction_confidence`
(OCR page confidence where available).

## Verification states (mandate §21)

| Status | Meaning |
|---|---|
| `AUTO_EXTRACTED` | machine output, never seen by a human (initial state of everything) |
| `UNREVIEWED` | queued for human review |
| `VERIFIED` | a clinician confirmed the extracted value as correct |
| `CORRECTED` | a clinician corrected the value — stored in `correction` (by/at/note); **the original extraction is never overwritten** |
| `REJECTED` | a clinician rejected the extraction |

Server core: `POST /api/results/[resultId]/verify` with `{action, note?, correction?}` —
roles ADMIN/CLINICIAN/REVIEWER; every action appended to `verification_history` and
audited. Re-verification of a REJECTED result is refused (fail-closed; use a correction).
The full clinician review UI is S4.

## Collection & lifecycle

- `test_results` collection (JSON store, atomic writes) — one record per extracted value.
- Re-extraction supersedes: old results for a document are deleted when a new extraction
  starts (stale results can never outlive their artifact).
- Study deletion cascades to documents and their test results.
- Audit: `document.results_generated`, `test_result.verified/corrected/rejected/
  returned_to_review` — metadata only.

## Hard boundaries (verified by tests)

1. No LLM/ML in this layer — regex + lookup tables only.
2. No hardcoded reference ranges, units, or conversions beyond the documented table.
3. No path from `test_results` to `AnalysisResult`, triage, reports, or treatment —
   tests assert the analysis output contains no trace of extracted values.
4. All results remain `AUTO_EXTRACTED` until a human acts.
