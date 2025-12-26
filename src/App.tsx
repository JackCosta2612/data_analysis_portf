import { useMemo, useState } from "react";
import TickerPicker from "./components/TickerPicker";

export default function App() {
  const [tickers, setTickers] = useState<string[]>(["AAPL", "MSFT"]);

  const weights = useMemo(() => {
    const n = tickers.length || 1;
    return tickers.map((t) => ({ ticker: t, w: 1 / n }));
  }, [tickers]);
  return (
    <div className="min-h-screen bg-panel text-ink font-sans">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Left panel (sticky filters) */}
          <aside className="col-span-12 md:col-span-4 lg:col-span-3">
            <div className="sticky top-6 space-y-4">
              <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <h2 className="text-sm font-semibold">Controls</h2>
                <p className="mt-1 text-xs text-muted">
                  Next: searchable ticker dropdown, date range, benchmark, weights editor.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <TickerPicker value={tickers} onChange={setTickers} />
              </div>

              <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <h3 className="text-sm font-semibold">Selected tickers</h3>
                <div className="mt-3 space-y-2">
                  {weights.map((x) => (
                    <div
                      key={x.ticker}
                      className="flex items-center justify-between rounded-xl bg-wash px-3 py-2"
                    >
                      <div className="font-mono text-sm">{x.ticker}</div>
                      <div className="font-mono text-sm text-muted">{(x.w * 100).toFixed(1)}%</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <h3 className="text-sm font-semibold">Weights</h3>
                <div className="mt-3 text-xs text-muted">
                  Next: absolute shares + % sliders (auto-normalized).
                </div>
              </div>

              <div className="text-xs text-muted">
                Data pipeline (next): static JSON under <span className="font-mono">/public/data</span>.
              </div>
            </div>
          </aside>

          {/* Right panel (content) */}
          <main className="col-span-12 md:col-span-8 lg:col-span-9">
            <header className="mb-4">
              <h1 className="font-display text-[20px] font-semibold tracking-tight">
                Portfolio Dashboard
              </h1>
              <p className="mt-2 text-[12px] text-muted">
                Select tickers and weights on the left. Charts and comparisons render here.
              </p>
            </header>

            <div className="grid grid-cols-12 gap-6">
              <section className="col-span-12 lg:col-span-8 rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <h3 className="text-sm font-semibold">Equity curve</h3>
                <div className="mt-3 h-64 rounded-xl bg-wash" />
              </section>

              <section className="col-span-12 lg:col-span-4 rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <h3 className="text-sm font-semibold">Drawdown</h3>
                <div className="mt-3 h-64 rounded-xl bg-wash" />
              </section>

              <section className="col-span-12 rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <h3 className="text-sm font-semibold">Benchmark and similar-risk winners</h3>
                <div className="mt-3 h-56 rounded-xl bg-wash" />
              </section>
            </div>

            <footer className="mt-6 text-xs text-muted">
              Deployed at <span className="font-mono">/data_analysis_portf/</span> (GitHub Pages).
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}