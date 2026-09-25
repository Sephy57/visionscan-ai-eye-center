"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge, EmptyState, PageHeader, shortId } from "@/components/ui";
import { Icon } from "@/components/icons";
import { authFetch } from "@/lib/auth/clientFetch";
import { useDialog } from "@/components/Dialog";
import { DASHBOARD_STATUS_META as STATUS_META } from "@/lib/reports/terminology";

interface StudyRow {
  study_id: string; created_at: string; modality: string; eye: string; status: string;
  dashboard_status?: string;
}

const FILTER_TO_STATUS: Record<string, string> = {
  urgent: "URGENT_REVIEW",
  correlation: "CLINICAL_CORRELATION_REQUIRED",
  review: "REVIEW_REQUIRED",
  "model-failed": "MODEL_FAILED",
  unsupported: "UNSUPPORTED_MODALITY",
  "quality-blocked": "IMAGE_NOT_SUITABLE",
  "out-of-distribution": "OUT_OF_DISTRIBUTION",
};

/** Grouped filters linked from the dashboard counts; each matches that count's exact status set. */
const GROUP_FILTERS: Record<string, { label: string; statuses: string[] }> = {
  awaiting: { label: "Awaiting review", statuses: ["URGENT_REVIEW", "CLINICAL_CORRELATION_REQUIRED", "REVIEW_REQUIRED"] },
  attention: { label: "Needs attention", statuses: ["MODEL_FAILED", "IMAGE_NOT_SUITABLE", "UNSUPPORTED_MODALITY", "OUT_OF_DISTRIBUTION"] },
};

