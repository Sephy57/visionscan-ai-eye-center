"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { authFetch } from "@/lib/auth/clientFetch";

/**
 * S2: document evidence panel. Lists a study's documents with validation and
 * extraction status. Extracted text is displayed ONLY in an explicitly
 * labeled "AUTO-EXTRACTED / UNREVIEWED / NOT A VERIFIED CLINICAL RESULT"
 * viewer. Extraction is never connected to the analysis result shown on
 * this page - it is separate, unverified evidence for the clinician.
 */

interface DocumentSummaryDto {
  document_id: string;
  filename_display: string;
  size_bytes: number;
  sha256: string;
  page_count: number;
  status: string;
  document_type: string;
  uploaded_by: string;
  uploaded_at: string;
  validation: { outcome: string; error_code?: string; detail?: string };
  warnings: string[];
}

interface ExtractionSummaryDto {
  status: string;
  document_level: string;
  totals: { pages: number; pages_text_layer: number; pages_ocr: number; pages_empty: number; pages_failed: number; char_count: number };
  verification: { status: string };
  warnings: string[];
}

interface PageExtractionDto {
  page: number;
  method: string;
  char_count: number;
  text: string;
  confidence?: number;
  warnings: string[];
}

interface TestResultDto {
  result_id: string;
  document_id: string;
  test_type: string;
  value_raw: string;
  value?: number;
  unit_raw?: string;
  unit_normalized?: string;
  value_normalized?: number;
  conversion?: { from: string; to: string; factor: number; method: string };
  laterality: string;
  timestamp?: string;
  date_raw?: string;
  page: number;
  source_text: string;
  extraction_method: string;
  extraction_confidence?: number;
  ambiguity_flags: string[];
  conflicts: string[];
  reference_range?: { raw: string; source: string };
  verification: { status: string; at: string; actor?: string };
  correction?: { value: number; unit?: string; laterality?: string; note?: string; by: string; at: string };
  verification_history: Array<{ at: string; actor: string; action: string; note?: string }>;
}

const REVIEW_ROLES = new Set(["ADMIN", "CLINICIAN", "REVIEWER"]);

/** S4.16: explicit, non-clinical status language. */
function statusLabel(status: string): string {
  switch (status) {
    case "AUTO_EXTRACTED": return "AUTO-EXTRACTED — NOT A VERIFIED CLINICAL RESULT";
    case "UNREVIEWED": return "UNREVIEWED — NOT A VERIFIED CLINICAL RESULT";
    case "VERIFIED": return "CLINICIAN/REVIEWER VERIFIED";
    case "CORRECTED": return "CORRECTED BY HUMAN REVIEW";
    case "REJECTED": return "REJECTED — NOT TRUSTED";
    default: return status;
  }
}
function statusTone(status: string): "ok" | "warn" | "bad" | "neutral" {
  if (status === "VERIFIED" || status === "CORRECTED") return "ok";
  if (status === "REJECTED") return "bad";
  return "warn";
}

