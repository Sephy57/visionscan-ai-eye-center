import { newId, StoredFile } from "../storage/files";

/**
 * Device integration abstraction.
 *
 * Device -> DeviceAdapter -> Normalized Imaging Format -> AI Analysis Pipeline
 *
 * Implemented adapters: SecureFileImportAdapter (real).
 * Placeholder adapters: DICOMweb, PACS, USB, vendor APIs - declared but
 * explicitly marked "integration placeholder" and NOT functional.
 */

export type ScanType =
  | "fundus"
  | "retinal_photo"
  | "oct"
  | "octa"
  | "faf"
  | "ffa"
  | "icg"
  | "slit_lamp"
  | "external_eye"
  | "optic_nerve"
  | "macula"
  | "unknown";

export type EyeLaterality = "OD" | "OS" | "unknown";

export interface NormalizedStudy {
  studyId: string;
  modality: ScanType;
  eye: EyeLaterality;
  source: "file_upload" | "device" | "dicom" | "unknown";
  metadata: DeviceMetadata;   // only what was actually provided - never invented
  files: StoredFile[];
  hashSeed?: number;          // deterministic content hash for reproducible demo generation
}

export interface DeviceMetadata {
  manufacturer?: string;
  model?: string;
  softwareVersion?: string;
  scanType?: ScanType;
  eye?: EyeLaterality;
  scanDateTime?: string;
  resolution?: string;
  scanProtocol?: string;
  acquisitionParameters?: Record<string, string>;
  providedBy: "user" | "device" | "none"; // provenance of every metadata field group
}

export interface DeviceAdapter {
  id: string;
  displayName: string;
  status: "available" | "placeholder";
  connect(): Promise<void>;
  authenticate(): Promise<void>;
  acquireScan(): Promise<NormalizedStudy>;
  retrieveStudy(studyRef: string): Promise<NormalizedStudy>;
  retrieveMetadata(studyRef: string): Promise<DeviceMetadata>;
  disconnect(): Promise<void>;
}

/**
 * Secure file import - the only fully functional adapter today.
 * Metadata (eye, modality, device info) is taken from what the user
 * actually declares; the system never invents device metadata.
 */
export class SecureFileImportAdapter implements DeviceAdapter {
  id = "secure-file-import";
  displayName = "Secure file import";
  status = "available" as const;

  private declared: DeviceMetadata;

  constructor(declared: DeviceMetadata) {
    this.declared = declared;
  }

  async connect(): Promise<void> {}
  async authenticate(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async acquireScan(): Promise<NormalizedStudy> {
    throw new Error("acquireScan() is not available for file import; use retrieveStudy().");
  }

  async retrieveStudy(_studyRef: string): Promise<NormalizedStudy> {
    throw new Error("Not implemented for file import adapter.");
  }

  async retrieveMetadata(_studyRef: string): Promise<DeviceMetadata> {
    return this.declared;
  }

  static buildStudy(
    files: StoredFile[],
    declared: DeviceMetadata
  ): NormalizedStudy {
    return {
      studyId: newId("study"),
      modality: declared.scanType ?? "unknown",
      eye: declared.eye ?? "unknown",
      source: "file_upload",
      metadata: { ...declared, providedBy: declared.providedBy ?? "user" },
      files,
    };
  }
}

/** Registry of adapters including clearly-labeled placeholders. */
export interface AdapterInfo {
  id: string;
  displayName: string;
  transport: string;
  status: "available" | "placeholder";
  note: string;
}

export const ADAPTER_REGISTRY: AdapterInfo[] = [
  {
    id: "secure-file-import",
    displayName: "Secure file import",
    transport: "HTTPS upload",
    status: "available",
    note: "Uploads stored on D:, originals preserved with SHA-256.",
  },
  {
    id: "dicomweb",
    displayName: "DICOMweb (QIDO/WADO)",
    transport: "HTTP DICOMweb",
    status: "placeholder",
    note: "Integration placeholder. DICOM parsing not implemented or validated.",
  },
  {
    id: "pacs",
    displayName: "PACS integration",
    transport: "C-STORE / DICOMweb",
    status: "placeholder",
    note: "Integration placeholder.",
  },
  {
    id: "usb-device",
    displayName: "USB-connected devices",
    transport: "USB",
    status: "placeholder",
    note: "Integration placeholder. Requires per-device drivers and calibration.",
  },
  {
    id: "lan-device",
    displayName: "Local-network devices",
    transport: "TCP/IP vendor protocol",
    status: "placeholder",
    note: "Integration placeholder.",
  },
  {
    id: "vendor-api",
    displayName: "Vendor APIs",
    transport: "Vendor REST",
    status: "placeholder",
    note: "Integration placeholder. No vendor agreements or SDKs implemented.",
  },
];

export function adapterSupportsModality(modality: ScanType): boolean {
  // File import accepts all raster modalities; DICOM modalities are detection-only.
  return true;
}
