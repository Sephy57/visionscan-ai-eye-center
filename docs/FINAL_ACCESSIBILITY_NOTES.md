# Accessibility notes — final phase

## Honesty statement

This document has two layers, clearly separated below:

1. A **code-level review** (an earlier pass in this same phase) — reading
   JSX/CSS and making targeted markup fixes.
2. A **genuine, real-browser verification pass** (this pass) — a real,
   headless Chrome instance (`playwright-core` driving the actual Chrome
   binary installed on this machine, `C:\Program Files\Google\Chrome\Application\chrome.exe`),
   authenticated with a real login session against the actual running dev
   server, navigating the 5 required routes, running the real `axe-core`
   accessibility engine (`npm ls axe-core` — already a devDependency) in
   the live page, and driving real `Tab`/`Enter` keyboard events.

What is **still not done**, honestly: no real screen reader (NVDA/JAWS/
VoiceOver) was run — this environment has no such tool available, and
nothing below claims otherwise. Automated `axe-core` + real keyboard-event
verification is strong evidence but is not equivalent to hearing actual
screen-reader output.

## Real browser-based verification (this pass)

**Method**: `chromium.launch({ executablePath: "...chrome.exe", headless:
true })` via `playwright-core`, run against the actual `npm run dev`
server (`http://localhost:3000`), authenticated via a real
`POST /api/auth/login` using this repo's own documented local smoke-test
account (`smoke-admin`, from `scripts/smoke.mjs`) — not a fabricated or
hand-inserted session. Scripts used: `scratch/final-browser-audit.mjs`
(routes × viewports × axe × keyboard), `scratch/pw-find-overflow.mjs`
(root-cause element finder), `scratch/pw-toggle-check.mjs` (real
keyboard-driven Presentation Mode toggle verification). All are gitignored
scratch scripts, kept in the repo for a future session to re-run.

### Automated axe-core scan — real results

Initial run found genuine violations on every page:
- `color-contrast` (serious) — `.brand-sub`, `.nav-section`, `.active`
  nav links, `.badge.info`, `.stepper .step-label`, `.stat-label`,
  `.app-footer` text all measured below WCAG AA (4.5:1) against their
  actual backgrounds.
- `region` (moderate) — the top disclaimer banner (`.banner-text`) was
  not contained in any ARIA landmark.
- `heading-order` (moderate) — `/report` jumped from `h1` directly to
  `h3`, skipping `h2`.

