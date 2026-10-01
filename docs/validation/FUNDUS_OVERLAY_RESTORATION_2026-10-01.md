# Fundus research-overlay restoration — evidence record (2026-10-01)

Scope: the report that the fundus analysis area shows nothing where earlier builds
drew research localizations (hemorrhage, hard exudate, microaneurysm-like).
Base: `origin/main` 3d64677. Nothing here changes model weights, thresholds,
calibration or clinical behaviour. Localizations are research signals, not
diagnoses, and no region, score or label is created anywhere in this change.

## What was verified end to end (real model, real upload, real persistence)

Run from this branch against the registered local provider
(`fundus-lesions-clementp-unet-seresnext50`, version `a2cfcb594e483`, artifact
SHA-256 `a7a7cb45…c6d2`, verified on disk and re-verified by the pipeline),
with all writable data redirected to a scratch directory.

| Fixture | Model regions | Persisted | API | Rendered |
|---|---|---|---|---|
| `example_fundus.jpg` (repo-documented example) | 1 `microaneurysm_like_lesion` | 1 | 1 | 1 |
| synthetic fundus-like raster (not a retina) | 3 `retinal_hemorrhage` | 3 | 3 | 3 |

Rendered box positions match `img.rect + normalized × size` within 1.25 px at
320, 375, 390, 414, 768, 1024, 1280, 1440 and 1920 px, in dark and light themes,
after zoom, and after a window resize.

Cold analysis took 76 s on the first call (model load) and about 12 s warm.
These are single measurements on one machine, not a benchmark.

## Where the information disappeared

On committed code, nothing between model output, persistence, the API and the
viewer props drops a valid localization (`git diff 261f6b7 3d64677 -- lib`
touches only `sourceAvailability.ts`, `jobs/queue.ts` and `storage/db.ts`). No
single regressing commit was found. Four separate defects produced a
"blank-looking" analysis area:

1. **A true-size region can be invisible.** The real microaneurysm-like region
   is 0.47 % × 0.37 % of the image: about 7 × 6 px on the 1634 px original and
   about 2 px on screen. It was drawn faithfully as a 2 px box with its label
   floating beside nothing. The pre-modernization CSS had no minimum size
   either, so this is long-standing, not a modernization regression.
2. **No model package on the host.** Without `data/models/<id>` and
   `.venv-ophthalmic` under `PROJECT_ROOT`/`MODEL_ROOT` (both gitignored, so a
   fresh clone or worktree has neither), the lesion model is skipped, the
   pipeline records `research package/runtime unavailable on this deployment`,
   falls back to the labelled DEMO path, and the viewer showed only a generic
   muted line.
3. **Viewer state bugs.** The view mode was fixed at mount, so "View on scan"
   could select a region while the viewer sat in Original and drew nothing; the
   Overlay button could be "pressed" and disabled at once; window resize reset
   the user's zoom and pan; the image was lazy-loaded, which held every overlay
   back until the viewer scrolled into view.
4. **Colliding finding ids.** Every provider numbered its findings from 0 under
   `rf_<study>_<i>`, so a lesion finding and the DR-grade finding shared an id.
   React keyed the finding list on it, and `lib/clinical/reviewEvents.ts`
   resolves a finding's model with `.find()` on it.

Environment note: the checked-in `better-sqlite3` binary is built for Node 20
(ABI 115). Under Node 24 every database-backed API answers 500, which also
looks like an empty result page. Run the app with Node 20.

## What changed

- `ScanViewer`: derived view mode remembered per selection (re-requesting the
  same region works); refit on image load; resize no longer resets zoom/pan;
  eager primary image; locator ring for regions under 14 px on screen while the
  dashed true box stays; labels counter-scaled by zoom and placed on the side
  with room; the single highlighted region is drawn through the same path as
  localizations and discloses a missing validation status; `aria-disabled`
  controls stay focusable and point at their reason; the caption below the
  viewer states what ran, with model, version, status, quality and
  distribution.
- Explicit states (`lib/imaging/viewerAnalysisState.ts`): signals found, no
  localized signals, model unavailable, model failed, quality insufficient, out
  of distribution, insufficient evidence, unsupported modality, analysis not
  run. Each derives from stored fields, never message text, and none reads as
  normal. The clinician page and `ResearchAnalysisPanel` no longer render blank
  panels; two backend states the panel had no copy for now have it.
- `lib/models/fundusAbnormality.ts`: findings that cannot be placed on the
  image (invalid geometry, or no box) no longer become
  `NO_TARGET_ABNORMALITY_DETECTED`; with none usable the result is the existing
  fail-closed model-unavailable state with the model recorded, with some usable
  the rest is disclosed. Rounding noise up to 1e-4 is clipped, the same
  tolerance `outputContract.ts` applies. `tests/fundus-abnormality.test.ts`
  changed accordingly: an out-of-bounds box now yields `MODEL_UNAVAILABLE`.
- `lib/models/outputConversion.ts`: finding ids include the model id.
- Result and clinician pages: one stored region is counted and drawn once, and
  localized signals are listed apart from image-level model estimates.

## How to re-run the gates

```
BASE_URL=http://localhost:3100 npm run browser:viewer-overlay
```

Needs a running server and Chrome. Set `VIEWER_QA_FIXTURE` to an approved
fundus image to reconcile a specific image; set `OUT_DIR` for screenshots. In a
production build, the documented `ALLOW_INSECURE_LOCAL_AUTH=true` is required
for plain-HTTP loopback login. Regions injected by the script are labelled
`synthetic-qa` and are viewer test geometry, never model output.

## Not established by this work

- **Diagnostic accuracy: not established.** The lesion model is a research
  candidate whose region semantics are `UNFILTERED_ARGMAX_COMPONENT_NOT_VALIDATED_AS_LESION`
  with no calibrated score. Nothing here measures sensitivity or specificity.
- Per-condition validation, false-negative analysis and the condition capability
  registry are the Phase 4 evaluation workstream (kept separate, untouched).
- No treatment or medication content is produced or changed.
