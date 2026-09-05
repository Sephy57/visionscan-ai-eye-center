"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";

export default function AccessDeniedPage() {
  return (
    <div style={{ maxWidth: 520, margin: "60px auto", textAlign: "center" }}>
      <Icon name="review" size={30} />
      <h1 style={{ marginTop: 10 }}>Access denied</h1>
      <p className="muted">
        Your account role does not have permission to view this page or perform this action.
        If you believe this is incorrect, contact a system administrator.
      </p>
      <Link className="btn" href="/dashboard">Return to Dashboard</Link>
    </div>
  );
}
