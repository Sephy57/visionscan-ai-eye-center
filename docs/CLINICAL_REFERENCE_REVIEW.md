# Clinical reference review (non-autonomous rule support)

Accessed 2026-09-06. These references were reviewed to check that the
extraction vocabulary, missing-evidence prompts, and independent urgency
signals reflect recognizable ophthalmic review questions. They are not a
clinical guideline engine, do not validate a model, and do not authorize an
autonomous diagnosis or treatment recommendation.

| Reference | Rule/architecture point supported | Deliberate limitation |
| --- | --- | --- |
| [AAO EyeWiki — Retinal Detachment](https://eyewiki.aao.org/Retinal_Detachment) | New flashes/floaters, curtain or shadow, acute visual-field/central-vision change, prior trauma/surgery, and examination/testing context are appropriate evidence fields to preserve and route for clinician review. | The implementation records these as source evidence and triage/routing signals; it does not encode a retinal-detachment diagnosis, probability, or treatment rule. |
| [AAO patient handout — Floaters and Flashes](https://store.aao.org/media/resources/PEHANDOUTS/PEHANDOUTS-Floaters-Flashes-rf3.pdf) | Sudden flashes/floaters plus a curtain or visual change justify an independent prompt for immediate ophthalmic attention. | The application does not determine whether a tear or detachment is present; the signal remains a non-diagnostic urgency prompt. |
| [AAO patient handout — What is glaucoma?](https://store.aao.org/media/resources/051189/051189-glaucoma-rf1.pdf) | Severe eye pain with headache/nausea and sudden blur are useful red-flag symptom combinations; optic-nerve/pressure context requires clinician correlation. | No IOP cutoff, glaucoma label, or medication instruction is encoded. |
| [NICE NG81 — Glaucoma: diagnosis and management](https://www.nice.org.uk/guidance/ng81) | Visual-field assessment, optic-nerve imaging/OCT, and pressure measurements are represented as distinct evidence types and missing-confirmation items rather than collapsed into one claim. | NICE recommendations are jurisdiction- and version-dependent; the current taxonomy intentionally remains non-clinical and presence-based until a governed validation process adopts a specific rule. |

## Effect on the current build

The references informed what provenance-bearing fields and missing evidence a
clinician workspace should preserve. They did **not** expand the executable
condition taxonomy beyond its four explicitly non-clinical evidence patterns,
and no numeric clinical threshold or disease probability was added.
