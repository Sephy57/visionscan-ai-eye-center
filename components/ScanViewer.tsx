"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

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
  overlayStatus?: "CLINICALLY_VALIDATED" | "RESEARCH" | "CANDIDATE_ONLY" | "DEMO";
  infoOverlay?: { eye?: string; modality?: string; analysisLabel?: string };
  overlayUnavailableNote?: string;
  /** Classification-only model output (e.g. OCT class): no pixel localization exists and none is drawn. */
  classificationOnly?: boolean;
  showToolbar?: boolean;
  viewerId?: string;
  // Controlled mode (used by Compare for synchronized zoom/pan)
  zoom?: number;
  onZoomChange?: (z: number) => void;
  onReset?: () => void;
}

export default function ScanViewer({
  src, alt, region = null, regionLabel = "AI-highlighted region",
  localizations, infoOverlay, overlayUnavailableNote = "No validated localization data available.",
  overlayStatus, classificationOnly = false, showToolbar = true, viewerId, zoom: controlledZoom, onZoomChange, onReset,
}: ScanViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [internalZoom, setInternalZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [viewMode, setViewMode] = useState<"original" | "overlay" | "side_by_side">((localizations?.length ?? 0) > 0 || region ? "overlay" : "original");

  const zoom = controlledZoom ?? internalZoom;
  const setZoom = (z: number) => {
    const clamped = Math.min(8, Math.max(0.5, z));
    if (onZoomChange) onZoomChange(clamped);
    else setInternalZoom(clamped);
  };

  const fitToScreen = useCallback(() => {
    const vp = viewportRef.current, img = imgRef.current;
    if (!vp || !img || !img.naturalWidth) return;
    const pad = 14;
    const pane = vp.querySelector<HTMLElement>(".viewer-pane");
    const paneWidth = pane?.clientWidth ?? vp.clientWidth;
    const paneHeight = pane?.clientHeight ?? vp.clientHeight;
    const scale = Math.min((paneWidth - pad) / img.naturalWidth, (paneHeight - pad) / img.naturalHeight, 1);
    setImgSize({ w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [loaded, viewMode]);

  useEffect(() => { fitToScreen(); }, [fitToScreen, loaded]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitToScreen);
    });
    observer.observe(viewport);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [fitToScreen]);

  const zoomBy = (factor: number) => setZoom(zoom * factor);

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

  const boundedBox = (box: Localization["coordinates"]): box is NonNullable<Localization["coordinates"]> =>
    !!box && [box.x, box.y, box.w, box.h].every(Number.isFinite) && box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0 && box.x + box.w <= 1 && box.y + box.h <= 1;
  const renderableOverlays = (localizations ?? []).filter((loc) => loc.kind === "bounding_box" && boundedBox(loc.coordinates));
  const overlayStatusMissing = (localizations?.length ?? 0) > 0 && !overlayStatus;
  const hasRenderableOverlays = renderableOverlays.length > 0 && !overlayStatusMissing && !failed;
  const unsupportedOverlayCount = Math.max(0, (localizations?.length ?? 0) - renderableOverlays.length);
  const boundedRegion = region && boundedBox(region) && !failed ? region : null;
  const hasAnyOverlay = hasRenderableOverlays || boundedRegion !== null;
  const overlayIssue = overlayStatusMissing
    ? "Overlay hidden because its validation/research status was not provided."
    : unsupportedOverlayCount > 0
      ? `${unsupportedOverlayCount} localization layer${unsupportedOverlayCount === 1 ? " is" : "s are"} unavailable because no compatible, bounded geometry was supplied.`
      : overlayUnavailableNote;
  const regionStyle: React.CSSProperties | null = boundedRegion && imgSize.w > 0
    ? { left: `${boundedRegion.x * 100}%`, top: `${boundedRegion.y * 100}%`, width: `${boundedRegion.w * 100}%`, height: `${boundedRegion.h * 100}%`, position: "absolute" }
    : null;

  const renderPane = (showLayers: boolean, paneLabel: string, primary: boolean) => (
    <div className="viewer-pane" role="group" aria-label={paneLabel}>
      <span className="viewer-hint">{paneLabel}</span>
      <div
        className="viewer-img-wrap"
        style={{
          transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
          width: imgSize.w || undefined, height: imgSize.h || undefined,
        }}
      >
        <img
          ref={primary ? imgRef : undefined}
          src={src}
          alt={primary ? alt : ""}
          aria-hidden={primary ? undefined : true}
          draggable={false}
          loading="lazy"
          decoding="async"
          style={{ width: imgSize.w || "auto", height: imgSize.h || "auto" }}
          onLoad={primary ? () => { setLoaded(true); setFailed(false); } : undefined}
          onError={primary ? () => setFailed(true) : undefined}
        />
        {showLayers && regionStyle && (
          <div className="viewer-overlay-box" style={regionStyle}>
            <span>{regionLabel}{overlayStatus ? ` (${overlayStatus.replaceAll("_", " ")})` : ""}</span>
          </div>
        )}
        {showLayers && hasRenderableOverlays && renderableOverlays.map((loc) => loc.coordinates ? (
          <div
            key={loc.id}
            className={`viewer-overlay-box loc-${loc.priority ?? "moderate"}`}
            style={{
              left: `${loc.coordinates.x * 100}%`, top: `${loc.coordinates.y * 100}%`,
              width: `${loc.coordinates.w * 100}%`, height: `${loc.coordinates.h * 100}%`,
              position: "absolute",
            }}
            title={loc.note}
          >
            <span>{loc.note}</span>
          </div>
        ) : null)}
      </div>
    </div>
  );

  return (
    <div className="viewer-frame" id={viewerId}>
      {/* Image info overlay — rendered AROUND the scan, never burned into pixels */}
      {infoOverlay && (
        <div className="viewer-info" aria-hidden="true">
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
          <>{renderPane(false, "Original scan — unmodified pixels", true)}{renderPane(true, "Overlay — annotations rendered separately", false)}</>
        ) : renderPane(viewMode === "overlay", viewMode === "overlay" ? "Overlay view — original pixels unchanged" : "Original scan — unmodified pixels", true)}
        {failed && (
          <div className="viewer-failed" role="alert">
            <Icon name="warning" size={18} />
            <strong>Original image could not be loaded</strong>
            <span>The server did not return the stored original (it may be missing from storage or access was refused). No substitute image or overlay is shown.</span>
          </div>
        )}
      </div>

      {showToolbar && (
        <>
          <div className="viewer-toolbar" role="toolbar" aria-label="Viewer controls">
            <button className="vbtn" onClick={fitToScreen} title="Fit image to viewer (0)"><Icon name="fit" size={13} /> Fit</button>
            <button className="vbtn" onClick={() => { setImgSize((s) => s); setZoom(1); }} aria-label="Actual size">1:1</button>
            <button className="vbtn" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in (+)"><Icon name="plus" size={13} /></button>
            <button className="vbtn" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out" title="Zoom out (−)"><Icon name="minus" size={13} /></button>
            <button className="vbtn" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); onReset?.(); }} title="Reset zoom and pan"><Icon name="reset" size={13} /> Reset</button>
            <span className="tb-sep" aria-hidden="true" />
            <button className={`vbtn${viewMode === "original" ? " on" : ""}`} onClick={() => setViewMode("original")} aria-pressed={viewMode === "original"}>Original</button>
            <button className={`vbtn${viewMode === "overlay" ? " on" : ""}`} onClick={() => setViewMode("overlay")} aria-pressed={viewMode === "overlay"} disabled={!hasAnyOverlay} title={!hasAnyOverlay ? overlayIssue : "Show annotations over the original scan"}>Overlay</button>
            <button className={`vbtn${viewMode === "side_by_side" ? " on" : ""}`} onClick={() => setViewMode("side_by_side")} aria-pressed={viewMode === "side_by_side"} disabled={!hasAnyOverlay} title={!hasAnyOverlay ? overlayIssue : "Compare original and annotated views"}>Side-by-side</button>
            <span className="spacer" />
            <button className="vbtn" onClick={fullscreen} aria-label="Fullscreen"><Icon name="fullscreen" size={13} /> Fullscreen</button>
          </div>
          <div className="viewer-status">
            {hasRenderableOverlays && overlayStatus
              ? <span className="viewer-legend"><span className="viewer-layer-status"><span className="legend-swatch" aria-hidden="true" />{overlayStatus.replaceAll("_", " ")} overlay · {renderableOverlays.length} region{renderableOverlays.length === 1 ? "" : "s"}</span><span>Boxes are research localizations, not diagnoses.</span></span>
              : boundedRegion ? <span className="viewer-legend"><span className="viewer-layer-status"><span className="legend-swatch" aria-hidden="true" />{regionLabel}</span></span>
              : <span>{classificationOnly ? "No overlay: classification-only output" : overlayIssue}</span>}
            <span className="spacer" style={{ flex: 1 }} />
            <span className="readout" aria-live="polite">Zoom {Math.round(zoom * 100)}% · pan {Math.round(offset.x)}, {Math.round(offset.y)}</span>
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
