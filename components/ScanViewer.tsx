"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Ophthalmic imaging viewer: zoom, pan, fit, reset, fullscreen, overlay toggle.
 * Medical-image fidelity: the scan pixels are rendered unmodified (no CSS
 * filters); chrome around the image can be themed freely.
 */

interface Region {
  x: number; y: number; w: number; h: number;
}

export interface ScanViewerProps {
  src: string;
  alt: string;
  region?: Region | null;             // normalized 0..1 - "AI-highlighted region"
  regionLabel?: string;
  overlayAvailable?: boolean;         // false => localization not available
  overlayUnavailableNote?: string;
  showToolbar?: boolean;
  initialFit?: boolean;
  viewerId?: string;
}

export default function ScanViewer({
  src, alt, region = null, regionLabel = "AI-highlighted region",
  overlayAvailable = false, overlayUnavailableNote = "AI localization is not available for this model.",
  showToolbar = true, viewerId,
}: ScanViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [zoom, setZoom] = useState(1);           // relative scale (1 = fit)
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [showOverlay, setShowOverlay] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const fitToScreen = useCallback(() => {
    const vp = viewportRef.current, img = imgRef.current;
    if (!vp || !img || !img.naturalWidth) return;
    const pad = 16;
    const scale = Math.min((vp.clientWidth - pad) / img.naturalWidth, (vp.clientHeight - pad) / img.naturalHeight, 1);
    setImgSize({ w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => { fitToScreen(); }, [fitToScreen, loaded]);

  const zoomBy = (factor: number) => setZoom((z) => Math.min(8, Math.max(0.5, z * factor)));

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setOffset((o) => ({ x: o.x + e.movementX, y: o.y + e.movementY }));
  };
  const onPointerUp = () => setDragging(false);

  const fullscreen = () => {
    const el = viewportRef.current?.parentElement;
    if (!document.fullscreenElement) el?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  const regionStyle: React.CSSProperties | null = region && showOverlay && overlayAvailable && imgSize.w > 0
    ? {
        left: region.x * 100 + "%", top: region.y * 100 + "%",
        width: region.w * 100 + "%", height: region.h * 100 + "%",
        position: "absolute",
      }
    : null;

  return (
    <div className="viewer-frame" id={viewerId}>
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
          ref={wrapRef}
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
            style={{ width: imgSize.w || "auto", height: imgSize.h || "auto" }}
            onLoad={(e) => { setLoaded(true); }}
          />
          {regionStyle && (
            <div className="viewer-overlay-box" style={regionStyle}>
              <span>{regionLabel} (demo)</span>
            </div>
          )}
        </div>
      </div>

      {showToolbar && (
        <div className="viewer-toolbar" role="toolbar" aria-label="Viewer controls">
          <button className="vbtn" onClick={() => zoomBy(1.25)} aria-label="Zoom in">＋</button>
          <button className="vbtn" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">－</button>
          <button className="vbtn" onClick={fitToScreen}>Fit</button>
          <button className="vbtn" onClick={() => setZoom(1)} aria-label="Reset zoom">1:1</button>
          <button className="vbtn" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>Reset</button>
          <button className={`vbtn${showOverlay ? " on" : ""}`} onClick={() => setShowOverlay((v) => !v)} aria-pressed={showOverlay}>
            {overlayAvailable ? "Findings overlay" : "Overlay"}
          </button>
          <span className="spacer" />
          {!overlayAvailable && <span className="tiny muted">{overlayUnavailableNote}</span>}
          <button className="vbtn" onClick={fullscreen} aria-label="Fullscreen">⛶ Fullscreen</button>
        </div>
      )}
    </div>
  );
}
