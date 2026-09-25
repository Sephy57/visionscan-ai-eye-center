/**
 * How the viewer describes the stored original behind a study. This is
 * presentation of a transport outcome only; it never infers anything about
 * the eye. Overlays may be drawn only when the state is SOURCE_AVAILABLE.
 */
export type SourceAvailability = "CHECKING" | "SOURCE_AVAILABLE" | "SOURCE_MISSING" | "SOURCE_UNAVAILABLE";

/** Error code the image route returns when the study exists but its stored original does not. */
export const SOURCE_MISSING_CODE = "SOURCE_MISSING";

export interface SourceAvailabilityResult {
  state: SourceAvailability;
  /** Why the source cannot be shown (absent for SOURCE_AVAILABLE). */
  reason?: "missing_from_storage" | "access_denied" | "service_error" | "network_error" | "not_an_image";
}

/**
 * Classify the image endpoint's response. `status` is null when the request
 * itself failed (offline, aborted). A 404 counts as "missing" only when the
 * route says so explicitly; any other failure is "unavailable", so a missing
 * file is never confused with a permission or service problem.
 */
export function classifySourceResponse(status: number | null, errorCode?: string | null, contentType?: string | null): SourceAvailabilityResult {
  if (status === null) return { state: "SOURCE_UNAVAILABLE", reason: "network_error" };
  if (status >= 200 && status < 300) {
    return contentType && !contentType.toLowerCase().startsWith("image/")
      ? { state: "SOURCE_UNAVAILABLE", reason: "not_an_image" }
      : { state: "SOURCE_AVAILABLE" };
  }
  if (status === 404 && errorCode === SOURCE_MISSING_CODE) return { state: "SOURCE_MISSING", reason: "missing_from_storage" };
  if (status === 401 || status === 403) return { state: "SOURCE_UNAVAILABLE", reason: "access_denied" };
  return { state: "SOURCE_UNAVAILABLE", reason: "service_error" };
}

export const SOURCE_STATE_COPY: Record<Exclude<SourceAvailability, "CHECKING" | "SOURCE_AVAILABLE">, Record<string, { title: string; body: string }>> = {
  SOURCE_MISSING: {
    missing_from_storage: {
      title: "Source missing — original image not in storage",
      body: "The study record exists, but its stored original file was not found. No substitute image or overlay is shown. An administrator can restore the file from a verified backup (System Status → reconciliation).",
    },
  },
  SOURCE_UNAVAILABLE: {
    access_denied: {
      title: "Source unavailable — not permitted for this account",
      body: "The server refused to serve the original to this session. Sign in again or ask an administrator for access. No substitute image or overlay is shown.",
    },
    service_error: {
      title: "Source unavailable — the image service returned an error",
      body: "The original could not be retrieved right now. Retry later. No substitute image or overlay is shown.",
    },
    network_error: {
      title: "Source unavailable — the request did not complete",
      body: "Check the connection and retry. No substitute image or overlay is shown.",
    },
    not_an_image: {
      title: "Source unavailable — the stored file is not a displayable image",
      body: "The stored original is not in a browser-displayable format. No substitute image or overlay is shown.",
    },
  },
};
