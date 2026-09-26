"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Accessible modal dialog used for confirmations and short structured
 * inputs (replaces window.prompt / window.confirm on clinical surfaces).
 * - role="dialog" + aria-modal, labelled by its heading
 * - focus moves into the dialog, Tab is trapped, Escape cancels,
 *   focus returns to the previously focused element on close
 * - required fields block submission until filled
 */

export interface DialogField {
  name: string;
  label: string;
  initial?: string;
  multiline?: boolean;
  required?: boolean;
  hint?: string;
  maxLength?: number;
  options?: Array<[string, string]>;
}

export interface DialogRequest {
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  tone?: "default" | "danger" | "authority";
  fields?: DialogField[];
}

export function useDialog() {
  const [request, setRequest] = useState<(DialogRequest & { resolve: (v: Record<string, string> | null) => void }) | null>(null);
  function ask(req: DialogRequest): Promise<Record<string, string> | null> {
    return new Promise((resolve) => setRequest({ ...req, resolve }));
  }
  const element = request ? (
    <Dialog
      request={request}
      onClose={(values) => { request.resolve(values); setRequest(null); }}
    />
  ) : null;
  return { ask, element };
}

function Dialog({ request, onClose }: { request: DialogRequest; onClose: (values: Record<string, string> | null) => void }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries((request.fields ?? []).map((f) => [f.name, f.initial ?? ""])),
  );
  const missing = (request.fields ?? []).filter((f) => f.required && !values[f.name]?.trim());

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, select, button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(null); return; }
      if (e.key !== "Tab") return;
      const focusable = Array.from(ref.current?.querySelectorAll<HTMLElement>("input, textarea, select, button:not([disabled])") ?? []);
      if (!focusable.length) return;
      const firstEl = focusable[0], lastEl = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus(); };
    // Installed once per open dialog; onClose is read through the latest render's closure via state reset on close.
  }, []);

  let confirmClass = "btn";
  if (request.tone === "danger") confirmClass = "btn solid-danger";
  else if (request.tone === "authority") confirmClass = "btn authority";

  function setField(name: string, value: string): void {
    setValues({ ...values, [name]: value });
  }

  return (
    <div className="dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(null); }}>
      <div ref={ref} className={`dialog${request.tone && request.tone !== "default" ? ` tone-${request.tone}` : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{request.title}</h2>
        {request.body && <div className="dialog-body">{request.body}</div>}
        <form
          onSubmit={(e) => { e.preventDefault(); if (missing.length === 0) onClose(values); }}
        >
          {(request.fields ?? []).map((field) => {
            const id = `${titleId}-${field.name}`;
            return (
              <div className="field" key={field.name}>
                <label htmlFor={id}>{field.label}{field.required ? " (required)" : ""}</label>
                {field.options ? (
                  <select id={id} value={values[field.name]} onChange={(e) => setField(field.name, e.target.value)}>
                    {field.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                ) : field.multiline ? (
                  <textarea id={id} rows={3} value={values[field.name]} maxLength={field.maxLength ?? 1000} onChange={(e) => setField(field.name, e.target.value)} />
                ) : (
                  <input id={id} value={values[field.name]} maxLength={field.maxLength ?? 200} onChange={(e) => setField(field.name, e.target.value)} />
                )}
                {field.hint && <div className="field-hint">{field.hint}</div>}
              </div>
            );
          })}
          <div className="dialog-actions">
            <button type="button" className="btn secondary" onClick={() => onClose(null)}>Cancel</button>
            <button type="submit" className={confirmClass} disabled={missing.length > 0}>{request.confirmLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