export default function HistoryPage() {
  return (
    <Suspense fallback={<div className="page-loading" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" />Loading history…</div>}>
      <HistoryInner />
    </Suspense>
  );
}

function HistoryInner() {
  const [rows, setRows] = useState<StudyRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const filter = searchParams.get("filter");
  const group = filter ? GROUP_FILTERS[filter] : undefined;
  const filterStatus = filter ? FILTER_TO_STATUS[filter] : undefined;
  const filterStatuses = group ? group.statuses : filterStatus ? [filterStatus] : null;
  const filterLabel = group ? group.label : filterStatus ? STATUS_META[filterStatus]?.label ?? filter : null;
  const dialog = useDialog();

  async function load(cursor?: string, append = false) {
    if (append) setLoadingMore(true);
    try {
      const search = new URLSearchParams({ with_status: "1", limit: "50" });
      if (cursor) search.set("cursor", cursor);
      const res = await fetch(`/api/studies?${search.toString()}`);
      if (!res.ok) throw new Error("history unavailable");
      const json = await res.json();
      setRows((previous) => append ? [...previous, ...(json.studies ?? [])] : (json.studies ?? []));
      setNextCursor(typeof json.next_cursor === "string" ? json.next_cursor : null);
      setHasMore(json.has_more === true);
      setLoaded(true);
    } finally {
      setLoadingMore(false);
    }
  }
  useEffect(() => { load().catch(() => { setError("Could not load studies."); setLoaded(true); }); }, []);

  const visibleRows = filterStatuses ? rows.filter((r) => filterStatuses.includes(r.dashboard_status ?? "")) : rows;

  async function remove(id: string) {
    const ok = await dialog.ask({
      title: "Permanently delete this study?",
      tone: "danger",
      body: <>Study <code>{id}</code>, its analysis, report, and stored original image will be deleted. This cannot be undone. The deletion is recorded in the audit trail (metadata only).</>,
      confirmLabel: "Delete study",
    });
    if (!ok) return;
    const res = await authFetch(`/api/studies/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) load(); else setError("Delete failed");
  }

  const statusBadge = (status?: string) => {
    const meta = status ? STATUS_META[status] : undefined;
    return <Badge tone={meta?.tone ?? "neutral"}>{meta?.label ?? "Uploaded"}</Badge>;
  };

  return (
    <div>
      {dialog.element}
      <PageHeader
        eyebrow="Clinical workspace"
        title="Studies & History"
        lede="Every study stored in this local workspace. Originals are preserved unchanged and every analysis is auditable."
        actions={<Link className="btn" href="/analyze"><Icon name="plus" size={14} /> New Analysis</Link>}
      />

      <nav aria-label="Filter studies by status" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        <Link className={`chip${!filterStatuses ? " selected" : ""}`} href="/history" aria-current={!filterStatuses ? "page" : undefined}>All</Link>
        {group && <span className="chip selected" aria-current="page">{group.label}</span>}
        {Object.entries(FILTER_TO_STATUS).map(([key, status]) => (
          <Link key={key} className={`chip${filterStatus === status ? " selected" : ""}`} href={`/history?filter=${key}`} aria-current={filterStatus === status ? "page" : undefined}>
            {STATUS_META[status]?.label ?? key}
          </Link>
        ))}
      </nav>

      {filterStatuses && loaded && (
        <p className="small muted" style={{ margin: "0 0 12px" }}>
          Showing <strong>{visibleRows.length}</strong> loaded {visibleRows.length === 1 ? "study" : "studies"} with status “{filterLabel}”.{hasMore ? " Load more to include older studies." : ""}
        </p>
      )}

      {error && <div className="alert danger" role="alert"><span className="alert-icon" aria-hidden="true"><Icon name="warning" size={16} /></span><div className="alert-body"><strong>Studies could not be loaded or changed</strong>{error}</div></div>}

      {!loaded && <div className="loading-row" role="status" aria-live="polite"><span className="pulse-dot" aria-hidden="true" /> Loading studies…</div>}

      {loaded && visibleRows.length === 0 && (
        <EmptyState icon={<Icon name="eye" size={22} />} title={filterStatuses ? "No studies match this filter" : "No analyses yet"}
          action={<Link className="btn" href={filterStatuses ? "/history" : "/analyze"}>{filterStatuses ? "Show all studies" : "Start a new analysis"}</Link>}>
          {filterStatuses
            ? "No loaded study currently has this status."
            : "Start a new ophthalmic imaging analysis to begin building a reviewable history."}
        </EmptyState>
      )}

      {loaded && visibleRows.length > 0 && (
        <div className="card flush">
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Studies">
            <table className="table">
              <caption className="sr-only">Stored studies</caption>
              <thead>
                <tr><th scope="col">Date</th><th scope="col">Study</th><th scope="col">Eye</th><th scope="col">Modality</th><th scope="col">Status</th><th scope="col" className="actions">Actions</th></tr>
              </thead>
              <tbody>
                {visibleRows.map((s) => (
                  <tr key={s.study_id}>
                    <td className="small num">{new Date(s.created_at).toLocaleDateString()}</td>
                    <td><span className="id-cell" title={s.study_id}>{shortId(s.study_id, 18)}</span></td>
                    <td>{s.eye}</td>
                    <td>{s.modality.replaceAll("_", " ")}</td>
                    <td>{statusBadge(s.dashboard_status)}</td>
                    <td className="actions">
                      <Link className="btn ghost sm" href={`/result?study=${encodeURIComponent(s.study_id)}`}>Result</Link>{" "}
                      <Link className="btn ghost sm" href={`/clinician?study=${encodeURIComponent(s.study_id)}`}>Review</Link>{" "}
                      <Link className="btn ghost sm" href={`/report?study=${encodeURIComponent(s.study_id)}`}>Report</Link>{" "}
                      <Link className="btn ghost sm" href={`/compare?current=${encodeURIComponent(s.study_id)}`}>Compare</Link>{" "}
                      <button className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={() => remove(s.study_id)} aria-label={`Delete study ${s.study_id}`}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && nextCursor && (
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
              <button className="btn secondary sm" onClick={() => load(nextCursor, true)} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more studies"}
              </button>
            </div>
          )}
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: 12 }}>
        A change between scans does not automatically mean disease progression. Interpretation requires a
        qualified professional and validated quantitative algorithms.
      </p>
    </div>
  );
}
