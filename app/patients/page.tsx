"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, EmptyState, ErrorState } from "@/components/ui";
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
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newRef, setNewRef] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  async function load(q?: string) {
    try {
      const res = await authFetch(`/api/patients${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setRows(json.patients ?? []);
      setError(null);
    } catch {
      setError("Could not load patients.");
    }
    setLoaded(true);
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
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Patients</h1>
        <p className="text-muted" style={{ margin: "4px 0 0" }}>
          Eye-center patient registry. Records hold structured history, encounters, and linked studies.
        </p>
      </header>

      <section aria-label="Patient search" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          type="search"
          placeholder="Search by patient identifier or label…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") load(query); }}
          aria-label="Patient search"
          style={{ flex: 1, minWidth: 220 }}
        />
        <button className="btn secondary sm" onClick={() => load(query)}>Search</button>
        <button className="btn ghost sm" onClick={() => { setQuery(""); load(); }}>Clear</button>
      </section>

      <section aria-label="New patient record" style={{ marginBottom: 24, padding: 16, border: "1px solid var(--border, #ddd)", borderRadius: 8 }}>
        <h2 style={{ fontSize: "1.05rem", margin: "0 0 8px" }}>Register patient</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            placeholder="Patient identifier (e.g. VS-2026-0001)"
            value={newRef}
            onChange={(e) => setNewRef(e.target.value)}
            maxLength={64}
            aria-label="Patient identifier"
            style={{ minWidth: 240 }}
          />
          <input
            placeholder="Display label (optional)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            maxLength={120}
            aria-label="Display label"
            style={{ minWidth: 200 }}
          />
          <button className="btn primary sm" onClick={createPatient} disabled={creating}>
            {creating ? "Creating…" : "Create record"}
          </button>
        </div>
        {createError && <p role="alert" style={{ color: "var(--bad, #b00)", margin: "8px 0 0" }}>{createError}</p>}
      </section>

      {error && <ErrorState title={error} causes={["You may not have permission to view patients.", "The server may be unreachable."]} onRetryHref="/patients" />}

      {!error && loaded && rows.length === 0 && (
        <EmptyState icon={<span aria-hidden>🗂</span>} title="No patients registered yet">
          <p>Create a patient record above, or upload a study with a patient identifier.</p>
        </EmptyState>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8 }}>Patient</th>
              <th style={{ textAlign: "left", padding: 8 }}>Label</th>
              <th style={{ textAlign: "left", padding: 8 }}>Encounters</th>
              <th style={{ textAlign: "left", padding: 8 }}>Linked studies</th>
              <th style={{ textAlign: "left", padding: 8 }}>Registered</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.patient_id}>
                <td style={{ padding: 8 }}>
                  <Link href={`/patients/${p.patient_id}`}><strong>{p.patient_ref}</strong></Link>
                </td>
                <td style={{ padding: 8 }}>{p.display_label || <span className="text-muted">—</span>}</td>
                <td style={{ padding: 8 }}>{p.encounter_count}</td>
                <td style={{ padding: 8 }}>{p.study_count}</td>
                <td style={{ padding: 8 }}>{new Date(p.created_at).toLocaleDateString()}</td>
                <td style={{ padding: 8 }}>
                  <Badge tone="neutral">record</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
