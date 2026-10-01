"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icons";
import { classifySourceResponse, SOURCE_STATE_COPY, type SourceAvailabilityResult } from "@/lib/imaging/sourceAvailability";
import { boxToPercentStyle, clipToUnit, isBoundedBox, labelPlacement, needsLocator, type NormalizedBox } from "@/lib/imaging/overlayGeometry";
import { resolveViewMode, selectionKeyFor, type ViewChoice, type ViewMode } from "@/lib/imaging/viewerMode";
import type { ViewerAnalysisState } from "@/lib/imaging/viewerAnalysisState";

/**
 * Ophthalmic imaging viewer.
 *
 * Pixel fidelity: the scan is rendered as a plain <img> with no CSS filters —
 * dark mode and themes never touch the image pixels.
 *
 * Overlay architecture: rendering layers for bounding boxes / markers /
 * masks / heatmaps exist for provenance-bearing model output.  An overlay is
 * never fabricated: callers pass only actual, bounded localization data and
 * their surrounding UI must show its research/validation state.
 *
 * Boxes are fractions of the ORIGINAL image drawn inside a wrapper that is
 * exactly the displayed image size, so they stay on the same anatomy at every
 * viewport size and zoom.  A region too small to see on screen additionally
 * gets a locator ring; the ring is an aid, the dashed box is the true extent.
 */

export interface Localization {
  id: string;
  finding_id?: string;
  kind: "bounding_box" | "mask" | "marker" | "heatmap";
  coordinates?: { x: number; y: number; w: number; h: number };
  data_ref?: string;
  priority?: "high" | "moderate" | "low";
  note?: string;
}

export interface ScanViewerProps {
  src: string;
  alt: string;
  region?: { x: number; y: number; w: number; h: number } | null; // simple demo highlight
  regionLabel?: string;
  localizations?: Localization[];      // validated-model overlays (none today)
  /** Id of the localization to emphasise (e.g. after "View on scan"). */
  highlightedId?: string | null;
  /** Changes on every explicit request to show a region, so asking again for the same one still returns to the overlay. */
  selectionNonce?: number;
  overlayStatus?: "CLINICALLY_VALIDATED" | "RESEARCH" | "CANDIDATE_ONLY" | "DEMO";
  infoOverlay?: { eye?: string; modality?: string; analysisLabel?: string };
  overlayUnavailableNote?: string;
  /** What the analysis behind this viewer did; shown whether or not anything is drawn. */
  analysisState?: ViewerAnalysisState;
  /** Classification-only model output (e.g. OCT class): no pixel localization exists and none is drawn. */
  classificationOnly?: boolean;
  /** Shown with a missing/unavailable source when derived evidence (e.g. PDF OCT regions) still exists. Never a substitute image. */
  derivativeNote?: string;
  showToolbar?: boolean;
  viewerId?: string;
  // Controlled mode (used by Compare for synchronized zoom/pan)
  zoom?: number;
  onZoomChange?: (z: number) => void;
  onReset?: () => void;
}

/** One box to draw: a localization or the single highlighted `region`, drawn identically. */
interface DrawItem {
  id: string;
  box: NormalizedBox;
  note?: string;
  priority: "high" | "moderate" | "low";
  active: boolean;
}

const ORIGINAL_PANE_LABEL = "Original scan — unmodified pixels";

