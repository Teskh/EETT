function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse bg-zinc-200/85 dark:bg-white/10 ${className}`} />;
}

export function TrendChartSkeleton({ dualSeries = false }: { dualSeries?: boolean }) {
  return (
    <div className="absolute inset-0 overflow-hidden border border-black/5 bg-zinc-50/60 p-4 dark:border-white/5 dark:bg-white/[0.02]">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3">
          <SkeletonBlock className="h-4 w-32" />
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-6 w-16" />
            {dualSeries ? <SkeletonBlock className="h-6 w-24" /> : null}
          </div>
        </div>
        <div className="relative mt-4 flex-1 overflow-hidden border border-black/5 bg-white/70 px-4 py-3 dark:border-white/5 dark:bg-black/20">
          {[14, 34, 54, 74].map((top) => (
            <div
              key={top}
              className="absolute left-12 right-4 h-px bg-zinc-200/80 dark:bg-white/10"
              style={{ top: `${top}%` }}
            />
          ))}
          <svg
            viewBox="0 0 100 60"
            preserveAspectRatio="none"
            className="absolute inset-x-12 bottom-8 top-10 h-auto w-auto overflow-visible"
            aria-hidden="true"
          >
            <path
              d="M2 16 C18 18, 28 23, 42 30 S70 43, 98 52"
              fill="none"
              stroke="rgb(253 186 116 / 0.9)"
              strokeWidth="2.8"
              strokeLinecap="round"
              className="dark:stroke-[rgba(251,191,36,0.28)]"
            />
            {dualSeries ? (
              <path
                d="M2 10 C18 14, 32 18, 47 27 S75 38, 98 46"
                fill="none"
                stroke="rgb(203 213 225 / 0.95)"
                strokeWidth="2.8"
                strokeLinecap="round"
                className="dark:stroke-[rgba(226,232,240,0.24)]"
              />
            ) : null}
          </svg>
          <div className="absolute bottom-3 left-12 right-4 flex items-center justify-between">
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="h-3 w-20" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function MovementBreakdownSkeleton() {
  return (
    <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <SkeletonBlock className="h-3 w-36" />
          <SkeletonBlock className="mt-2 h-3 w-28" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SkeletonBlock className="h-7 w-20" />
          <SkeletonBlock className="h-7 w-20" />
          <SkeletonBlock className="h-7 w-20" />
        </div>
      </div>

      <div className="mt-3 flex h-[300px] flex-col overflow-hidden border border-black/10 bg-zinc-50/70 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="grid gap-3 border-b border-black/5 bg-zinc-100/50 px-4 py-2 dark:border-white/5 dark:bg-white/[0.02] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <SkeletonBlock className="h-3 w-32" />
          <div className="flex md:justify-end">
            <SkeletonBlock className="h-3 w-16" />
          </div>
        </div>
        <div className="flex-1 divide-y divide-black/5 overflow-y-auto dark:divide-white/5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="grid min-h-[74px] gap-3 px-4 py-3 transition-colors hover:bg-zinc-100/50 dark:hover:bg-white/[0.05] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SkeletonBlock className="h-4 w-24" />
                  <SkeletonBlock className="h-5 w-16" />
                  <SkeletonBlock className="h-5 w-16" />
                  <SkeletonBlock className="h-5 w-20" />
                </div>
                <SkeletonBlock className="mt-2 h-3 w-3/4 max-w-[320px]" />
              </div>
              <div className="flex flex-col items-start gap-2 md:items-end">
                <SkeletonBlock className="h-5 w-16" />
                <SkeletonBlock className="h-3 w-12" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
