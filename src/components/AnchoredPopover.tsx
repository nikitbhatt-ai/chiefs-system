"use client";

import { useCallback, useEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// Dropdown panel that renders in a portal on <body> and positions itself
// against an anchor element with `position: fixed`.
//
// Why a portal: an absolutely-positioned panel is clipped by ANY ancestor with
// `overflow-hidden` / `overflow-*-auto`, and no z-index can escape that clip.
// Every line-items card in this app is `overflow-hidden` (it clips the rounded
// corners of the header row), which cut the part/package pickers off at the card
// edge. Portalling to <body> takes the panel out of those containers entirely,
// so the fix holds no matter what a future caller wraps the field in.
//
// The panel also flips above the anchor when there isn't room below, clamps
// itself inside the viewport horizontally, and caps its height to the space
// actually available — so a picker on the last row of a long table stays usable.

const GAP = 4; // space between the anchor and the panel
const EDGE_MARGIN = 8; // minimum breathing room against the viewport edge
const MIN_DROP_HEIGHT = 120; // below this, prefer flipping up

type Placement = {
  // Exactly one of top/bottom is set: `bottom` when flipped up, so the panel
  // grows upward from the anchor instead of being pinned to a computed height.
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
};

export type AnchoredPopoverOptions = {
  /** Horizontal edge to line the panel up with. Default "left". */
  align?: "left" | "right";
  /** Panel width in px, or "anchor" to match the anchor's width. Default "anchor". */
  width?: number | "anchor";
  /** Upper bound on panel height in px. Default 240 (matches the old max-h-60). */
  maxHeight?: number;
};

/**
 * Track an anchor element's position and return where to put a fixed-position
 * panel. Returns null while closed or before the first measurement.
 */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  { align = "left", width = "anchor", maxHeight = 240 }: AnchoredPopoverOptions = {},
): Placement | null {
  const [placement, setPlacement] = useState<Placement | null>(null);

  const measure = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();

    const desiredWidth = width === "anchor" ? r.width : width;
    const panelWidth = Math.min(desiredWidth, window.innerWidth - EDGE_MARGIN * 2);

    const spaceBelow = window.innerHeight - r.bottom - GAP - EDGE_MARGIN;
    const spaceAbove = r.top - GAP - EDGE_MARGIN;
    // Drop down by default; flip up only when below is genuinely cramped and
    // above has more to offer.
    const flipUp = spaceBelow < Math.min(maxHeight, MIN_DROP_HEIGHT) && spaceAbove > spaceBelow;
    const available = Math.max(80, flipUp ? spaceAbove : spaceBelow);

    const rawLeft = align === "right" ? r.right - panelWidth : r.left;
    const left = Math.max(
      EDGE_MARGIN,
      Math.min(rawLeft, window.innerWidth - panelWidth - EDGE_MARGIN),
    );

    setPlacement({
      ...(flipUp
        ? { bottom: window.innerHeight - r.top + GAP }
        : { top: r.bottom + GAP }),
      left,
      width: panelWidth,
      maxHeight: Math.min(maxHeight, available),
    });
  }, [anchorRef, align, width, maxHeight]);

  useEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    measure();
    // Capture-phase scroll fires for scrolling in ANY ancestor, not just the
    // window — that's what keeps the panel glued to a field inside a
    // horizontally-scrolling card.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const el = anchorRef.current;
    const ro =
      el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el!);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [open, measure, anchorRef]);

  return placement;
}

export function AnchoredPopover({
  anchorRef,
  open,
  align,
  width,
  maxHeight,
  panelRef,
  className,
  children,
}: AnchoredPopoverOptions & {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  /**
   * Forwarded to the panel element. Callers doing their own outside-click
   * detection need this: once portalled, the panel is no longer a DOM
   * descendant of the anchor's wrapper, so a `wrapper.contains(target)` check
   * alone would treat a click on the panel as a click outside.
   */
  panelRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  children: ReactNode;
}) {
  // Portals need a DOM target, so hold off until after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const placement = useAnchoredPosition(anchorRef, open, { align, width, maxHeight });

  if (!mounted || !open || !placement) return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top: placement.top,
        bottom: placement.bottom,
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
      }}
      // z-index above the nav (z-50); the portal is in the root stacking
      // context so this actually wins.
      className={`z-[100] overflow-y-auto overscroll-contain ${className ?? ""}`}
    >
      {children}
    </div>,
    document.body,
  );
}
