import type { PointerEvent as ReactPointerEvent } from "react";

import { formatDate, formatNumber } from "../formatters";
import type { HouseComparisonChart, HouseTrendChartPoint } from "../houseComparison";
import { clamp, type ChartPoint, type ChartSelection, buildLinePath } from "../stockSeries";

type StockChart = NonNullable<ReturnType<typeof buildLinePath>>;

type ChartPointerHandlers = {
  onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerUp: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerLeave: () => void;
};

type ChartFrame = {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
  plotHeight: number;
};

type SelectionEdges = {
  start: { x: number };
  end: { x: number };
} | null;

const CHART_SVG_CLASSES = "w-full h-full max-h-[400px] overflow-visible cursor-crosshair touch-none select-none";
const NO_USER_SELECT = { userSelect: "none", WebkitUserSelect: "none" } as const;
const GRID_STOPS = [0, 0.25, 0.5, 0.75, 1];

function SelectionClipPath({ id, frame, edges }: { id: string; frame: ChartFrame; edges: SelectionEdges }) {
  if (!edges) {
    return null;
  }
  return (
    <defs>
      <clipPath id={id}>
        <rect
          x={Math.min(edges.start.x, edges.end.x)}
          y={0}
          width={Math.max(Math.abs(edges.end.x - edges.start.x), 0.001)}
          height={frame.height}
        />
      </clipPath>
    </defs>
  );
}

function SelectionRegion({ frame, edges, fill, stroke }: { frame: ChartFrame; edges: SelectionEdges; fill: string; stroke: string }) {
  if (!edges) {
    return null;
  }
  const plotBottom = frame.padding.top + frame.plotHeight;
  return (
    <g>
      <rect
        x={Math.min(edges.start.x, edges.end.x)}
        y={frame.padding.top}
        width={Math.max(Math.abs(edges.end.x - edges.start.x), 2)}
        height={frame.plotHeight}
        fill={fill}
      />
      <line x1={edges.start.x} y1={frame.padding.top} x2={edges.start.x} y2={plotBottom} stroke={stroke} strokeDasharray="4 4" />
      <line x1={edges.end.x} y1={frame.padding.top} x2={edges.end.x} y2={plotBottom} stroke={stroke} strokeDasharray="4 4" />
    </g>
  );
}

function DateAxis({ frame, firstDate, lastDate }: { frame: ChartFrame; firstDate: string | undefined; lastDate: string | undefined }) {
  return (
    <>
      <text x={frame.padding.left} y={frame.height - 8} fontSize="11" fill="currentColor" opacity="0.55" pointerEvents="none">
        {formatDate(firstDate)}
      </text>
      <text
        x={frame.width - frame.padding.right}
        y={frame.height - 8}
        textAnchor="end"
        fontSize="11"
        fill="currentColor"
        opacity="0.55"
        pointerEvents="none"
      >
        {formatDate(lastDate)}
      </text>
    </>
  );
}

export function StockTrendChart({
  chart,
  selectionBounds,
  selectionEdges,
  hoveredPoint,
  pointerHandlers,
}: {
  chart: StockChart;
  selectionBounds: ChartSelection | null;
  selectionEdges: SelectionEdges;
  hoveredPoint: ChartPoint | null;
  pointerHandlers: ChartPointerHandlers;
}) {
  const dimmed = selectionBounds ? 0.25 : 1;
  return (
    <svg
      viewBox={`0 0 ${chart.width} ${chart.height}`}
      className={CHART_SVG_CLASSES}
      focusable="false"
      style={NO_USER_SELECT}
      {...pointerHandlers}
    >
      <SelectionClipPath id="stock-selection-clip" frame={chart} edges={selectionEdges} />
      {GRID_STOPS.map((stop) => {
        const y = chart.padding.top + chart.plotHeight - stop * chart.plotHeight;
        return (
          <g key={stop}>
            <line
              x1={chart.padding.left}
              y1={y}
              x2={chart.width - chart.padding.right}
              y2={y}
              stroke="rgba(113,113,122,0.18)"
              strokeDasharray="4 6"
            />
            <text x={chart.padding.left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="currentColor" opacity="0.55" pointerEvents="none">
              {formatNumber(chart.maxValue * stop)}
            </text>
          </g>
        );
      })}
      <SelectionRegion frame={chart} edges={selectionEdges} fill="rgba(245, 158, 11, 0.12)" stroke="rgba(245, 158, 11, 0.55)" />
      <path
        d={chart.path}
        fill="none"
        stroke="rgb(245 158 11)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={dimmed}
        className="transition-opacity duration-300"
      />
      {chart.points.map((point) => (
        <circle
          key={`base-${point.date}`}
          cx={point.x}
          cy={point.y}
          r={hoveredPoint?.index === point.index ? 5 : 2.5}
          fill="rgb(245 158 11)"
          opacity={dimmed}
          className="transition-opacity duration-300"
          pointerEvents="none"
        />
      ))}
      {selectionBounds ? (
        <g clipPath="url(#stock-selection-clip)">
          <path d={chart.path} fill="none" stroke="rgb(245 158 11)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          {chart.points.map((point) => {
            if (point.index < selectionBounds.startIndex || point.index > selectionBounds.endIndex) {
              return null;
            }
            return (
              <circle
                key={`hi-${point.date}`}
                cx={point.x}
                cy={point.y}
                r={hoveredPoint?.index === point.index ? 5.5 : 4.5}
                fill="rgb(245 158 11)"
                stroke="rgb(255 255 255)"
                strokeWidth="1.5"
                className="dark:stroke-zinc-900"
                pointerEvents="none"
              />
            );
          })}
        </g>
      ) : null}
      {hoveredPoint ? (
        <g pointerEvents="none">
          <line
            x1={hoveredPoint.x}
            y1={chart.padding.top}
            x2={hoveredPoint.x}
            y2={chart.padding.top + chart.plotHeight}
            stroke="rgba(245, 158, 11, 0.35)"
            strokeDasharray="4 4"
          />
          <circle
            cx={hoveredPoint.x}
            cy={hoveredPoint.y}
            r={6}
            fill="rgb(245 158 11)"
            stroke="rgb(255 255 255)"
            strokeWidth="2"
            className="dark:stroke-zinc-900"
          />
          <g
            transform={`translate(${clamp(hoveredPoint.x - 68, chart.padding.left, chart.width - chart.padding.right - 136)}, ${
              hoveredPoint.y < chart.padding.top + 56 ? hoveredPoint.y + 14 : hoveredPoint.y - 54
            })`}
          >
            <rect width="136" height="42" rx="10" fill="rgba(24, 24, 27, 0.92)" className="dark:fill-zinc-950/95" />
            <text x="12" y="17" fontSize="11" fill="white" opacity="0.9">
              {formatDate(hoveredPoint.date)}
            </text>
            <text x="12" y="31" fontSize="12" fill="white" fontWeight="700">
              Stock: {formatNumber(hoveredPoint.value)}
            </text>
          </g>
        </g>
      ) : null}
      <DateAxis frame={chart} firstDate={chart.points[0]?.date} lastDate={chart.points[chart.points.length - 1]?.date} />
    </svg>
  );
}

