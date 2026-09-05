"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Login failed."); setBusy(false); return; }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Network error - could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "40px auto" }}>
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <span className="logo-mark" aria-hidden="true" style={{ display: "inline-flex" }}><Icon name="eye" size={22} /></span>
        <h1 style={{ margin: "10px 0 2px" }}>VisionScan AI</h1>
        <p className="muted small" style={{ margin: 0 }}>Sign in to the research environment</p>
      </div>
      <form className="card" onSubmit={submit}>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && (
          <div className="alert danger" role="alert" style={{ marginTop: 4 }}>
            <span className="alert-icon" aria-hidden="true">⚠</span>
            <div className="alert-body">{error}</div>
          </div>
        )}
        <button className="btn" type="submit" disabled={busy} style={{ width: "100%", marginTop: 10 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="tiny muted" style={{ textAlign: "center", marginTop: 14 }}>
        No self-service account creation. Ask a system administrator for access.
        Forgotten password: an administrator can issue a reset token.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", justifyContent: "center", padding: 60 }}><div className="spinner" /></div>}>
      <LoginInner />
    </Suspense>
  );
}
