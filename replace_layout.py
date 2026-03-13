import re

with open('/home/devuser/Code/Spec Sheets/Frontend/src/pages/MaterialDashboardPage.tsx', 'r') as f:
    content = f.read()

def get_svg_block(content):
    start = content.find('<svg')
    end = content.find('</svg>') + 6
    return content[start:end]

start_marker = '<section className="liquid-glass rounded-[28px] border border-black/10 dark:border-white/10 p-6 md:p-8">'
end_marker = '    </section>\n  );\n}'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print("Could not find boundaries")
    exit(1)

svg_start = content.find('<svg', start_idx, end_idx)
svg_end = content.find('</svg>', start_idx, end_idx) + 6
svg_content = content[svg_start:svg_end]

new_block = f'''<section className="liquid-glass rounded-[28px] border border-black/10 dark:border-white/10 overflow-hidden flex flex-col">
      <div className="p-6 md:p-8 border-b border-black/10 dark:border-white/10 bg-white/40 dark:bg-black/20 flex flex-col md:flex-row justify-between gap-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-2">Pinned Graph</p>
          <h2 className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight">{{selected.material_name}}</h2>
          <p className="text-sm font-medium text-zinc-500 mt-2 flex items-center gap-2">
            <span className="bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 rounded text-xs text-zinc-700 dark:text-zinc-300 font-mono">{{selected.sku}}</span>
            {{selected.unit ? <span>&bull; {{selected.unit}}</span> : null}}
          </p>
        </div>
        <div className="flex gap-6 items-end">
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-1">Stock on Hand</div>
            <div className="text-3xl font-light tracking-tight text-zinc-900 dark:text-white">{{detail ? formatNumber(detail.stock_on_hand) : detailLoading ? "..." : "—"}}</div>
          </div>
          <div className="w-px h-10 bg-black/10 dark:bg-white/10 hidden md:block" />
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-1">Avg Price</div>
            <div className="text-3xl font-light tracking-tight text-zinc-900 dark:text-white">{{detail ? formatCurrency(detail.average_price) : detailLoading ? "..." : "—"}}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] flex-1">
        <div className="p-6 md:p-8 flex flex-col border-b lg:border-b-0 lg:border-r border-black/10 dark:border-white/10">
          <div className="flex items-start justify-between mb-6 gap-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                {{isCustomSelection ? "Selected Period" : history ? `${{history.movement_days}}-Day Trend` : "Trend"}}
              </h3>
              <div className="text-xs text-zinc-500 mt-1">
                {{summary ? `${{formatDate(summary.start.date)}} - ${{formatDate(summary.end.date)}}` : "—"}}
              </div>
              <p className="mt-1.5 text-xs text-zinc-500 max-w-sm">
                Click and drag across the curve to inspect the stock variation and average consumption per day.
              </p>
              {{isRefreshing ? <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">Refreshing cached ERP data...</p> : null}}
            </div>
            {{isCustomSelection ? (
              <button
                type="button"
                onClick={{() => setSelection(null)}}
                className="text-xs font-semibold px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-white/10 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/20 transition-colors"
              >
                Reset Selection
              </button>
            ) : null}}
          </div>

          <div className="flex-1 w-full relative min-h-[240px]">
            {{isBlockingLoad ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">Loading movement history...</div>
            ) : history && chart ? (
              {svg_content}
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">No movement history available for this material.</div>
            )}}
          </div>

          {{history && chart ? (
            <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-black/5 dark:border-white/5">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1">Variation</div>
                <div className={{`text-lg font-medium ${{summary ? (summary.stockDelta < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400') : 'text-zinc-900 dark:text-white'}}`}}>
                  {{summary ? formatSignedNumber(summary.stockDelta) : "—"}}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1">Cons./day</div>
                <div className="text-lg font-medium text-zinc-900 dark:text-white">
                  {{summary ? formatNumber(summary.averageConsumptionPerDay) : "—"}}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1">Span</div>
                <div className="text-lg font-medium text-zinc-900 dark:text-white">
                  {{summary ? `${{formatNumber(summary.elapsedDays, 0)}} d` : "—"}}
                </div>
              </div>
            </div>
          ) : null}}
        </div>

        <div className="p-6 md:p-8 bg-zinc-50/50 dark:bg-white/[0.02] flex flex-col gap-6">
           <div>
             <h3 className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-4">Procurement Metrics</h3>
             <div className="space-y-3">
                <MetricRow label="Mov. 60d" value={{formatNumber(selected.movement_quantity_60d)}} />
                <MetricRow label="Pend. OC" value={{detail ? formatNumber(detail.pending_purchase_quantity) : detailLoading ? "..." : "—"}} />
                <MetricRow label="Reorden 30d" value={{detail ? formatDate(detail.reorder_date_recent_rate) : detailLoading ? "..." : "—"}} />
                <MetricRow label="Mov. 30d" value={{detail ? formatNumber(detail.movement_quantity_30d) : detailLoading ? "..." : "—"}} />
                <MetricRow 
                  label="Lead time" 
                  value={{
                    !detail ? (detailLoading ? "..." : "—") 
                    : detail.max_lead_time_days !== null && detail.max_lead_time_days !== undefined 
                      ? `${{formatNumber(detail.max_lead_time_days, 0)}} d` : "—"
                  }} 
                />
                <MetricRow label="Dias stock" value={{detail ? formatNumber(detail.days_of_stock_30d) : detailLoading ? "..." : "—"}} />
                <MetricRow label="Ult. OC" value={{detail ? formatDate(detail.last_purchase_order.date) : detailLoading ? "..." : "—"}} />
                <MetricRow label="No. OC" value={{detail ? detail.last_purchase_order.number || "—" : detailLoading ? "..." : "—"}} />
             </div>
           </div>
        </div>
      </div>
    </section>'''

# Add MetricRow right before MovementHistoryCard
metric_row_def = '''function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-black/5 dark:border-white/5 last:border-0">
      <div className="text-xs font-medium text-zinc-500">{label}</div>
      <div className="text-sm font-semibold text-zinc-900 dark:text-white">{value}</div>
    </div>
  );
}

function MovementHistoryCard({'''

content = content[:start_idx] + new_block + '\n  );\n}\n' + content[end_idx+14:]
content = content.replace('function MovementHistoryCard({', metric_row_def)

with open('/home/devuser/Code/Spec Sheets/Frontend/src/pages/MaterialDashboardPage.tsx', 'w') as f:
    f.write(content)

print("Replacement successful")