// Series colors: stock = amber, projected stock = emerald, remaining house starts = slate.
function HouseSeriesDots({
  point,
  hovered,
  variant,
  opacity,
}: {
  point: HouseTrendChartPoint;
  hovered: boolean;
  variant: "base" | "highlighted";
  opacity?: number;
}) {
  const highlighted = variant === "highlighted";
  const r = hovered ? (highlighted ? 5.5 : 5) : highlighted ? 4.5 : 2.5;
  const shared = {
    r,
    opacity,
    pointerEvents: "none" as const,
    ...(highlighted ? { stroke: "rgb(255 255 255)", strokeWidth: 1.5 } : {}),
  };
  const stockClassName = highlighted ? "dark:stroke-zinc-900" : "transition-opacity duration-300";
  return (
    <g>
      {point.stockY !== null ? (
        <circle cx={point.x} cy={point.stockY} fill="rgb(245 158 11)" className={stockClassName} {...shared} />
      ) : null}
      {point.projectedStockY !== null ? (
        <circle cx={point.x} cy={point.projectedStockY} fill="rgb(16 185 129)" className={stockClassName} {...shared} />
      ) : null}
      <circle
        cx={point.x}
        cy={point.houseY}
        fill="rgb(51 65 85)"
        className={highlighted ? "dark:stroke-slate-300" : "transition-opacity duration-300 dark:fill-slate-300"}
        {...shared}
      />
    </g>
  );
}

function HouseSeriesPaths({ chart, strokeWidth }: { chart: HouseComparisonChart; strokeWidth: number }) {
  const shared = { fill: "none", strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <>
      {chart.stockPath ? <path d={chart.stockPath} stroke="rgb(245 158 11)" {...shared} /> : null}
      {chart.projectedStockPath ? <path d={chart.projectedStockPath} stroke="rgb(16 185 129)" {...shared} /> : null}
      {chart.housePath ? <path d={chart.housePath} stroke="rgb(51 65 85)" className="dark:stroke-slate-300" {...shared} /> : null}
    </>
  );
}