export default function ScanViewer({
  src, alt, region = null, regionLabel = "AI-highlighted region",
  localizations, highlightedId = null, selectionNonce = 0, infoOverlay, overlayUnavailableNote = "No validated localization data available.",
  overlayStatus, analysisState, classificationOnly = false, derivativeNote, showToolbar = true, viewerId, zoom: controlledZoom, onZoomChange, onReset,
}: ScanViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const statusId = useId();

  const [internalZoom, setInternalZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [paneWidth, setPaneWidth] = useState(0);
  // Overlays are drawn only once the original itself has loaded: a missing
  // or unavailable source must never look as if the image were there.
  // Keyed by the src it describes, so a new src reads as CHECKING without a
  // reset effect (an effect could overwrite an onLoad that already fired
  // for a cached image and leave the viewer stuck "loading").
  const [sourceFor, setSourceFor] = useState<{ src: string; result: SourceAvailabilityResult } | null>(null);
  const source: SourceAvailabilityResult = sourceFor?.src === src ? sourceFor.result : { state: "CHECKING" };
  const setSource = (result: SourceAvailabilityResult) => setSourceFor({ src, result });
  const failed = source.state === "SOURCE_MISSING" || source.state === "SOURCE_UNAVAILABLE";
  const sourceShown = source.state === "SOURCE_AVAILABLE";
  const diagnoseLoadFailure = () => {
    const probed = src;
    // A slow probe for an old src must not overwrite the state of a newer one.
    const settle = (result: SourceAvailabilityResult) => setSourceFor((current) => (current && current.src !== probed ? current : { src: probed, result }));
    fetch(probed, { cache: "no-store" })
      .then(async (response) => {
        const code = response.ok ? null : await response.json().then((j: { error?: string }) => j.error ?? null).catch(() => null);
        const result = classifySourceResponse(response.status, code, response.headers.get("content-type"));
        // The request succeeded but the browser could not decode the bytes.
        settle(result.state === "SOURCE_AVAILABLE" ? { state: "SOURCE_UNAVAILABLE", reason: "not_an_image" } : result);
      })
      .catch(() => settle(classifySourceResponse(null)));
  };

  const zoom = controlledZoom ?? internalZoom;
  const setZoom = useCallback((z: number) => {
    const clamped = Math.min(8, Math.max(0.5, z));
    if (onZoomChange) onZoomChange(clamped);
    else setInternalZoom(clamped);
  }, [onZoomChange]);
  const zoomBy = (factor: number) => setZoom(zoom * factor);

  // ---- what can actually be drawn --------------------------------------
  const localizationCount = localizations?.length ?? 0;
  const renderableOverlays = (localizations ?? []).filter((loc): loc is Localization & { coordinates: NormalizedBox } => loc.kind === "bounding_box" && isBoundedBox(loc.coordinates));
  const overlayStatusMissing = localizationCount > 0 && !overlayStatus;
  const hasRenderableOverlays = renderableOverlays.length > 0 && !overlayStatusMissing && sourceShown;
  const unsupportedOverlayCount = Math.max(0, localizationCount - renderableOverlays.length);
  const boundedRegion = region && isBoundedBox(region) && sourceShown ? clipToUnit(region) : null;
  const overlayStatusText = overlayStatus?.replaceAll("_", " ");
  const drawItems: DrawItem[] = [
    ...(hasRenderableOverlays ? renderableOverlays.map((loc) => ({ id: loc.id, box: clipToUnit(loc.coordinates), note: loc.note, priority: loc.priority ?? "moderate", active: highlightedId === loc.id })) : []),
    // The single highlighted region is drawn like any localization; a missing
    // status is disclosed on its label rather than left implied.
    ...(boundedRegion ? [{ id: "viewer-region", box: boundedRegion, note: `${regionLabel} (${overlayStatusText ?? "status not provided"})`, priority: "moderate" as const, active: false }] : []),
  ];
  const hasAnyOverlay = drawItems.length > 0;
  const overlayIssue = overlayStatusMissing
    ? "Overlay hidden because its validation/research status was not provided."
    : renderableOverlays.length > 0 && !sourceShown
      ? (source.state === "CHECKING" ? "Overlay will appear once the original image has loaded." : "Overlay unavailable: the original image could not be shown.")
      : unsupportedOverlayCount > 0
        ? `${unsupportedOverlayCount} localization layer${unsupportedOverlayCount === 1 ? " is" : "s are"} unavailable because no compatible, bounded geometry was supplied.`
        : overlayUnavailableNote;

  // ---- view mode --------------------------------------------------------
  const selectionKey = selectionKeyFor(highlightedId, region, selectionNonce);
  const [choice, setChoice] = useState<ViewChoice | null>(null);
  const viewMode: ViewMode = resolveViewMode(hasAnyOverlay, choice, selectionKey);
  const chooseMode = (mode: ViewMode) => { if (mode === "original" || hasAnyOverlay) setChoice({ mode, key: selectionKey }); };

  // ---- fitting ----------------------------------------------------------
  // Measuring only sets the fitted size; resetting zoom and pan is an explicit
  // act (Fit, Reset, a new image), never a side effect of a window resize.
  const measureFit = useCallback(() => {
    const vp = viewportRef.current, img = imgRef.current;
    if (!vp || !img || !img.naturalWidth) return;
    const pad = 14;
    const pane = vp.querySelector<HTMLElement>(".viewer-pane");
    const fitWidth = pane?.clientWidth ?? vp.clientWidth;
    const fitHeight = pane?.clientHeight ?? vp.clientHeight;
    if (fitWidth <= pad || fitHeight <= pad) return; // hidden or collapsed: keep the last good fit
    const scale = Math.min((fitWidth - pad) / img.naturalWidth, (fitHeight - pad) / img.naturalHeight, 1);
    setPaneWidth(fitWidth);
    setImgSize({ w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
  }, []);
  const fitToScreen = useCallback(() => {
    measureFit();
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [measureFit, setZoom]);

  // The pane width changes with the mode (side-by-side halves it).
  useEffect(() => { measureFit(); }, [viewMode, measureFit]);

  // An image that finished loading before React attached onLoad (hydration,
  // cache) would otherwise leave the viewer waiting for an event that already fired.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      setSourceFor((current) => current?.src === src && current.result.state !== "CHECKING" ? current : { src, result: { state: "SOURCE_AVAILABLE" } });
      measureFit();
    }
  }, [src, measureFit]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measureFit);
    });
    observer.observe(viewport);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [measureFit]);

  const actualSize = () => {
    const img = imgRef.current;
    if (!img?.naturalWidth || !imgSize.w) return;
    setZoom(img.naturalWidth / imgSize.w);
    setOffset({ x: 0, y: 0 });
  };

  const onWheel = (e: React.WheelEvent) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); };
  const onPointerDown = (e: React.PointerEvent) => {
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => { if (dragging) setOffset((o) => ({ x: o.x + e.movementX, y: o.y + e.movementY })); };
  const onPointerUp = () => setDragging(false);

  const fullscreen = () => {
    const el = viewportRef.current?.parentElement;
    if (!document.fullscreenElement) el?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  const failureCopy = failed
    ? SOURCE_STATE_COPY[source.state as "SOURCE_MISSING" | "SOURCE_UNAVAILABLE"][source.reason ?? "service_error"]
      ?? SOURCE_STATE_COPY.SOURCE_UNAVAILABLE.service_error
    : null;
  let sourceBadge: { tone: string; glyph: string; label: string };
  switch (source.state) {
    case "SOURCE_AVAILABLE":
      sourceBadge = { tone: "ok", glyph: "●", label: "Source available · original" };
      break;
    case "SOURCE_MISSING":
      sourceBadge = { tone: "bad", glyph: "○", label: "Source missing" };
      break;
    case "SOURCE_UNAVAILABLE":
      sourceBadge = { tone: "bad", glyph: "○", label: "Source unavailable" };
      break;
    default:
      sourceBadge = { tone: "pending", glyph: "◌", label: "Loading original…" };
  }

  const locatorCount = drawItems.filter((item) => needsLocator(item.box, imgSize, zoom)).length;

  const renderPane = (showLayers: boolean, paneLabel: string, primary: boolean, accessibleLabel = paneLabel) => (
    <div className="viewer-pane" role="group" aria-label={accessibleLabel}>
      <span className="viewer-hint">{paneLabel}</span>
      <div
        className="viewer-img-wrap"
        style={{
          transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
          width: imgSize.w || undefined, height: imgSize.h || undefined,
          ["--viewer-zoom" as string]: zoom,
        }}
      >
        <img
          ref={primary ? imgRef : undefined}
          src={src}
          alt={primary ? alt : ""}
          aria-hidden={primary ? undefined : true}
          draggable={false}
          // The original is the page's main content; deferring it would hold
          // every overlay back until the viewer happened to scroll into view.
          loading={primary ? "eager" : "lazy"}
          decoding="async"
          style={{ width: imgSize.w || "auto", height: imgSize.h || "auto" }}
          onLoad={primary ? () => { setSource({ state: "SOURCE_AVAILABLE" }); fitToScreen(); } : undefined}
          onError={primary ? diagnoseLoadFailure : undefined}
        />
        {showLayers && imgSize.w > 0 && drawItems.map((item) => {
          const ringed = needsLocator(item.box, imgSize, zoom);
          const placement = labelPlacement({ box: item.box, paneWidth, fitted: imgSize, zoom, offsetX: offset.x, ringed });
          const classes = [
            "viewer-overlay-box", `loc-${item.priority}`,
            placement.end ? "label-end" : "",
            ringed ? "has-locator" : "",
            item.box.y + item.box.h / 2 > 0.85 ? "label-up" : "",
            item.active ? "is-active" : "",
          ].filter(Boolean).join(" ");
          return (
            <div key={item.id} className={classes} data-localization-id={item.id} style={{ ...boxToPercentStyle(item.box), position: "absolute", ["--label-room" as string]: `${Math.round(placement.room)}px` }}>
              {ringed && <span className="viewer-locator" aria-hidden="true" />}
              {item.note && <span className="viewer-label">{item.note}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );

  const regionsDrawn = drawItems.length;
  const overlayAccessibleLabel = `Overlay view — original pixels unchanged · ${regionsDrawn} region${regionsDrawn === 1 ? "" : "s"} drawn`;

  let statusNote: React.ReactNode;
  if (hasAnyOverlay) {
    statusNote = (
      <span className="viewer-legend">
        <span className="viewer-layer-status"><span className="legend-swatch" aria-hidden="true" />{hasRenderableOverlays ? `${overlayStatusText} overlay · ${renderableOverlays.length} region${renderableOverlays.length === 1 ? "" : "s"}` : regionLabel}</span>
        <span>Boxes are research localizations, not diagnoses.</span>
        {viewMode !== "original" && locatorCount > 0 && <span>{locatorCount === 1 ? "A ring marks a region" : `${locatorCount} rings mark regions`} too small to see at this zoom; the dashed box is the true extent.</span>}
      </span>
    );
  } else {
    statusNote = <span>{classificationOnly ? "No overlay: classification-only output" : overlayIssue}</span>;
  }

  return (
    <div className="viewer-frame" id={viewerId} data-source-state={source.state} data-view-mode={viewMode} data-analysis-state={analysisState?.code}>
      {/* Image info overlay — rendered AROUND the scan, never burned into pixels */}
      {infoOverlay && (
        <div className="viewer-info">
          {infoOverlay.eye && <span className="viewer-info-chip">{infoOverlay.eye}</span>}
          {infoOverlay.modality && <span className="viewer-info-chip">{infoOverlay.modality}</span>}
          {infoOverlay.analysisLabel && <span className="viewer-info-chip viewer-info-warn">{infoOverlay.analysisLabel}</span>}
        </div>
      )}

      <div
        ref={viewportRef}
        className={`viewer-viewport${dragging ? " dragging" : ""}${viewMode === "side_by_side" ? " side-by-side" : ""}${failed ? " failed" : ""}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        role="group"
        aria-label={`Interactive scan viewer: ${alt}`}
        tabIndex={0}
        onKeyDown={(e) => {
          // Browser shortcuts (Ctrl +/-/0 page zoom) are not the viewer's to take.
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          const handled = ["+", "=", "-", "0", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key);
          if (handled) e.preventDefault();
          if (e.key === "+" || e.key === "=") zoomBy(1.2);
          if (e.key === "-") zoomBy(1 / 1.2);
          if (e.key === "0") fitToScreen();
          const step = 20;
          if (e.key === "ArrowLeft") setOffset((o) => ({ ...o, x: o.x + step }));
          if (e.key === "ArrowRight") setOffset((o) => ({ ...o, x: o.x - step }));
          if (e.key === "ArrowUp") setOffset((o) => ({ ...o, y: o.y + step }));
          if (e.key === "ArrowDown") setOffset((o) => ({ ...o, y: o.y - step }));
        }}
      >
        {viewMode === "side_by_side" ? (
          <>{renderPane(false, ORIGINAL_PANE_LABEL, true)}{renderPane(true, "Overlay — annotations rendered separately", false)}</>
        ) : viewMode === "overlay"
          ? renderPane(true, "Overlay view — original pixels unchanged", true, overlayAccessibleLabel)
          : renderPane(false, ORIGINAL_PANE_LABEL, true)}
        {failureCopy && (
          <div className="viewer-failed" role="alert">
            <Icon name="warning" size={18} />
            <strong>{failureCopy.title}</strong>
            <span>{failureCopy.body}</span>
            {derivativeNote && <span className="viewer-derivative"><strong>Derivative available:</strong> {derivativeNote}</span>}
          </div>
        )}
      </div>

      {analysisState && (
        <div className={`viewer-state tone-${analysisState.tone}`} role="status" data-state-code={analysisState.code}>
          <strong>{analysisState.headline}</strong>
          <span>
            {analysisState.detail}
            {failed && analysisState.code === "SIGNALS_FOUND" ? " They are not drawn because the original image is unavailable." : ""}
          </span>
          {analysisState.provenance.length > 0 && (
            <dl className="viewer-prov" aria-label="Analysis provenance">
              {analysisState.provenance.map((fact) => (
                <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
              ))}
            </dl>
          )}
        </div>
      )}

      {showToolbar && (
        <>
          <div className="viewer-toolbar" role="toolbar" aria-label="Viewer controls">
            <button className="vbtn" onClick={fitToScreen} title="Fit image to viewer (0)"><Icon name="fit" size={13} /> Fit</button>
            <button className="vbtn" onClick={actualSize} aria-label="Actual size" title="Actual size (shows the image's own pixels where the zoom limit allows)">1:1</button>
            <button className="vbtn" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in (+)"><Icon name="plus" size={13} /></button>
            <button className="vbtn" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out" title="Zoom out (−)"><Icon name="minus" size={13} /></button>
            <button className="vbtn" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); onReset?.(); }} title="Reset zoom and pan"><Icon name="reset" size={13} /> Reset</button>
            <span className="tb-sep" aria-hidden="true" />
            <button className={`vbtn${viewMode === "original" ? " on" : ""}`} onClick={() => chooseMode("original")} aria-pressed={viewMode === "original"}>Original</button>
            {/* aria-disabled (not disabled) keeps the control focusable so its reason is reachable by keyboard. */}
            <button className={`vbtn${viewMode === "overlay" ? " on" : ""}`} onClick={() => chooseMode("overlay")} aria-pressed={viewMode === "overlay"} aria-disabled={!hasAnyOverlay} aria-describedby={hasAnyOverlay ? undefined : statusId} title={!hasAnyOverlay ? overlayIssue : "Show research overlay on the original scan"}>Research overlay</button>
            <button className={`vbtn${viewMode === "side_by_side" ? " on" : ""}`} onClick={() => chooseMode("side_by_side")} aria-pressed={viewMode === "side_by_side"} aria-disabled={!hasAnyOverlay} aria-describedby={hasAnyOverlay ? undefined : statusId} title={!hasAnyOverlay ? overlayIssue : "Compare original and annotated views"}>Side-by-side</button>
            <span className="spacer" />
            <button className="vbtn" onClick={fullscreen} aria-label="Fullscreen"><Icon name="fullscreen" size={13} /> Fullscreen</button>
          </div>
          <div className="viewer-status">
            <span className={`viewer-source ${sourceBadge.tone}`}>
              <span aria-hidden="true">{sourceBadge.glyph}</span>
              {sourceBadge.label}
            </span>
            <span id={statusId} className="viewer-status-note">{statusNote}</span>
            <span className="spacer" style={{ flex: 1 }} />
            <span className="readout">Zoom {Math.round(zoom * 100)}% · pan {Math.round(offset.x)}, {Math.round(offset.y)}</span>
          </div>
          {classificationOnly && (
            <div className="classification-only" role="note">
              <Icon name="info" size={15} />
              <span><strong>CLASSIFICATION ONLY · NO PIXEL-LEVEL LOCALIZATION AVAILABLE</strong>
                The model returns an image-level class estimate. No region, heatmap, or saliency map is produced, and none is drawn.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
