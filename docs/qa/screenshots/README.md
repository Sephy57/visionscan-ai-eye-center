# VisionScan Phase 3 browser evidence

These screenshots were captured from the running local VisionScan instance through the persistent Chromium/CUA browser on 2026-09-12. They are UI evidence only, not clinical evidence. The observed study was the existing synthetic reference `synthetic-phase2-ui-003`; no patient name, MRN, DOB, clinical note, or real scan was used in the screenshot set.

All files are PNGs at the browser's default 1028×900 capture viewport. SHA-256 values are recorded so a later reviewer can confirm that the evidence file was not silently replaced.

| File | Route/state | Bytes | SHA-256 |
|---|---|---:|---|
| `landing.png` | `/` landing hero | 77,526 | `b064595e823849cd7b4602bab2fb9a3c432f3180781165e8a676cb65f8252883` |
| `login.png` | `/login` sign-in form | 65,452 | `bc057b857b9358c89a69ee53734c91b40b3c3f1d1612b89ed4c8f6e0defe835c` |
| `dashboard.png` | `/dashboard` research dashboard | 72,698 | `7a12101e09365069ec64d6af76a3283593b444827c7629d2e1530ff785ca351a` |
| `intake.png` | `/analyze` upload/consent intake | 95,245 | `d616049c1079ae97afa16e88865fee3a679ce40b53acd144c62a778a135d3ad5` |
| `processing.png` | `/processing?study=...` queued job | 84,067 | `720111fee2ca2f67de560e64adc4b271348bc9039dc9609c5ddc1ee2d57f383e` |
| `result.png` | `/result?study=...` research result | 92,843 | `3812b6a5c2b563f21b81a34ecd973a36aa50a742e1193d5225a8d347a8e71ac4` |
| `result-evidence.png` | result model execution/disagreement section | 93,117 | `28b8c545b56328bfac256a9a6404bcb3002664204b6d9b17d83113585929d36e` |
| `conditions-medication.png` | result condition/medication boundary | 104,719 | `3032d3b443e2f45deccb4c7e7bfcdc229273ee5bf0dd4569c0b0be23d471689e` |
| `specialist-review.png` | `/clinician?study=...` human review | 102,429 | `9cc348a9456affee5cdc5aab7bd004c2a7be0405e0a0c41489c646e8280f7bae` |
| `specialist-board.png` | result nine-specialty status board | 81,011 | `274e047ed43b7fbbc793fdc91ba82321e525723cd5323af4cf3765a702db3dbc` |
| `report.png` | `/report?study=...` report header | 94,327 | `5bf83769795262d1095a45d46dc7443608f3f4e8bdf7c0cc2aa496a0e0bb10b4` |
| `models.png` | `/models` registry | 96,322 | `a51210709e36ebffb6aaec0c07305d261b16e16a65d12879302b13526d56ad06` |
| `evaluations.png` | `/evaluations` aggregate research dashboard | 78,296 | `9b1591244c9c4beca9965a0b1624a03efab523546bf1072c32ef8d89b293921b` |
| `validation.png` | `/validation` aggregate-only dashboard | 79,480 | `d8796075f0b389a3a4214250b7b57f581f4133b03c21ac4c4e1f32e1fa297f33` |

The capture viewport is the default persistent browser viewport. Responsive QA was separately executed by the repository's real-browser harness at 320, 375, 414, 768, 1024, 1280, 1440, and 1920 px widths; a mobile screenshot was not substituted with a resized desktop image.
