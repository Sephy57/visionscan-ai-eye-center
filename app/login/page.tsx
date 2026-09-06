"use client";

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons";

function LoginInner() {
  const params = useSearchParams();
  // `next` comes from middleware. Keep redirects local even if a URL is
  // manually edited; this also avoids a malformed target looking like a
  // stalled navigation after a successful sign-in.
  const requestedNext = params.get("next");
  const next = requestedNext && requestedNext.startsWith("/") && !requestedNext.startsWith("//") && !requestedNext.includes("\\") &&
    !requestedNext.startsWith("/login") && !requestedNext.startsWith("/access-denied")
    ? requestedNext
    : "/dashboard";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const requestInFlight = useRef(false);

  const LOGIN_TIMEOUT_MS = 15_000;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // The disabled button covers pointer interactions; this guard also
    // protects programmatic and rapid keyboard submits before React rerenders.
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true);
    setError(null);
    setStatus("Signing in…");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
    let redirectStarted = false;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        setError(json.error ?? "Login failed. Please try again.");
        setStatus(null);
        return;
      }
      setStatus("Signed in. Loading dashboard…");
      redirectStarted = true;
      // A full document replacement ensures newly-issued cookies are visible
      // to middleware on the very first protected navigation. In production
      // browser testing, client-router replacement could leave this screen
      // displaying "Loading dashboard…" despite a successful login.
      window.location.replace(next);
    } catch (cause) {
      setStatus(null);
      setError(cause instanceof DOMException && cause.name === "AbortError"
        ? "Login is taking longer than expected. Please try again."
        : "Network error — could not reach the server. Please try again.");
    } finally {
      window.clearTimeout(timeout);
      // Keep the submit control unavailable while Next applies the successful
      // route transition, preventing a second session from being created.
      if (!redirectStarted) {
        requestInFlight.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "40px auto" }}>
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <span className="logo-mark" aria-hidden="true" style={{ display: "inline-flex" }}><Icon name="eye" size={22} /></span>
        <h1 style={{ margin: "10px 0 2px" }}>VisionScan AI</h1>
        <p className="muted small" style={{ margin: 0 }}>Sign in to the research environment</p>
      </div>
      <form className="card" onSubmit={submit} aria-describedby={error ? "login-error" : "login-status"}>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && (
          <div className="alert danger" id="login-error" role="alert" style={{ marginTop: 4 }}>
            <span className="alert-icon" aria-hidden="true">⚠</span>
            <div className="alert-body">{error}</div>
          </div>
        )}
        <div id="login-status" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {status}
        </div>
        <button className="btn" type="submit" disabled={busy} style={{ width: "100%", marginTop: 10 }}>
          {busy && <span className="spinner" aria-hidden="true" style={{ width: 14, height: 14, marginRight: 7 }} />}
          {busy ? (status === "Signed in. Loading dashboard…" ? "Loading dashboard…" : "Signing in…") : "Sign in"}
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