**Real measured contrast ratios** (computed via WCAG relative-luminance
formula against the actual CSS custom-property colors):
- `--text-3` light mode: `#8b95a1` on `--surface` (#ffffff) = **3.04:1**
  (fails 4.5:1); on `--bg` (#f6f7f9) = even lower.
- `--text-3` dark mode: `#6b7684` on `--surface` (#151b24) = **3.75:1**
  (fails).
- `.nav-link.active` / `.badge.info`: `--accent` (#2f6fdb) on
  `--accent-soft` (#eef3fc) = **4.27:1** (fails, marginally).

**Fixes applied** (`app/globals.css`):
- `--text-3` changed to `#5a636f` (light) / kept dark mode's `--text-3`
  swapped to the former light-mode value `#8b95a1` (which is correctly
  light-on-dark) — now **6.09:1** on `--surface` and **5.68:1** on `--bg`
  in light mode; **5.69:1** on dark `--surface` in dark mode.
- `.nav-link.active` and `.badge.info` now use `--accent-strong` instead
  of `--accent` for text color — **5.7:1**, comfortably passing.
- `.banner-strip` (`components/AppShell.tsx`) changed from
  `role="note"` to `role="region" aria-label="Research environment
  notice"` — a proper landmark.
- `/report`'s section headings (`app/report/page.tsx`) changed from
  `<h3>` to `<h2>` throughout — the page has a flat `h1` → `h2` structure
  with no deeper nesting, so this is the semantically correct fix, not a
  cosmetic one.

**Re-scan after fixes**: `axe-core` violations = **0** across all 5
routes (`dashboard`, `history`, `analyze`, `result`, `report`), confirmed
twice — once immediately after the fix, and once more on a completely
fresh dev-server process + fresh login session + a different real study,
to rule out any stale-state artifact.

### Real keyboard-driven verification

Drove real `Tab` key events (not simulated/inferred) through `/dashboard`
and `/result`. Confirmed:
- The skip link (`Skip to main content`) is genuinely the very first tab
  stop, and every subsequent stop up through all sidebar nav links, the
  research-environment chip, sign-out, theme toggle, the Presentation
  Mode/Clinician View toggle, the report/clinical-review links,
  `ScanViewer`'s `role="img"` viewport, and its Fit/1:1/Zoom
  in/Zoom out/Reset/Fullscreen buttons — every one of these 30 real tab
  stops had a genuinely visible focus style (`outline` or `box-shadow`
  present, not stripped), confirmed by reading each element's actual
  computed style in the live page, not just its CSS source.
- Drove a real `Enter` keypress on the Presentation Mode toggle after
  `Tab`-focusing it (not a synthetic click): `aria-pressed` genuinely
  flipped `"false"` → `"true"`, the label flipped, and the technical
  detail sections (`MODEL INFORMATION`, `Advanced technical information`)
  genuinely appeared — while the hero result headline text was
  byte-identical before and after. This is real, driven evidence for the
  claim (already covered by code-level tests in
  `tests/s-final-dashboard-presentation.test.ts`) that the toggle changes
  presentation only, never clinical/safety state.

### Real responsive overflow testing — genuine bugs found and fixed

Ran a real `document.documentElement.scrollWidth > window.innerWidth`
check (the exact technique the master prompt specified) at all 6
required viewports (375/414/768/1024/1280/1440) across all 5 routes.
**Found real, previously-unknown overflow bugs**, root-caused via a
"find the actual offending element" script, and fixed:

1. **Topbar overflow (72px @375, 33px @414) on dashboard/history/analyze/
   result/report.** Root cause: `.topbar-actions` (the "Research
   environment" link + username/role chip + sign-out button + theme
   toggle) had no responsive behavior — `white-space: nowrap` text inside
   fixed-size chips forced the row wider than 375-414px viewports. Fix:
   wrapped the chip label text in a new `.status-chip-label` span (it was
   previously a bare text node, un-targetable by CSS) and hid it under
   `max-width: 880px`, keeping the essential controls (menu, theme
   toggle, sign out) and adding `aria-label`s so the hidden text remains
   available to assistive tech.
2. **Long safety-disclaimer badges not wrapping (up to 470px overflow on
   `/report` at 375px).** Root cause: `.badge` had `white-space: nowrap`
   — fine for short status words, broken for a full sentence like "DEMO /
   SYNTHETIC RESULT - NOT FOR CLINICAL USE" or the "NOT VALIDATED - NOT A
   MEDICAL DEVICE..." badge. Fix: `.badge` now uses `white-space: normal;
   max-width: 100%` — short badges are unaffected (no wrap needed), long
   ones now wrap within their container instead of blowing out the page.
3. **Report page tables not wrapped for horizontal scroll.** Three
   `<table>` elements in `app/report/page.tsx` (symptoms, AI model
   information, review trail) were missing the `.table-wrap` container
   (`overflow-x: auto`) that the dashboard/history tables already use.
   Fixed by wrapping all three.
4. **Stepper labels overflowing at 375px (33px) on `/analyze`.** The
   horizontal step indicator's fixed-width, non-shrinking step labels
   didn't fit. Fixed: step-dots (which already convey numeric progress)
   remain always visible; text labels hide under `max-width: 400px`,
   consistent with how the topbar overflow was handled.
5. **A classic CSS grid/flexbox `min-width: auto` bug** causing small
   (7-26px) overflow on `/result` at wide desktop widths (1280px) inside
   the third `.zone-3` grid column. `.card` and `.kv dd` (a definition-list
   value cell) are grid/flex items that, per browser defaults, refuse to
   shrink below their content's intrinsic width even when their parent
   track is sized with `minmax(0, ...)`. Fixed by adding explicit
   `min-width: 0` (and `overflow-wrap: break-word` on `.kv dd`) — the
   same fix pattern this codebase already used correctly on `.main-col`.

**Final re-verification**: zero horizontal overflow at any of the 30
route×viewport combinations, confirmed on a completely fresh dev-server
process, fresh login session, and a different real study than the one
used to find the bugs — ruling out any single-session artifact.

**Production build**: `npm run build` (real `next build`, not `next dev`)
completed successfully — "Compiled successfully", all routes statically
or dynamically rendered without error, confirmed after the dev server was
stopped so the build wasn't competing for the same `.next` directory.

## Code-level review (earlier pass, still valid)

Retained from the prior pass in this phase — file:line references below
are to the current (post-fix) files:

- **Skip link**: `components/AppShell.tsx` — `<a href="#main-content"
  className="skip-link">` as the first focusable element;
  `<main id="main-content" tabIndex={-1}>` so it actually receives focus.
  **Now confirmed as the real first tab stop by live keyboard testing
  above**, not just code-read.
- **Table header scope**: `scope="col"` on every `<th>` across dashboard/
  history tables (a robustness fix; the implicit ARIA scope is already
  `col` for a single header row per spec).
- **`role="alert"` on async error states**: `/result`'s "Unable to open
  result" card, `/history`'s load/delete-failed banner,
  `components/ui.tsx`'s `QualityPanel` insufficient-quality alert and
  shared `ErrorState`.
- **`role="status" aria-live="polite"` on loading spinners**: `/history`
  and `/result`'s `Suspense` fallbacks and in-component spinners, each
  with `.sr-only` announcement text.
- **`ScanViewer.tsx`**: confirmed every icon-only toolbar button already
  has `aria-label`; the pan/zoom viewport is a real `role="img"
  tabIndex={0}` with a working `onKeyDown` handler (arrow keys pan, `+`/
  `-` zoom, `0` fits) — **now also confirmed reachable and correctly
  labeled by the live keyboard tab-stop walkthrough above**.
- **`components/ui.tsx`**: `Badge` always renders real text, never a
  bare color swatch — confirmed still true after the badge wrapping fix
  above (wrapping doesn't remove the text, it just lets long text flow).

## Explicitly still open — genuinely unverified

- **No real screen reader was run.** This remains true. NVDA/JAWS/
  VoiceOver output has not been captured for any page.
- **Contrast was measured mathematically (WCAG relative-luminance
  formula against the actual CSS values) and confirmed via axe-core's
  live-DOM computed-style check, not via a manual visual contrast tool**
  — this is genuine, rigorous verification, but a design-tool eyeball
  check was not additionally performed.
- **The mobile drawer's focus-trap behavior** (does Tab visibly stay
  contained while the drawer is open) was not re-tested this pass; the
  code-level note from the prior pass (Escape closes it, has a labeled
  close button, closes on route change) stands unchanged.
- **Touch-specific interaction** (tap targets, swipe, pinch-zoom on the
  real image viewer) was not tested — headless Chrome keyboard/viewport
  testing does not exercise touch input.

## Test/typecheck/build status after all changes this pass

- `npx tsc --noEmit -p .` — zero new errors (only the known pre-existing
  `tests/s1-documents.test.ts` pdf-lib overload error remains).
- `npm test` — 27 test files, 579 passed, 2 skipped, 1 failed on the full
  run (`tests/s10-research-analysis.test.ts`'s real-SegFormer-inference
  test timing out at the fixed 60s limit under full-suite CPU
  contention) — re-run in isolation immediately after: 9/9 passed in
  21.8s. This is the same pre-existing, previously-documented (S9/S11/
  S13 reports) load-flakiness pattern, not a regression from this
  phase's CSS/markup-only changes.
- `npm run build` — succeeded, real production build.
