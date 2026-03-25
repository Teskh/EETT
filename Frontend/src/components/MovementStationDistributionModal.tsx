import { Modal } from "./Modal";

type StationDistributionMovement = {
  quantity: number;
  desc_sub?: string | null;
};

type MovementStationDistributionModalProps = {
  open: boolean;
  movements: StationDistributionMovement[];
  rangeStart: string | null;
  rangeEnd: string | null;
  unitLabel?: string | null;
  onClose: () => void;
};

const quantityFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
const percentFormatter = new Intl.NumberFormat("es-CL", { style: "percent", maximumFractionDigits: 1 });
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NO_STATION_LABEL = "No station";
const STATION_COLORS = [
  "#f59e0b",
  "#fb7185",
  "#38bdf8",
  "#34d399",
  "#a78bfa",
  "#f97316",
  "#14b8a6",
  "#ef4444",
];

function parseDateValue(value: string | Date) {
  if (value instanceof Date) {
    return new Date(value);
  }
  if (DATE_ONLY_PATTERN.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("es-CL", { year: "numeric", month: "short", day: "numeric" });
}

function formatQuantity(value: number) {
  return quantityFormatter.format(value);
}

function formatShare(value: number) {
  return percentFormatter.format(value);
}

export function MovementStationDistributionModal({
  open,
  movements,
  rangeStart,
  rangeEnd,
  unitLabel,
  onClose,
}: MovementStationDistributionModalProps) {
  const stationMap = new Map<
    string,
    {
      label: string;
      quantity: number;
      movementCount: number;
    }
  >();

  for (const movement of movements) {
    const quantity = Number(movement.quantity) || 0;
    const label = movement.desc_sub?.trim() || NO_STATION_LABEL;
    const current = stationMap.get(label) || { label, quantity: 0, movementCount: 0 };
    current.quantity += quantity;
    current.movementCount += 1;
    stationMap.set(label, current);
  }

  const totalQuantity = Array.from(stationMap.values()).reduce((sum, entry) => sum + entry.quantity, 0);
  const entries = Array.from(stationMap.values())
    .sort((left, right) => right.quantity - left.quantity || right.movementCount - left.movementCount || left.label.localeCompare(right.label))
    .map((entry, index) => ({
      ...entry,
      share: totalQuantity > 0 ? entry.quantity / totalQuantity : 0,
      color: STATION_COLORS[index % STATION_COLORS.length],
      isUnassigned: entry.label === NO_STATION_LABEL,
    }));

  const assignedEntryCount = entries.filter((entry) => !entry.isUnassigned).length;
  const unassignedEntry = entries.find((entry) => entry.isUnassigned) || null;
  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  const resolvedUnitLabel = unitLabel || "units";
  let strokeOffset = 0;

  return (
    <Modal
      open={open}
      title="desc_sub Distribution"
      kicker="Movement Stations"
      onClose={onClose}
      panelClassName="max-w-5xl"
    >
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-black/10 bg-zinc-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Uses the currently plotted period and any active drag selection from the movement chart.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {formatDate(rangeStart)} - {formatDate(rangeEnd)}
          </p>

          <div className="mt-6 flex items-center justify-center">
            <div className="relative h-[220px] w-[220px]">
              <svg viewBox="0 0 220 220" className="h-full w-full">
                <circle cx="110" cy="110" r={radius} fill="none" stroke="rgb(228 228 231 / 0.8)" strokeWidth="28" className="dark:stroke-[rgba(63,63,70,0.9)]" />
                <g transform="rotate(-90 110 110)">
                  {entries.map((entry) => {
                    const strokeLength = entry.share * circumference;
                    const circle = (
                      <circle
                        key={entry.label}
                        cx="110"
                        cy="110"
                        r={radius}
                        fill="none"
                        stroke={entry.color}
                        strokeWidth="28"
                        strokeLinecap={entries.length === 1 ? "butt" : "round"}
                        strokeDasharray={`${strokeLength} ${Math.max(circumference - strokeLength, 0)}`}
                        strokeDashoffset={-strokeOffset}
                      />
                    );
                    strokeOffset += strokeLength;
                    return circle;
                  })}
                </g>
              </svg>

              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Total Qty</div>
                <div className="mt-2 text-3xl font-bold text-zinc-900 dark:text-white">{formatQuantity(totalQuantity)}</div>
                <div className="mt-1 text-xs text-zinc-500">{resolvedUnitLabel}</div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-zinc-500">
            <span className="rounded-full border border-black/10 px-2.5 py-1 dark:border-white/10">{movements.length} movs.</span>
            <span className="rounded-full border border-black/10 px-2.5 py-1 dark:border-white/10">{assignedEntryCount} stations</span>
            <span className="rounded-full border border-black/10 px-2.5 py-1 dark:border-white/10">{entries.length} buckets</span>
          </div>

          {unassignedEntry ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
              {formatQuantity(unassignedEntry.quantity)} {resolvedUnitLabel} in this range has no `desc_sub` value.
            </div>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-2xl border border-black/10 bg-white/70 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-black/5 bg-zinc-100/70 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:border-white/5 dark:bg-white/[0.04]">
            <div>Station</div>
            <div className="text-right">Share</div>
            <div className="text-right">Quantity</div>
          </div>

          <div className="max-h-[440px] divide-y divide-black/5 overflow-y-auto dark:divide-white/5">
            {entries.length ? (
              entries.map((entry) => (
                <div key={entry.label} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{entry.label}</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-zinc-200/90 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(entry.share * 100, entry.share > 0 ? 6 : 0)}%`,
                          backgroundColor: entry.color,
                        }}
                      />
                    </div>
                    <div className="mt-2 text-[11px] text-zinc-500">
                      {entry.movementCount} movement{entry.movementCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="text-right text-sm font-semibold text-zinc-700 dark:text-zinc-200">{formatShare(entry.share)}</div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-white">{formatQuantity(entry.quantity)}</div>
                    <div className="text-[11px] text-zinc-500">{resolvedUnitLabel}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-8 text-sm text-zinc-500">No movement quantities are available for the selected range.</div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
