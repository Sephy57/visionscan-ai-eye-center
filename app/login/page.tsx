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
    <div className="auth-layout">
      <section className="auth-brand" aria-labelledby="login-title">
        <span className="logo-mark" aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 12 }}><Icon name="eye" size={22} /></span>
        <div className="eyebrow" style={{ marginTop: 18 }}>Eye Center Intelligence</div>
        <h1 id="login-title">VisionScan AI workspace</h1>
        <p>
          Multimodal ophthalmic research analysis with quality gates, explicit provenance, and clinician review at
          every step. Sign in to the research environment.
        </p>
        <ul className="auth-points">
          <li><Icon name="scan" size={18} /><span><strong>Quality and domain gates first</strong>Inadequate or out-of-distribution images never produce findings.</span></li>
          <li><Icon name="layers" size={18} /><span><strong>Evidence with provenance</strong>Observed, inferred, and model-output evidence stay visibly separate.</span></li>
          <li><Icon name="review" size={18} /><span><strong>Human authority</strong>Only a qualified clinician can finalize an interpretation.</span></li>
        </ul>
      </section>

      <div className="auth-card">
        <h2>Sign in</h2>
        <p className="muted small" style={{ margin: "0 0 18px" }}>Use the account issued by your system administrator.</p>
        <form onSubmit={submit} aria-describedby={error ? "login-error" : "login-status"}>
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
              <span className="alert-icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
              <div className="alert-body">{error}</div>
            </div>
          )}
          <div id="login-status" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {status}
          </div>
          <button className="btn lg block" type="submit" disabled={busy} style={{ marginTop: 12 }}>
            {busy && <span className="spinner sm" aria-hidden="true" />}
            {busy ? (status === "Signed in. Loading dashboard…" ? "Loading dashboard…" : "Signing in…") : "Sign in"}
          </button>
        </form>
        <p className="tiny muted" style={{ marginTop: 18, marginBottom: 0, lineHeight: 1.6 }}>
          <Icon name="lock" size={12} /> No self-service account creation. Ask a system administrator for access.
          Forgotten password: an administrator can issue a reset token.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="page-loading" role="status"><span className="spinner" aria-hidden="true" />Loading sign-in…</div>}>
      <LoginInner />
    </Suspense>
  );
}