export function HouseTrendChart({
  chart,
  selectionBounds,
  selectionEdges,
  hoveredPoint,
  pointerHandlers,
}: {
  chart: HouseComparisonChart;
  selectionBounds: ChartSelection | null;
  selectionEdges: SelectionEdges;
  hoveredPoint: HouseTrendChartPoint | null;
  pointerHandlers: ChartPointerHandlers;
}) {
  const dimmed = selectionBounds ? 0.25 : 1;
  const tooltipHeight = hoveredPoint?.projectedStockValue !== null ? 80 : 66;
  return (
    <svg
      viewBox={`0 0 ${chart.width} ${chart.height}`}
      className={CHART_SVG_CLASSES}
      focusable="false"
      style={NO_USER_SELECT}
      {...pointerHandlers}
    >
      <SelectionClipPath id="house-selection-clip" frame={chart} edges={selectionEdges} />
      {GRID_STOPS.map((stop) => {
        const y = chart.padding.top + chart.plotHeight - stop * chart.plotHeight;
        return (
          <g key={stop}>
            <line
              x1={chart.padding.left}
              y1={y}
              x2={chart.width - chart.padding.right}
              y2={y}
              stroke="rgba(113,113,122,0.18)"
              strokeDasharray="4 6"
            />
            <text x={chart.padding.left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="currentColor" opacity="0.55">
              {formatNumber(chart.minStock + (chart.maxStock - chart.minStock) * stop)}
            </text>
            <text x={chart.width - chart.padding.right + 10} y={y + 4} fontSize="11" fill="currentColor" opacity="0.55">
              {formatNumber(chart.maxRemainingHouseStarts * stop, 0)}
            </text>
          </g>
        );
      })}
      <SelectionRegion frame={chart} edges={selectionEdges} fill="rgba(51, 65, 85, 0.08)" stroke="rgba(51, 65, 85, 0.45)" />
      <g opacity={dimmed} className="transition-opacity duration-300">
        <HouseSeriesPaths chart={chart} strokeWidth={3} />
      </g>
      {chart.points.map((point) => (
        <HouseSeriesDots
          key={point.date}
          point={point}
          hovered={hoveredPoint?.index === point.index}
          variant="base"
          opacity={dimmed}
        />
      ))}
      {selectionBounds ? (
        <g clipPath="url(#house-selection-clip)">
          <HouseSeriesPaths chart={chart} strokeWidth={3.5} />
          {chart.points.map((point) => {
            if (point.index < selectionBounds.startIndex || point.index > selectionBounds.endIndex) {
              return null;
            }
            return (
              <HouseSeriesDots
                key={`hi-${point.date}`}
                point={point}
                hovered={hoveredPoint?.index === point.index}
                variant="highlighted"
              />
            );
          })}
        </g>
      ) : null}
      {hoveredPoint ? (
        <g pointerEvents="none">
          <line
            x1={hoveredPoint.x}
            y1={chart.padding.top}
            x2={hoveredPoint.x}
            y2={chart.padding.top + chart.plotHeight}
            stroke="rgba(51, 65, 85, 0.35)"
            strokeDasharray="4 4"
          />
          {hoveredPoint.stockY !== null ? (
            <circle
              cx={hoveredPoint.x}
              cy={hoveredPoint.stockY}
              r={6}
              fill="rgb(245 158 11)"
              stroke="rgb(255 255 255)"
              strokeWidth="2"
              className="dark:stroke-zinc-900"
            />
          ) : null}
          {hoveredPoint.projectedStockY !== null ? (
            <circle
              cx={hoveredPoint.x}
              cy={hoveredPoint.projectedStockY}
              r={6}
              fill="rgb(16 185 129)"
              stroke="rgb(255 255 255)"
              strokeWidth="2"
              className="dark:stroke-zinc-900"
            />
          ) : null}
          <circle
            cx={hoveredPoint.x}
            cy={hoveredPoint.houseY}
            r={6}
            fill="rgb(51 65 85)"
            stroke="rgb(255 255 255)"
            strokeWidth="2"
            className="dark:fill-slate-300 dark:stroke-zinc-900"
          />
          <g
            transform={`translate(${clamp(hoveredPoint.x - 90, chart.padding.left, chart.width - chart.padding.right - 180)}, ${
              Math.min(hoveredPoint.stockY ?? hoveredPoint.houseY, hoveredPoint.houseY) < chart.padding.top + 74
                ? Math.max(hoveredPoint.stockY ?? hoveredPoint.houseY, hoveredPoint.houseY) + 16
                : Math.min(hoveredPoint.stockY ?? hoveredPoint.houseY, hoveredPoint.houseY) - 76
            })`}
          >
            <rect width="180" height={tooltipHeight} rx="10" fill="rgba(24, 24, 27, 0.92)" className="dark:fill-zinc-950/95" />
            <text x="12" y="17" fontSize="11" fill="white" opacity="0.9">
              {formatDate(hoveredPoint.date)}
            </text>
            <text x="12" y="31" fontSize="12" fill="white" fontWeight="700">
              Stock: {formatNumber(hoveredPoint.stockValue)}
            </text>
            {hoveredPoint.projectedStockValue !== null ? (
              <text x="12" y="45" fontSize="12" fill="white" fontWeight="700">
                Projected: {formatNumber(hoveredPoint.projectedStockValue)}
              </text>
            ) : null}
            <text x="12" y={hoveredPoint.projectedStockValue !== null ? "59" : "45"} fontSize="12" fill="white" fontWeight="700">
              Remaining starts: {formatNumber(hoveredPoint.remainingHouseStarts, 0)}
            </text>
            <text x="12" y={hoveredPoint.projectedStockValue !== null ? "73" : "59"} fontSize="12" fill="white" fontWeight="700">
              Starts today: {formatNumber(hoveredPoint.house_starts, 0)}
            </text>
          </g>
        </g>
      ) : null}
      <DateAxis frame={chart} firstDate={chart.points[0]?.date} lastDate={chart.points[chart.points.length - 1]?.date} />
    </svg>
  );
}