/** One extracted test result: provenance display + human verification actions (S4). */
function ResultRow({ r, role, onChanged }: { r: TestResultDto; role: string | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [cValue, setCValue] = useState("");
  const [cUnit, setCUnit] = useState(r.unit_normalized ?? r.unit_raw ?? "");
  const [cLaterality, setCLaterality] = useState(r.laterality);
  const [cNote, setCNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const canReview = role !== null && REVIEW_ROLES.has(role);
  const status = r.verification.status;

  async function act(action: "verify" | "correct" | "reject" | "unreview", correction?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/results/${r.result_id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, correction, note: correction?.note }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Action failed.");
        return;
      }
      setCorrecting(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  function submitCorrection() {
    const numeric = Number(cValue);
    if (cValue.trim() === "" || !Number.isFinite(numeric)) {
      setError("Corrected value must be a valid number.");
      return;
    }
    void act("correct", {
      value: numeric,
      unit: cUnit.trim() || undefined,
      laterality: cLaterality,
      note: cNote.trim() || undefined,
    });
  }

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6, marginTop: 6 }}>
      <div className="small">
        <strong>{r.test_type.replaceAll("_", " ")}</strong>
        {" · "}{r.laterality === "UNKNOWN" ? <span style={{ color: "var(--danger)" }}>LATERALITY UNKNOWN</span> : r.laterality}
        {" · raw: "}<code>{r.value_raw}</code>
        {r.value !== undefined && <> (= {r.value}{r.unit_normalized ? ` ${r.unit_normalized}` : ""})</>}
        {r.value_normalized !== undefined && r.value_normalized !== r.value && <> → {r.value_normalized} {r.unit_normalized} (converted)</>}
        {" · "}<Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
        {r.correction && <> · corrected to {r.correction.value}{r.correction.unit ? ` ${r.correction.unit}` : ""} by {r.correction.by}</>}
      </div>
      <div className="tiny muted" style={{ wordBreak: "break-word" }}>
        doc {r.document_id.slice(0, 12)}… · p.{r.page} · {r.extraction_method}{r.extraction_confidence !== undefined ? ` · extraction confidence ${r.extraction_confidence.toFixed(0)}% (not clinical confidence)` : ""} · source: {r.source_text}
      </div>
      <div className="tiny muted">
        reference range: {r.reference_range ? `${r.reference_range.raw} (document-sourced)` : "Not provided by source document"}
      </div>
      {(r.ambiguity_flags.length > 0 || r.conflicts.length > 0) && (
        <div className="tiny" style={{ marginTop: 2 }}>
          {r.ambiguity_flags.length > 0 && <span style={{ color: "var(--warn, #a05a00)" }}>flags: {r.ambiguity_flags.join(", ")} </span>}
          {r.conflicts.length > 0 && (
            <span style={{ color: "var(--danger)" }}>
              CONFLICT: {r.conflicts.length} other value(s) for this test/eye disagree — human resolution required, no value chosen automatically
            </span>
          )}
        </div>
      )}
      {error && <p className="tiny" style={{ color: "var(--danger)" }}>{error}</p>}

      {canReview && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {(status === "AUTO_EXTRACTED" || status === "UNREVIEWED") && (
            <>
              <button className="btn secondary sm" disabled={busy || r.value === undefined} title={r.value === undefined ? "Value failed strict parsing; use Correct instead" : undefined} onClick={() => void act("verify")}>
                Verify
              </button>
              <button className="btn secondary sm" disabled={busy} onClick={() => setCorrecting((v) => !v)}>Correct</button>
              <button className="btn ghost sm" disabled={busy} onClick={() => void act("reject")}>Reject</button>
            </>
          )}
          {(status === "VERIFIED" || status === "CORRECTED" || status === "REJECTED") && (
            <button className="btn ghost sm" disabled={busy} onClick={() => void act("unreview")}>Return to review</button>
          )}
          {status !== "REJECTED" && status !== "AUTO_EXTRACTED" && status !== "UNREVIEWED" && (
            <button className="btn ghost sm" disabled={busy} onClick={() => setCorrecting((v) => !v)}>Correct</button>
          )}
          <button className="btn ghost sm" onClick={() => setShowHistory((v) => !v)}>{showHistory ? "Hide history" : "History"}</button>
        </div>
      )}

      {correcting && (
        <div className="tiny" style={{ marginTop: 6, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <label>Value <input value={cValue} onChange={(e) => setCValue(e.target.value)} placeholder={r.value !== undefined ? String(r.value) : "e.g. 21"} style={{ width: 90 }} /></label>
            <label>Unit <input value={cUnit} onChange={(e) => setCUnit(e.target.value)} style={{ width: 80 }} /></label>
            <label>Laterality
              <select value={cLaterality} onChange={(e) => setCLaterality(e.target.value)}>
                <option value="OD">OD</option>
                <option value="OS">OS</option>
                <option value="OU">OU</option>
                <option value="UNKNOWN">UNKNOWN</option>
              </select>
            </label>
          </div>
          <label style={{ display: "block", marginTop: 6 }}>
            Reason (optional)
            <input value={cNote} onChange={(e) => setCNote(e.target.value)} style={{ width: "100%" }} maxLength={500} />
          </label>
          <p className="muted" style={{ margin: "4px 0" }}>
            The original extraction (raw value, source text) is never overwritten — this is stored as a human correction alongside it.
          </p>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button className="btn primary sm" disabled={busy} onClick={submitCorrection}>Submit correction</button>
            <button className="btn ghost sm" disabled={busy} onClick={() => setCorrecting(false)}>Cancel</button>
          </div>
        </div>
      )}

      {showHistory && (
        <ul className="tiny" style={{ marginTop: 6, paddingLeft: 16 }}>
          {r.verification_history.map((h, i) => (
            <li key={i}>{h.at} · {h.actor} · {h.action}{h.note ? ` — ${h.note}` : ""}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DocumentEvidencePanel({ studyId }: { studyId: string }) {
  const [documents, setDocuments] = useState<DocumentSummaryDto[] | null>(null);
  const [extraction, setExtraction] = useState<Record<string, ExtractionSummaryDto | null>>({});
  const [results, setResults] = useState<Record<string, TestResultDto[] | null>>({});
  const [openText, setOpenText] = useState<string | null>(null);
  const [pages, setPages] = useState<PageExtractionDto[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await authFetch("/api/auth/session");
      if (!res.ok) return;
      const j = await res.json();
      setRole(j.authenticated ? j.user?.role ?? null : null);
    })();
  }, []);

  const refresh = useCallback(async () => {
    const res = await authFetch(`/api/studies/${encodeURIComponent(studyId)}/documents`);
    if (!res.ok) { setDocuments([]); return; }
    const j = await res.json();
    const docs: DocumentSummaryDto[] = j.documents ?? [];
    setDocuments(docs);
    const next: Record<string, ExtractionSummaryDto | null> = {};
    const nextResults: Record<string, TestResultDto[] | null> = {};
    for (const d of docs) {
      const s = await authFetch(`/api/documents/${d.document_id}/status`);
      next[d.document_id] = s.ok ? (await s.json())?.extraction ?? null : null;
      const r = await authFetch(`/api/documents/${d.document_id}/results`);
      nextResults[d.document_id] = r.ok ? (await r.json())?.results ?? [] : null;
    }
    setExtraction(next);
    setResults(nextResults);
  }, [studyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function extract(documentId: string) {
    setBusy(documentId);
    setError(null);
    try {
      const res = await authFetch(`/api/documents/${documentId}/extract`, { method: "POST" });
      if (!res.ok && res.status !== 202) {
        const j = await res.json().catch(() => ({}));
        setError(j.error === "ALREADY_PROCESSING" ? "Extraction already in progress." : "Extraction could not be started.");
        return;
      }
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await authFetch(`/api/documents/${documentId}/status`);
        if (!s.ok) continue;
        const j = await s.json();
        if (j.status === "READY" || j.status === "FAILED" || j.status === "VALID") {
          await refresh();
          return;
        }
      }
      setError("Extraction is still running - refresh to check status.");
    } finally {
      setBusy(null);
    }
  }

  async function viewText(documentId: string) {
    if (openText === documentId) { setOpenText(null); setPages(null); return; }
    setBusy(documentId);
    try {
      const res = await authFetch(`/api/documents/${documentId}/text`);
      if (res.status === 404) { setPages([]); setOpenText(documentId); return; }
      if (!res.ok) { setError("Extracted text is not available for your role."); return; }
      const j = await res.json();
      setPages(j.artifact?.pages ?? []);
      setOpenText(documentId);
    } finally {
      setBusy(null);
    }
  }

  if (documents === null) return null;
  if (documents.length === 0) return null;

  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="card-title">
        <h3 style={{ fontSize: "0.9rem" }}>DOCUMENTS &amp; EXTRACTED EVIDENCE</h3>
      </div>
      <p className="tiny muted" style={{ marginTop: 0 }}>
        Uploaded documents are <strong>untrusted inputs</strong>. Extracted text is
        auto-generated, <strong>unreviewed</strong>, and <strong>never</strong> feeds the
        image analysis, triage, or any conclusion on this page.
      </p>
      {error && <div className="alert danger" style={{ margin: "8px 0" }}><div className="alert-body">{error}</div></div>}
      {documents.map((d) => {
        const ex = extraction[d.document_id];
        return (
          <div key={d.document_id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <strong className="small" style={{ wordBreak: "break-all" }}>{d.filename_display}</strong>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Badge tone={d.status === "VALID" || d.status === "READY" ? "ok" : d.status === "FAILED" ? "bad" : "info"}>{d.status}</Badge>
                {ex && <Badge tone={ex.status === "COMPLETE" ? "ok" : ex.status === "PARTIAL" ? "warn" : "bad"}>{ex.status}</Badge>}
                {ex && <Badge tone="neutral">{ex.document_level.toUpperCase()}</Badge>}
                <Badge tone="neutral">{d.document_type}</Badge>
              </span>
            </div>
            <div className="kv tiny" style={{ gridTemplateColumns: "120px 1fr", marginTop: 6 }}>
              <dt>Size / pages</dt><dd>{(d.size_bytes / 1024).toFixed(0)} KB / {d.page_count || "?"}</dd>
              <dt>SHA-256</dt><dd style={{ fontFamily: "var(--mono)" }}>{d.sha256.slice(0, 24)}…</dd>
              {ex && (
                <>
                  <dt>Extraction</dt>
                  <dd>
                    {ex.totals.pages_text_layer} text · {ex.totals.pages_ocr} OCR · {ex.totals.pages_empty} empty · {ex.totals.pages_failed} failed · {ex.totals.char_count} chars
                    {" "}| verification: <strong>{ex.verification.status}</strong>
                  </dd>
                </>
              )}
            </div>
            {d.validation.outcome === "REJECTED" && (
              <p className="tiny" style={{ color: "var(--danger)" }}>Rejected: {d.validation.error_code}</p>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <button className="btn secondary sm" disabled={busy === d.document_id || d.status === "PROCESSING"} onClick={() => extract(d.document_id)}>
                {d.status === "PROCESSING" ? "Extracting…" : ex ? "Re-extract text" : "Extract text"}
              </button>
              <button className="btn ghost sm" disabled={busy === d.document_id} onClick={() => viewText(d.document_id)}>
                {openText === d.document_id ? "Hide extracted text" : "View extracted text"}
              </button>
              {(role === "ADMIN" || role === "CLINICIAN" || role === "REVIEWER") && (
                <a className="btn ghost sm" href={`/api/documents/${d.document_id}/file`} target="_blank" rel="noopener noreferrer">
                  View original PDF (sandboxed)
                </a>
              )}
            </div>
            {openText === d.document_id && (
              <div style={{ marginTop: 8 }}>
                {pages === null || pages.length === 0 ? (
                  <p className="tiny muted">No extraction artifact available yet.</p>
                ) : (
                  <div className="alert warn" role="note" style={{ margin: 0 }}>
                    <div className="alert-body">
                      <strong>AUTO-EXTRACTED — UNREVIEWED — UNCERTAIN — NOT A VERIFIED CLINICAL RESULT</strong>
                      {pages.map((p) => (
                        <details key={p.page} style={{ marginTop: 6 }}>
                          <summary className="small" style={{ cursor: "pointer" }}>
                            Page {p.page} · {p.method.replace("_", " ")} · {p.char_count} chars{p.confidence !== undefined ? ` · extraction confidence ${p.confidence.toFixed(0)}% (OCR/text-extraction quality, not clinical confidence)` : ""}
                          </summary>
                          <pre className="tiny" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 220, overflow: "auto", background: "var(--surface-2, rgba(0,0,0,0.04))", padding: 8, borderRadius: 6 }}>{p.text || "(no text)"}</pre>
                          {p.warnings.length > 0 && <p className="tiny" style={{ color: "var(--warn, #a05a00)" }}>warnings: {p.warnings.join(", ")}</p>}
                        </details>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* S3: structured test results (display-only; verification workflow is S4). */}
            {results[d.document_id] && results[d.document_id]!.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary className="small" style={{ cursor: "pointer", fontWeight: 650 }}>
                  Structured test results ({results[d.document_id]!.length})
                  {results[d.document_id]!.some((r) => r.ambiguity_flags.length > 0 || r.conflicts.length > 0) && (
                    <span style={{ color: "var(--warn, #a05a00)" }}> · needs review</span>
                  )}
                </summary>
                <p className="tiny" style={{ color: "var(--warn, #a05a00)", margin: "6px 0" }}>
                  AUTO-EXTRACTED — UNREVIEWED — NOT VERIFIED CLINICAL INFORMATION. Ambiguous OCR
                  (e.g. &quot;2l&quot;) is preserved and flagged, never auto-corrected. Human
                  verification below never feeds diagnosis, triage, or the analysis pipeline.
                </p>
                {results[d.document_id]!.map((r) => (
                  <ResultRow key={r.result_id} r={r} role={role} onChanged={() => void refresh()} />
                ))}
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
