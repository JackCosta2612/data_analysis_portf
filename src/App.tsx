export default function App() {
  return (
    <div className="min-h-screen bg-panel text-ink font-sans">
      <div className="flex">
        {/* Left panel (sticky) */}
        <aside className="sticky top-0 h-dvh w-[360px] shrink-0 border-r border-border bg-panel p-4">
          <div className="flex h-full flex-col gap-4">
            <div>
              <div className="text-sm font-semibold">Controls</div>
              <div className="mt-2 text-xs text-muted">
                Next: searchable ticker dropdown, date range, benchmark, weights editor.
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
              <div className="text-sm font-semibold">Ticker picker (placeholder)</div>
              <div className="mt-3 h-10 rounded-xl bg-wash" />
            </div>

            <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
              <div className="text-sm font-semibold">Selected tickers (placeholder)</div>
              <div className="mt-3 h-44 rounded-xl bg-wash" />
            </div>

            <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
              <div className="text-sm font-semibold">Weights (placeholder)</div>
              <div className="mt-3 h-44 rounded-xl bg-wash" />
            </div>

            <div className="mt-auto text-xs text-muted">
              Data pipeline (next): static JSON under <span className="font-mono">/public/data</span>.
            </div>
          </div>
        </aside>

        {/* Right panel */}
        <main className="flex-1 p-6">
          <div className="mx-auto max-w-[1200px]">
            <div className="mb-6">
              <h1 className="font-display text-[20px] font-semibold tracking-tight">
                Portfolio Dashboard
              </h1>
              <p className="mt-2 text-[12px] text-muted">
                Select tickers and weights on the left. Charts and comparisons render here.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <div className="text-sm font-semibold">Equity curve (placeholder)</div>
                <div className="mt-3 h-[260px] rounded-xl bg-wash" />
              </div>

              <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <div className="text-sm font-semibold">Drawdown (placeholder)</div>
                <div className="mt-3 h-[260px] rounded-xl bg-wash" />
              </div>

              <div className="col-span-2 rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <div className="text-sm font-semibold">
                  Benchmark and similar-risk winners (placeholder)
                </div>
                <div className="mt-3 h-[240px] rounded-xl bg-wash" />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}