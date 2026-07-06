import { useState, type PointerEvent as ReactPointerEvent } from "react";

import { clamp, getClosestPointIndex, type ChartSelection } from "./stockSeries";

type SelectableChart = {
  points: Array<{ x: number; index: number }>;
  padding: { left: number };
  plotWidth: number;
};

/**
 * Click-and-drag range selection plus hover tracking for the trend charts.
 * While a drag is in progress the live drag range takes precedence over the
 * last committed selection.
 */
export function useChartSelection(chart: SelectableChart | null) {
  const [selection, setSelection] = useState<ChartSelection | null>(null);
  const [dragAnchorIndex, setDragAnchorIndex] = useState<number | null>(null);
  const [dragCurrentIndex, setDragCurrentIndex] = useState<number | null>(null);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);

  function getPointIndexFromEvent(event: ReactPointerEvent<SVGSVGElement>) {
    if (!chart) {
      return null;
    }
    const svg = event.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      return null;
    }
    const cursorPt = pt.matrixTransform(ctm.inverse());
    const chartX = clamp(cursorPt.x, chart.padding.left, chart.padding.left + chart.plotWidth);
    return getClosestPointIndex(chart.points, chartX);
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const pointIndex = getPointIndexFromEvent(event);
    if (pointIndex === null) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragAnchorIndex(pointIndex);
    setDragCurrentIndex(pointIndex);
    setHoveredPointIndex(pointIndex);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const pointIndex = getPointIndexFromEvent(event);
    if (pointIndex !== null) {
      setHoveredPointIndex(pointIndex);
    }
    if (dragAnchorIndex === null || pointIndex === null) {
      return;
    }
    setDragCurrentIndex(pointIndex);
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragAnchorIndex === null) {
      return;
    }
    const pointIndex = getPointIndexFromEvent(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setHoveredPointIndex(pointIndex);
    if (pointIndex !== null && pointIndex !== dragAnchorIndex) {
      setSelection({ startIndex: dragAnchorIndex, endIndex: pointIndex });
    }
    setDragAnchorIndex(null);
    setDragCurrentIndex(null);
  }

  function onPointerCancel(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragAnchorIndex(null);
    setDragCurrentIndex(null);
    setHoveredPointIndex(null);
  }

  function onPointerLeave() {
    if (dragAnchorIndex !== null) {
      return;
    }
    setHoveredPointIndex(null);
  }

  function reset() {
    setSelection(null);
    setDragAnchorIndex(null);
    setDragCurrentIndex(null);
    setHoveredPointIndex(null);
  }

  const activeSelection =
    dragAnchorIndex !== null && dragCurrentIndex !== null ? { startIndex: dragAnchorIndex, endIndex: dragCurrentIndex } : selection;

  return {
    activeSelection,
    hoveredPointIndex,
    clearSelection: () => setSelection(null),
    reset,
    pointerHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave },
  };
}
