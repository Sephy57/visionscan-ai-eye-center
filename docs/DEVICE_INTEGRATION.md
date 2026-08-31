# Device Integration

## Architecture

```
Device -> DeviceAdapter -> Normalized Imaging Format -> AI Analysis Pipeline
```

The platform is never hard-coded to one manufacturer. See `lib/devices/adapter.ts`.

## Adapter status

| Adapter | Transport | Status |
|---|---|---|
| Secure file import | HTTPS upload | **IMPLEMENTED** |
| DICOMweb (QIDO/WADO) | HTTP DICOMweb | NOT IMPLEMENTED (placeholder) |
| PACS integration | C-STORE / DICOMweb | NOT IMPLEMENTED (placeholder) |
| USB-connected devices | USB | NOT IMPLEMENTED (placeholder) |
| Local-network devices | TCP/IP vendor protocol | NOT IMPLEMENTED (placeholder) |
| Vendor APIs | Vendor REST | NOT IMPLEMENTED (placeholder) |

Connectivity is never faked in the UI: the Device Manager shows an honest "No devices connected" state.

## Device metadata

Preserved only when actually provided (never invented): manufacturer, model, software version, scan type,
eye (OD/OS), scan date/time, resolution, scan protocol, acquisition parameters. Provenance is recorded
(`providedBy: user | device | none`).

## Device compatibility gating

`deviceCompatible()` (`lib/models/registry.ts`) checks the input device against the model registry record:

- No device metadata provided → *"Device compatibility has not been validated. No device metadata was provided."*
- Model lists no devices → *"Device compatibility has not been validated for this model."*
- Device not in the model's validated list → *"Device compatibility has not been validated. This device is not
  listed in the model registry."*
- Match → allowed (still subject to all other gates).

A model validated on device A is **never** assumed valid on device B. Per-device validation must cover:
device model, firmware/software version, scan protocol, resolution, field of view, calibration, laterality,
and acquisition conditions.

## Modalities

Canonical vocabulary (`lib/models/modalities.ts`): FUNDUS, OCT, OCTA, FAF, FA, ICG, SLIT_LAMP, EXTERNAL_EYE,
DICOM_STUDY. Upload-time modality strings are canonicalized; models must explicitly declare modality support
and modality/model mismatches are refused (an OCT model never runs on a fundus image and vice versa).

## DICOM

DICOM Part 10 files are **detected** (magic check at offset 128) and safely refused for analysis with an
explicit explanation — they are never silently processed or ignored. Parsing, pixel-data decoding, and DICOM
metadata extraction are NOT implemented.

## Regulatory status

No device integration or analysis pathway in this platform has regulatory clearance. Anything beyond
file-import ingestion requires REGULATORY REVIEW before clinical use.
