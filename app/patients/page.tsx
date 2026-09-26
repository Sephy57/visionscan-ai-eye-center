"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { authFetch } from "@/lib/auth/clientFetch";

/**
 * Patients workspace (eye-center). Lists registered patients, search by
 * ref/label, and creation of a new record from a user-supplied patient_ref
 * (never invented, never auto-generated from PHI).
 */

interface PatientRow {
  patient_id: string;
  patient_ref: string;
  display_label?: string | null;
  created_at: string;
  encounter_count: number;
  study_count: number;
}

export default function PatientsPage() {
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newRef, setNewRef] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  async function load(q?: string, cursor?: string, append = false) {
    if (append) setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (q) params.set("q", q);
      if (cursor) params.set("cursor", cursor);
      const res = await authFetch(`/api/patients?${params.toString()}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setRows((previous) => append ? [...previous, ...(json.patients ?? [])] : (json.patients ?? []));
      setNextCursor(typeof json.next_cursor === "string" ? json.next_cursor : null);
      setHasMore(json.has_more === true);
      setError(null);
    } catch {
      setError("Could not load patients.");
    }
    setLoaded(true);
    setLoadingMore(false);
  }

  useEffect(() => { load(); }, []);

  async function createPatient() {
    setCreateError(null);
    if (!newRef.trim()) { setCreateError("Patient identifier is required."); return; }
    setCreating(true);
    try {
      const res = await authFetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_ref: newRef.trim(), display_label: newLabel.trim() || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setCreateError(j.error ?? "Could not create patient record.");
      } else {
        setNewRef(""); setNewLabel("");
        await load(query);
      }
    } catch {
      setCreateError("Could not create patient record.");
    }
    setCreating(false);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Clinical workspace"
        title="Patients"
        lede="Eye-center patient registry. Records hold structured history, encounters, and linked studies. Use pseudonymous identifiers only."
        actions={<Link className="btn" href="/analyze"><Icon name="plus" size={14} /> New analysis</Link>}
      />

      <div className="grid stack-mobile" style={{ gridTemplateColumns: "minmax(0, 1.5fr) minmax(280px, 1fr)", alignItems: "start", marginBottom: 20 }}>
        <section className="card" aria-label="Patient search">
          <div className="card-kicker" style={{ marginBottom: 10 }}><Icon name="search" size={13} /> Search registry</div>
          <div className="inline-form">
            <input
              type="search"
              placeholder="Search by patient identifier or label…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") load(query); }}
              aria-label="Patient search"
            />
            <button className="btn secondary sm" onClick={() => load(query)}>Search</button>
            <button className="btn ghost sm" onClick={() => { setQuery(""); load(); }}>Clear</button>
          </div>
        </section>

        <section className="card" aria-labelledby="register-title">
          <h2 id="register-title" style={{ fontSize: "0.95rem", margin: "0 0 10px" }}>Register patient</h2>
          <div className="field" style={{ marginTop: 0 }}>
            <label htmlFor="new-patient-ref">Patient identifier</label>
            <input id="new-patient-ref" placeholder="e.g. VS-2026-0001" value={newRef} onChange={(e) => setNewRef(e.target.value)} maxLength={64} />
          </div>
          <div className="field">
            <label htmlFor="new-patient-label">Display label (optional)</label>
            <input id="new-patient-label" placeholder="Non-identifying label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} maxLength={120} />
          </div>
          <button className="btn sm" onClick={createPatient} disabled={creating}>
            {creating ? "Creating…" : "Create record"}
          </button>
          {createError && <p role="alert" className="field-error">{createError}</p>}
        </section>
      </div>

      {error && <ErrorState title={error} causes={["You may not have permission to view patients.", "The server may be unreachable."]} onRetryHref="/patients" />}

      {!error && !loaded && <div className="loading-row" role="status"><span className="pulse-dot" aria-hidden="true" /> Loading patients…</div>}

      {!error && loaded && rows.length === 0 && (
        <EmptyState icon={<Icon name="patients" size={22} />} title={query ? "No patients match this search" : "No patients registered yet"}>
          {query ? "Try a different identifier or clear the search." : "Create a patient record above, or upload a study with a patient identifier."}
        </EmptyState>
      )}

      {rows.length > 0 && (
        <div className="card flush">
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Patients">
            <table className="table">
              <caption className="sr-only">Registered patients</caption>
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Label</th>
                  <th scope="col">Encounters</th>
                  <th scope="col">Linked studies</th>
                  <th scope="col">Registered</th>
                  <th scope="col" className="actions">Open</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.patient_id}>
                    <td><Link href={`/patients/${encodeURIComponent(p.patient_id)}`}><strong>{p.patient_ref}</strong></Link></td>
                    <td>{p.display_label || <span className="muted">—</span>}</td>
                    <td className="num">{p.encounter_count}</td>
                    <td className="num">{p.study_count}</td>
                    <td className="small muted">{new Date(p.created_at).toLocaleDateString()}</td>
                    <td className="actions"><Link className="btn ghost sm" href={`/patients/${encodeURIComponent(p.patient_id)}`} aria-label={`Open patient ${p.patient_ref}`}>Profile <Icon name="arrowRight" size={13} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && nextCursor && (
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
              <button className="btn secondary sm" onClick={() => load(query, nextCursor, true)} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more patients"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
