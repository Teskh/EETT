import re

with open('/home/devuser/Code/Spec Sheets/Frontend/src/pages/MaterialDashboardPage.tsx', 'r') as f:
    content = f.read()

# 1. Modify MovementHistoryCard to remove borders, radius, and make it fill height.
mh_start = '<section className="liquid-glass rounded-[28px] border border-black/10 dark:border-white/10 overflow-hidden flex flex-col">'
mh_end = '    </section>\n  );\n}'

new_mh_start = '<section className="flex-1 flex flex-col h-full bg-white dark:bg-zinc-950 overflow-hidden">'
content = content.replace(mh_start, new_mh_start)

# 2. Modify empty state of MovementHistoryCard
mh_empty = '''      <section className="liquid-glass rounded-[28px] border border-black/10 dark:border-white/10 p-8 min-h-[320px] flex items-center justify-center">
        <div className="text-center max-w-xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-3">Pinned Graph</p>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">Select a material</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Click any row below to pin its 90-day movement history and load the procurement metrics.
          </p>
        </div>
      </section>'''

new_mh_empty = '''      <section className="flex-1 flex items-center justify-center bg-white dark:bg-zinc-950 h-full">
        <div className="text-center max-w-xl p-8">
          <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-white/5 mx-auto flex items-center justify-center mb-6">
            <svg className="w-8 h-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
            </svg>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-3">Pinned Graph</p>
          <h2 className="text-xl font-medium text-zinc-900 dark:text-white mb-2">No material selected</h2>
          <p className="text-sm text-zinc-500">
            Select a material from the list to analyze its movement history, consumption rate, and procurement metrics.
          </p>
        </div>
      </section>'''
content = content.replace(mh_empty, new_mh_empty)

# 3. Modify the main return statement of MaterialDashboardPage
main_return_start = content.find('  return (\n    <div className="max-w-[1800px] mx-auto flex flex-col gap-6">')
main_return_end = content.find('  );\n}\n\nfunction SortableHeader', main_return_start)

new_main_return = '''  return (
    <div className="-m-6 lg:-m-10 h-[100dvh] flex flex-col xl:flex-row overflow-hidden bg-zinc-50 dark:bg-zinc-950/40">
      
      {/* Panel 1: CECO Filters */}
      <aside className="w-full xl:w-[320px] flex-shrink-0 flex flex-col border-r border-black/10 dark:border-white/10 bg-white/40 dark:bg-white/[0.02]">
        <div className="p-4 lg:p-6 border-b border-black/5 dark:border-white/5">
          <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-2">Filters</p>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white">ERP Activity</h2>
          
          <div className="mt-5 space-y-3">
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
                Clear
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 lg:p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-zinc-500">Cost Centers</p>
            <span className="text-[10px] font-semibold bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded-full">{selectedCecos.length}</span>
          </div>
          
          {selectedCecos.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {selectedCecos.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => toggleCeco(code)}
                  className="rounded-lg border border-accent-500/30 bg-accent-50 dark:bg-accent-500/10 px-2 py-1 text-xs font-semibold text-accent-700 dark:text-accent-400 hover:bg-accent-100 dark:hover:bg-accent-500/20 transition-colors flex items-center gap-1"
                >
                  {code}
                  <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              ))}
            </div>
          ) : null}

          <input
            value={cecoSearch}
            onChange={(event) => setCecoSearch(event.target.value)}
            className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 px-4 py-2 text-sm text-zinc-900 dark:text-white outline-none focus:border-accent-500 transition-colors"
            placeholder="Search CECO"
          />
          
          <div className="flex-1 -mx-2 overflow-y-auto px-2">
            {visibleCecos.length ? (
              <div className="space-y-1">
                {visibleCecos.map((ceco) => {
                  const checked = selectedCecos.includes(ceco.code);
                  return (
                    <label key={ceco.code} className={`flex items-start gap-3 p-2.5 rounded-xl cursor-pointer transition-colors ${checked ? "bg-accent-50 dark:bg-accent-500/10" : "hover:bg-zinc-100 dark:hover:bg-white/5"}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleCeco(ceco.code)} className="mt-1 flex-shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm font-medium truncate ${checked ? "text-accent-900 dark:text-accent-100" : "text-zinc-900 dark:text-white"}`}>{ceco.name || ceco.code}</span>
                        <span className={`block text-[10px] uppercase tracking-wider ${checked ? "text-accent-700 dark:text-accent-400" : "text-zinc-500"}`}>{ceco.code}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="py-6 text-sm text-zinc-500 text-center">No cost centers match.</div>
            )}
          </div>
        </div>
      </aside>

      {/* Panel 2: Materials List */}
      <section className="w-full xl:w-[420px] 2xl:w-[480px] flex-shrink-0 flex flex-col border-r border-black/10 dark:border-white/10 bg-white/60 dark:bg-white/[0.01]">
        <div className="p-4 lg:p-6 border-b border-black/5 dark:border-white/5 flex flex-col justify-end min-h-[142px]">
          <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-2">Materials</p>
          <div className="flex items-end justify-between">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{data?.materials.length ?? 0} Items</h2>
            <div className="text-xs text-zinc-500">Updated: {formatDate(data?.generated_at)}</div>
          </div>
          {error ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
          {historyError ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{historyError}</div> : null}
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

      {/* Panel 3: Graph and Metrics */}
      <main className="flex-1 min-w-0 bg-white dark:bg-zinc-950 flex flex-col h-full relative overflow-y-auto xl:overflow-hidden">
        <MovementHistoryCard
          selected={selectedRow}
          detail={selectedDetail}
          history={currentHistory}
          detailLoading={detailLoading}
          historyLoading={historyLoading}
          detailRefreshing={detailLoading && Boolean(selectedDetail)}
          historyRefreshing={historyLoading && Boolean(currentHistory)}
        />
      </main>
    </div>
  );
}'''

content = content[:main_return_start] + new_main_return + '\n\n' + content[main_return_end:]

with open('/home/devuser/Code/Spec Sheets/Frontend/src/pages/MaterialDashboardPage.tsx', 'w') as f:
    f.write(content)

print("Replacement successful")
