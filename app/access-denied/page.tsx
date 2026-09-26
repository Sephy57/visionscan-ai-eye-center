"use client";

import Link from "next/link";
import { StatePanel } from "@/components/ui";

export default function AccessDeniedPage() {
  return (
    <div style={{ maxWidth: 640, margin: "48px auto" }}>
      <h1 className="sr-only">Access denied</h1>
      <StatePanel
        tone="warn" icon="lock" title="Access denied" role="alert"
        what="Your account role does not have permission to view this page or perform this action."
        why="Access is enforced server-side by role and resource scope. The interface cannot override it."
        next="If you believe this is incorrect, contact a system administrator."
        actions={<Link className="btn" href="/dashboard">Return to Dashboard</Link>}
      />
    </div>
  );
}
