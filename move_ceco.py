with open('/home/devuser/Code/Spec Sheets/Frontend/src/pages/MaterialDashboardPage.tsx', 'r') as f:
    content = f.read()

start = content.find('  return (\n    <div className="-m-6 lg:-m-10 h-[100dvh] flex flex-col xl:flex-row overflow-hidden bg-zinc-50 dark:bg-zinc-950/40">')
end = content.find('  );\n}\n\nfunction SortableHeader')

new_return = '''  return (
    <div className="-m-6 lg:-m-10 h-[100dvh] flex flex-col xl:flex-row overflow-hidden bg-zinc-50 dark:bg-zinc-950/40">
      
      {/* Panel 1: Materials List (now includes search and filters at the top) */}
      <section className="w-full xl:w-[420px] 2xl:w-[480px] flex-shrink-0 flex flex-col border-r border-black/10 dark:border-white/10 bg-white/60 dark:bg-white/[0.01]">
        <div className="p-4 lg:p-6 border-b border-black/5 dark:border-white/5 flex flex-col gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-2">Filters</p>
            <div className="flex items-end justify-between">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">ERP Activity</h2>
              <div className="text-xs text-zinc-500">Updated: {formatDate(data?.generated_at)}</div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="relative">
              <input
                value={materialSearch}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  startTransition(() => setMaterialSearch(nextValue));
                }}
                className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 pl-10 pr-4 py-2.5 text-sm text-zinc-900 dark:text-white outline-none focus:border-accent-500 transition-colors"
                placeholder="SKU or material name"
              />
              <svg className="absolute left-3 top-3 w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleReload}
                className="flex-1 rounded-xl bg-accent-500 text-zinc-950 font-semibold text-sm px-4 py-2 hover:bg-accent-400 transition-colors shadow-sm"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={() => setSelectedCecos([])}
                className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-sm font-medium px-4 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/10 transition-colors shadow-sm"
              >
                Clear Filters
              </button>
            </div>
          </div>
          
          <div className="flex items-center justify-between mt-2 pt-4 border-t border-black/5 dark:border-white/5">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white">{data?.materials.length ?? 0} Materials</h3>
          </div>
          
          {error ? <div className="mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
          {historyError ? <div className="mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{historyError}</div> : null}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-10 text-center text-sm text-zinc-500">Loading materials...</div>
          ) : rows.length ? (
            <div className="divide-y divide-black/5 dark:divide-white/5">
              {rows.map((row) => {
                const active = row.sku === selectedSku;
                return (
                  <div
                    key={row.sku}
                    onClick={() => setSelectedSku(row.sku)}
                    className={`cursor-pointer p-4 transition-colors ${
                      active ? "bg-amber-50 dark:bg-amber-500/10 relative" : "hover:bg-zinc-100 dark:hover:bg-white/5"
                    }`}
                  >
                    {active ? <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" /> : null}
                    <div className="flex justify-between items-start gap-4 mb-2">
                      <h4 className={`text-sm font-semibold leading-tight ${active ? "text-amber-900 dark:text-amber-100" : "text-zinc-900 dark:text-white"}`}>
                        {row.material_name}
                      </h4>
                      <div className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex-shrink-0">
                        {row.sku}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <div><span className="font-medium text-zinc-700 dark:text-zinc-300">{formatNumber(row.movement_quantity_60d)}</span> {row.unit || 'units'} (60d)</div>
                      <div>Last mov: {formatDate(row.last_movement_date)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-10 text-center text-sm text-zinc-500">No materials match the current filters.</div>
          )}
        </div>
      </section>

      {/* Panel 2: Graph, Metrics, and CECOs */}
      <main className="flex-1 min-w-0 bg-white dark:bg-zinc-950 flex flex-col h-full relative overflow-hidden">
        
        {/* Top: Graph and Metrics */}
        <div className="flex-1 flex flex-col min-h-[400px]">
          <MovementHistoryCard
            selected={selectedRow}
            detail={selectedDetail}
            history={currentHistory}
            detailLoading={detailLoading}
            historyLoading={historyLoading}
            detailRefreshing={detailLoading && Boolean(selectedDetail)}
            historyRefreshing={historyLoading && Boolean(currentHistory)}
          />
        </div>

        {/* Bottom: CECO Selection (Compact) */}
        <div className="h-48 lg:h-56 flex-shrink-0 border-t border-black/10 dark:border-white/10 bg-zinc-50/50 dark:bg-zinc-950 flex flex-col">
          <div className="px-6 py-3 border-b border-black/5 dark:border-white/5 flex items-center justify-between bg-white/40 dark:bg-white/[0.02]">
             <div className="flex items-center gap-3">
               <p className="text-xs font-bold uppercase tracking-[0.25em] text-zinc-500">Cost Centers</p>
               <span className="text-[10px] font-semibold bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded-full">{selectedCecos.length} active</span>
             </div>
             
             <div className="w-64">
                <input
                  value={cecoSearch}
                  onChange={(event) => setCecoSearch(event.target.value)}
                  className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 px-3 py-1.5 text-xs text-zinc-900 dark:text-white outline-none focus:border-accent-500 transition-colors"
                  placeholder="Search CECO..."
                />
             </div>
          </div>
          
          <div className="flex-1 p-4 overflow-y-auto">
             <div className="flex flex-wrap gap-2">
                {visibleCecos.length ? (
                  visibleCecos.map((ceco) => {
                    const checked = selectedCecos.includes(ceco.code);
                    return (
                      <button
                        key={ceco.code}
                        type="button"
                        onClick={() => toggleCeco(ceco.code)}
                        className={`text-left px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-2 max-w-[240px] ${
                          checked 
                            ? "border-accent-500/30 bg-accent-50 dark:bg-accent-500/10 text-accent-900 dark:text-accent-100" 
                            : "border-black/5 dark:border-white/5 bg-white dark:bg-white/[0.02] hover:bg-zinc-50 dark:hover:bg-white/5 text-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center ${checked ? "bg-accent-500 text-white" : "border border-zinc-300 dark:border-zinc-600"}`}>
                          {checked ? (
                            <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate">{ceco.code}</div>
                          {ceco.name ? <div className="text-[10px] truncate opacity-70">{ceco.name}</div> : null}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="text-sm text-zinc-500 p-2">No cost centers match.</div>
                )}
             </div>
          </div>
        </div>
      </main>
    </div>
  );'''

content = content[:start] + new_return + '\n' + content[end:]

with open('/home/devuser/Code/Spec Sheets/Frontend/src/pages/MaterialDashboardPage.tsx', 'w') as f:
    f.write(content)

print("Replacement successful")
