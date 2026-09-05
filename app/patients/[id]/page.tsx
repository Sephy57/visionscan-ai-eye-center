"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { Badge, EmptyState, ErrorState, TriageBadge } from "@/components/ui";
import { authFetch } from "@/lib/auth/clientFetch";

/**
 * Patient profile (eye-center workspace): encounters, timeline, linked
 * studies, automatic document extractions with clinician
 * verify/correct/reject, and the record-analysis package.
 *
 * SAFETY: extracted items are shown as UNREVIEWED DOCUMENT_EXTRACTED
 * candidates. Verify/correct/reject never overwrites the original raw
 * text; corrections are recorded as annotations with provenance.
 */

interface Encounter {
  encounter_id: string;
  created_at: string;
  chief_complaint?: string | null;
  symptoms: Array<{ type: string }>;
  medications: Array<{ value: { name: string; ocular: boolean; status?: string } }>;
  allergies: Array<{ value: { allergen: string; reaction?: string | null } }>;
  linked_study_ids: string[];
}

interface PatientRecord {
  patient_id: string;
  patient_ref: string;
  display_label?: string | null;
  created_at: string;
}

interface Timeline {
  events: Array<{ study_id: string; timestamp: string; modality: string; laterality_scope: string }>;
}

interface ExtractedItem {
  item_id: string;
  type?: string;
  raw_text?: string;
  value_raw?: string;
  name_raw?: string;
  allergen_raw?: string;
  condition?: string;
  diagnosis_raw?: string;
  verification: string;
  extraction_confidence?: number;
  confidence_basis?: string;
  laterality?: string;
  onset?: string;
  duration?: string;
}

interface ExtractionRecord {
  document_id: string;
  status: string;
  symptoms?: ExtractedItem[];
  medications?: ExtractedItem[];
  allergies?: ExtractedItem[];
  systemic_candidates?: ExtractedItem[];
  explicit_negations?: ExtractedItem[];
  ocular_history_candidates?: ExtractedItem[];
  family_history_candidates?: ExtractedItem[];
  exam_findings?: ExtractedItem[];
  chief_complaint?: ExtractedItem;
}

interface RecordPackage {
  stages: Record<string, { status: string; detail?: string }>;
  symptom_sources: { extracted_unreviewed_count: number; extracted_rejected_count: number };
  limitations: string[];
}

