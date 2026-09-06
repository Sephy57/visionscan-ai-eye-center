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
  infoOverlay?: { eye?: string; modality?: string; analysisLabel?: string };
  overlayUnavailableNote?: string;
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
  showToolbar = true, viewerId, zoom: controlledZoom, onZoomChange, onReset,
}: ScanViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [internalZoom, setInternalZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [loaded, setLoaded] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);

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
    const scale = Math.min((vp.clientWidth - pad) / img.naturalWidth, (vp.clientHeight - pad) / img.naturalHeight, 1);
    setImgSize({ w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => { fitToScreen(); }, [fitToScreen, loaded]);

  const zoomBy = (factor: number) => setZoom(zoom * factor);

  const onWheel = (e: React.WheelEvent) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); };
  const onPointerDown = (e: React.PointerEvent) => {
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => { if (dragging) setOffset((o) => ({ x: o.x + e.movementX, y: o.y + e.movementY })); };
  const onPointerUp = () => setDragging(false);

  const fullscreen = () => {
    const el = viewportRef.current?.parentElement;
    if (!document.fullscreenElement) el?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  const hasValidatedOverlays = (localizations?.length ?? 0) > 0;
  const regionStyle: React.CSSProperties | null = region && showOverlay && imgSize.w > 0
    ? { left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%`, position: "absolute" }
    : null;

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
        className={`viewer-viewport${dragging ? " dragging" : ""}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        role="img"
        aria-label={alt}
        tabIndex={0}
        onKeyDown={(e) => {
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
        <span className="viewer-hint">Original scan — unmodified pixels</span>
        <div
          className="viewer-img-wrap"
          style={{
            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
            width: imgSize.w || undefined, height: imgSize.h || undefined,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={src}
            alt={alt}
            draggable={false}
            loading="lazy"
            decoding="async"
            style={{ width: imgSize.w || "auto", height: imgSize.h || "auto" }}
            onLoad={() => setLoaded(true)}
          />
          {regionStyle && (
            <div className="viewer-overlay-box" style={regionStyle}>
              <span>{regionLabel} (demo)</span>
            </div>
          )}
          {/* Provenance-bearing localization layers; no geometry is invented here. */}
          {hasValidatedOverlays && showOverlay && localizations!.map((loc) =>
            loc.kind === "bounding_box" && loc.coordinates ? (
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
            ) : null
          )}
        </div>
      </div>

      {showToolbar && (
        <div className="viewer-toolbar" role="toolbar" aria-label="Viewer controls">
          <button className="vbtn" onClick={fitToScreen}><Icon name="fit" size={12} /> Fit</button>
          <button className="vbtn" onClick={() => { setImgSize((s) => s); setZoom(1); }} aria-label="Actual size">1:1</button>
          <button className="vbtn" onClick={() => zoomBy(1.25)} aria-label="Zoom in"><Icon name="plus" size={12} /></button>
          <button className="vbtn" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out"><Icon name="minus" size={12} /></button>
          <button className="vbtn" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); onReset?.(); }}><Icon name="reset" size={12} /> Reset</button>
          <button
            className={`vbtn${showOverlay ? " on" : ""}`}
            onClick={() => setShowOverlay((v) => !v)}
            aria-pressed={showOverlay}
            disabled={!hasValidatedOverlays && region == null}
            title={!hasValidatedOverlays && region == null ? overlayUnavailableNote : "Toggle overlays"}
          >
            Overlay
          </button>
          <span className="spacer" />
          {!hasValidatedOverlays && region == null && <span className="tiny muted">{overlayUnavailableNote}</span>}
          <span className="tiny muted" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button className="vbtn" onClick={fullscreen} aria-label="Fullscreen"><Icon name="fullscreen" size={12} /> Fullscreen</button>
        </div>
      )}
    </div>
  );
}
