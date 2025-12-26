import { useEffect, useMemo, useState } from "react";
import TickerPicker from "./components/TickerPicker";

type UniverseRow = {
  ticker: string;
  name: string;
  assetClass: string;
  riskBucket: string;
};

type PricesDemo = {
  dates: string[];
  series: Record<string, number[]>;
};

function DataSmokeTest() {
  const [status, setStatus] = useState<
    | { ok: true; tickers: number; universe: number; pricesDates: number; pricesSeries: number }
    | { ok: false; message: string }
    | null
  >(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL || "/";
    const u1 = `${base}data/tickers.json`;
    const u2 = `${base}data/universe.json`;
    const u3 = `${base}data/prices_demo.json`;

    (async () => {
      try {
        const [r1, r2, r3] = await Promise.all([fetch(u1), fetch(u2), fetch(u3)]);
        if (!r1.ok || !r2.ok || !r3.ok) {
          throw new Error(
            `Fetch failed: tickers=${r1.status} universe=${r2.status} prices=${r3.status} (base=${base})`
          );
        }

        const tickers = (await r1.json()) as unknown[];
        const universe = (await r2.json()) as UniverseRow[];
        const prices = (await r3.json()) as PricesDemo;

        const pricesSeries = prices?.series ? Object.keys(prices.series).length : 0;
        const pricesDates = prices?.dates ? prices.dates.length : 0;

        setStatus({
          ok: true,
          tickers: tickers.length,
          universe: universe.length,
          pricesDates,
          pricesSeries,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus({ ok: false, message: msg });
      }
    })();
  }, []);

  return (
    <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
      <h3 className="text-sm font-semibold">Data</h3>
      {!status && <div className="mt-2 text-xs text-muted">Loading static JSON…</div>}
      {status?.ok && (
        <div className="mt-2 text-xs text-muted">
          <div>
            Loaded <span className="font-mono">tickers.json</span>: {status.tickers} rows
          </div>
          <div>
            Loaded <span className="font-mono">universe.json</span>: {status.universe} rows
          </div>
          <div>
            Loaded <span className="font-mono">prices_demo.json</span>: {status.pricesSeries} series ·{" "}
            {status.pricesDates} dates
          </div>
        </div>
      )}
      {status && !status.ok && (
        <div className="mt-2 text-xs text-red-600">
          Data load failed: <span className="font-mono">{status.message}</span>
        </div>
      )}
      <div className="mt-3 text-[11px] text-muted">
        Public path: <span className="font-mono">{import.meta.env.BASE_URL || "/"}</span>
      </div>
    </div>
  );
}

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

              <DataSmokeTest />
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