export default function PatientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [patient, setPatient] = useState<PatientRecord | null>(null);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [extractions, setExtractions] = useState<Record<string, ExtractionRecord>>({});
  const [recordPackages, setRecordPackages] = useState<Record<string, RecordPackage>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [newEncounter, setNewEncounter] = useState({ chief_complaint: "", linked: "" });

  async function load() {
    try {
      const res = await authFetch(`/api/patients/${id}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setPatient(json.patient);
      setEncounters(json.encounters ?? []);
      setTimeline(json.timeline ?? null);

      // Load record-analysis packages + extractions for linked studies.
      const studyIds: string[] = [...new Set((json.encounters as Encounter[] ?? []).flatMap((e) => (e.linked_study_ids ?? []).filter((s): s is string => typeof s === "string")))];
      const pkgs: Record<string, RecordPackage> = {};
      const exts: Record<string, ExtractionRecord> = {};
      await Promise.all(
        studyIds.map(async (sid) => {
          try {
            const r = await authFetch(`/api/studies/${sid}/record-analysis`);
            if (r.ok) pkgs[sid] = await r.json();
          } catch { /* stage shown as unavailable */ }
        })
      );
      const docIds = new Set<string>();
      Object.values(pkgs).forEach((p) =>
        (p.stages?.document_extractions ? (p.stages.document_extractions as unknown as Array<{ result?: { document_id?: string } }>).forEach((s) => { if (s.result?.document_id) docIds.add(s.result.document_id); }) : null)
      );
      await Promise.all(
        [...docIds].map(async (did) => {
          try {
            const r = await authFetch(`/api/documents/${did}/extraction`);
            if (r.ok) {
              const j = await r.json();
              if (j && j.status && j.status !== "NOT_EXTRACTED") exts[did] = j;
            }
          } catch { /* shown as not extracted */ }
        })
      );
      setRecordPackages(pkgs);
      setExtractions(exts);
      setError(null);
    } catch {
      setError("Could not load patient profile.");
    }
    setLoaded(true);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function createEncounter() {
    try {
      const res = await authFetch(`/api/patients/${id}/encounters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chief_complaint: newEncounter.chief_complaint || null,
          linked_study_ids: newEncounter.linked.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      if (res.ok) {
        setNewEncounter({ chief_complaint: "", linked: "" });
        setLoaded(false);
        await load();
      }
    } catch { /* leave form state */ }
  }

  async function annotate(docId: string, category: string, itemId: string, action: "VERIFY" | "REJECT") {
    setBusyItem(itemId);
    try {
      const res = await authFetch(`/api/documents/${docId}/extraction/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, item_id: itemId, action }),
      });
      if (res.ok) {
        const j = await res.json();
        setExtractions((prev) => ({ ...prev, [docId]: j.extraction }));
      }
    } catch { /* keep prior state */ }
    setBusyItem(null);
  }

  if (!loaded) {
    return <div role="status" aria-live="polite" style={{ display: "flex", justifyContent: "center", padding: 50 }}><div className="spinner" /><span className="sr-only">Loading patient…</span></div>;
  }
  if (error) {
    return <ErrorState title={error} causes={["The patient may not exist.", "You may not have permission."]} onRetryHref="/patients" />;
  }
  if (!patient) return null;

  const verificationBadge = (v: string) => {
    if (v === "VERIFIED_BY_CLINICIAN") return <Badge tone="ok">Verified</Badge>;
    if (v === "CORRECTED_BY_CLINICIAN") return <Badge tone="info">Corrected</Badge>;
    if (v === "REJECTED_BY_CLINICIAN") return <Badge tone="bad">Rejected</Badge>;
    return <Badge tone="warn">Unreviewed</Badge>;
  };

  const renderItem = (docId: string, category: string, item: ExtractedItem, allowActions = true) => {
    const label = item.name_raw ?? item.allergen_raw ?? item.condition ?? item.diagnosis_raw ?? item.value_raw ?? item.type ?? "item";
    return (
      <li key={item.item_id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border, #eee)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong>{label}</strong>
        {item.laterality && <Badge tone="neutral">{item.laterality}</Badge>}
        {item.onset && <Badge tone="neutral">onset: {item.onset}</Badge>}
        {item.duration && <Badge tone="neutral">duration: {item.duration}</Badge>}
        {item.raw_text && <span className="text-muted" style={{ fontSize: "0.85em", flex: 1, minWidth: 160 }}>“{item.raw_text}”</span>}
        {verificationBadge(item.verification)}
        {allowActions && item.verification === "UNREVIEWED" && (
          <span style={{ display: "flex", gap: 4 }}>
            <button className="btn sm" disabled={busyItem === item.item_id} onClick={() => annotate(docId, category, item.item_id, "VERIFY")}>Verify</button>
            <button className="btn ghost sm" disabled={busyItem === item.item_id} onClick={() => annotate(docId, category, item.item_id, "REJECT")}>Reject</button>
          </span>
        )}
      </li>
    );
  };

  return (
    <div>
      <header style={{ marginBottom: 16 }}>
        <p className="text-muted" style={{ margin: 0 }}><Link href="/patients">Patients</Link> / </p>
        <h1 style={{ fontSize: "1.5rem", margin: "4px 0 0" }}>{patient.patient_ref}</h1>
        {patient.display_label && <p style={{ margin: "2px 0 0" }}>{patient.display_label}</p>}
      </header>

      {/* Encounters */}
      <section aria-label="Encounters" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1.15rem" }}>Encounters ({encounters.length})</h2>
        {encounters.length === 0 && <p className="text-muted">No encounters recorded yet.</p>}
        {encounters.map((e) => (
          <div key={e.encounter_id} style={{ padding: 12, border: "1px solid var(--border, #ddd)", borderRadius: 8, marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <strong>{new Date(e.created_at).toLocaleString()}</strong>
              <Badge tone="neutral">{e.symptoms?.length ?? 0} symptom(s)</Badge>
              <Badge tone="neutral">{e.medications?.length ?? 0} medication(s)</Badge>
              <Badge tone="neutral">{e.allergies?.length ?? 0} allergy/ies</Badge>
            </div>
            {e.chief_complaint && <p style={{ margin: "6px 0 0" }}>{e.chief_complaint}</p>}
            {e.linked_study_ids?.length > 0 && (
              <p className="text-muted" style={{ margin: "6px 0 0", fontSize: "0.9em" }}>
                Linked studies: {e.linked_study_ids.map((sid) => <Link key={sid} href={`/result?study=${sid}`} style={{ marginRight: 8 }}>{sid}</Link>)}
              </p>
            )}
            {(() => {
              const pkg = e.linked_study_ids?.length ? recordPackages[e.linked_study_ids[0]] : undefined;
              const urgency = pkg?.stages?.urgency as unknown as { result?: { priority?: string } } | undefined;
              return urgency?.result?.priority ? (
                <div style={{ marginTop: 8 }}>
                  <TriageBadge priority={urgency.result.priority} />
                </div>
              ) : null;
            })()}
          </div>
        ))}

        <div style={{ padding: 12, border: "1px dashed var(--border, #ccc)", borderRadius: 8, marginTop: 8 }}>
          <h3 style={{ fontSize: "1rem", margin: "0 0 8px" }}>New encounter</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder="Chief complaint (optional)"
              value={newEncounter.chief_complaint}
              onChange={(e) => setNewEncounter({ ...newEncounter, chief_complaint: e.target.value })}
              aria-label="Chief complaint"
              style={{ flex: 2, minWidth: 220 }}
            />
            <input
              placeholder="Linked study IDs (comma-separated)"
              value={newEncounter.linked}
              onChange={(e) => setNewEncounter({ ...newEncounter, linked: e.target.value })}
              aria-label="Linked study IDs"
              style={{ flex: 2, minWidth: 220 }}
            />
            <button className="btn primary sm" onClick={createEncounter}>Create</button>
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section aria-label="Study timeline" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1.15rem" }}>Study timeline</h2>
        {!timeline || timeline.events.length === 0 ? (
          <p className="text-muted">No linked studies yet.</p>
        ) : (
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {timeline.events.map((ev) => (
              <li key={ev.study_id} style={{ margin: "6px 0" }}>
                <Link href={`/result?study=${ev.study_id}`}>{ev.study_id}</Link>{" "}
                <span className="text-muted">— {ev.modality} · {ev.laterality_scope} · {new Date(ev.timestamp).toLocaleDateString()}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Automatic extractions */}
      <section aria-label="Automatically extracted record data" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1.15rem" }}>Automatically extracted from documents</h2>
        <p className="text-muted" style={{ fontSize: "0.9em" }}>
          Everything below was extracted automatically from uploaded clinical documents and is UNREVIEWED until verified.
          Rejected items stay visible for audit but are excluded from downstream analysis.
        </p>
        {Object.keys(extractions).length === 0 && <p className="text-muted">No document extractions available for this patient&apos;s studies.</p>}
        {Object.entries(extractions).map(([docId, ext]) => (
          <div key={docId} style={{ padding: 12, border: "1px solid var(--border, #ddd)", borderRadius: 8, marginBottom: 12 }}>
            <h3 style={{ fontSize: "1rem", margin: "0 0 8px" }}>Document {docId} <Badge tone="neutral">{ext.status}</Badge></h3>
            {ext.chief_complaint && (
              <div style={{ marginBottom: 10 }}>
                <h4 style={{ margin: "8px 0 4px", fontSize: "0.95rem" }}>Chief complaint (document-extracted)</h4>
                {renderItem(docId, "chief_complaint", ext.chief_complaint, false)}
              </div>
            )}
            {([
              ["symptoms", "Symptoms"],
              ["medications", "Medications"],
              ["allergies", "Allergies"],
              ["systemic_candidates", "Systemic history"],
              ["explicit_negations", "Documented negations"],
              ["source_document_diagnoses", "Source-document diagnoses (not VisionScan diagnoses)"],
              ["ocular_history_candidates", "Ocular history candidates"],
              ["family_history_candidates", "Family history candidates"],
              ["exam_findings", "Exam findings (document-extracted)"],
            ] as Array<[string, string]>).map(([cat, title]) => {
              const items = (ext as unknown as Record<string, ExtractedItem[]>)[cat] ?? [];
              if (items.length === 0) return null;
              return (
                <div key={cat} style={{ marginBottom: 10 }}>
                  <h4 style={{ margin: "8px 0 4px", fontSize: "0.95rem" }}>{title}</h4>
                  <ul style={{ margin: 0, paddingLeft: 16, listStyle: "none" }}>
                    {items.map((it) => renderItem(docId, cat, it))}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </section>

      {/* Limitations */}
      <section aria-label="Limitations" style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: "1.15rem" }}>Limitations</h2>
        <ul style={{ paddingLeft: 20 }}>
          {(Object.values(recordPackages)[0]?.limitations ?? [
            "This workspace is research/decision-support material, not a diagnosis.",
            "Extracted data requires clinician verification before any clinical use.",
          ]).map((l, i) => <li key={i} className="text-muted">{l}</li>)}
        </ul>
      </section>
    </div>
  );
}
