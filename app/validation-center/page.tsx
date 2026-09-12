import type { Metadata } from "next";
import ValidationCenterClient from "./ValidationCenterClient";

export const metadata: Metadata = {
  title: "Validation Center | VisionScan AI",
  description: "Internal research-review evidence for model limits, failure signals, resources, and traceability.",
};

/**
 * Server shell only. The review surface reads authenticated, role-scoped API
 * responses in the browser so session cookies remain the source of access
 * control and the page does not pass server-only data across the boundary.
 */
export default function ValidationCenterPage() {
  return <ValidationCenterClient />;
}
