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

function PriceDemoChart({
  tickers,
  weights,
}: {
  tickers: string[];
  weights: { ticker: string; w: number }[];
}) {
  const [data, setData] = useState<PricesDemo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL || "/";
    const url = `${base}data/prices_demo.json`;

    (async () => {
      try {
        setErr(null);
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Fetch failed: ${r.status} (${url})`);
        setData((await r.json()) as PricesDemo);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setData(null);
      }
    })();
  }, []);

  const shown = useMemo(() => {
    if (!data) return [] as string[];
    return tickers.filter((t) => t in data.series).slice(0, 8);
  }, [data, tickers]);

  const series = useMemo(() => {
    if (!data) return [] as { t: string; idx: number[] }[];
    return shown.map((t) => {
      const y = data.series[t] ?? [];
      const base = y[0] ?? 1;
      const idx = y.map((v) => (base ? (v / base) * 100 : v));
      return { t, idx };
    });
  }, [data, shown]);

  const portfolio = useMemo(() => {
    if (!data || series.length === 0) return null as null | number[];

    const wmap = new Map(weights.map((x) => [x.ticker, x.w] as const));
    const n = data.dates.length;
    const out = new Array<number>(n).fill(0);

    for (const s of series) {
      const w = wmap.get(s.t) ?? 0;
      for (let i = 0; i < n; i++) out[i] += (s.idx[i] ?? 0) * w;
    }

    return out;
  }, [data, series, weights]);

  if (err) {
    return (
      <div className="mt-3 text-xs text-red-600">
        Price load failed: <span className="font-mono">{err}</span>
      </div>
    );
  }

  if (!data) {
    return <div className="mt-3 text-xs text-muted">Loading price series…</div>;
  }

  if (shown.length === 0) {
    return (
      <div className="mt-3 text-xs text-muted">
        Select tickers that exist in <span className="font-mono">prices_demo.json</span>.
      </div>
    );
  }

  const dates = data.dates;
  const all = [...series.flatMap((s) => s.idx), ...(portfolio ?? [])].filter((x) => Number.isFinite(x));
  const ymin = Math.min(...all);
  const ymax = Math.max(...all);

  const viewW = 760;
  const viewH = 260;
  const left = 52;
  const right = 84;
  const top = 14;
  const bottom = 26;
  const W = viewW - left - right;
  const H = viewH - top - bottom;

  const x = (i: number) => left + (i / Math.max(1, dates.length - 1)) * W;
  const y = (v: number) => top + (1 - (v - ymin) / (ymax - ymin || 1)) * H;

  const yTicks = [0, 0.5, 1].map((p) => ymin + p * (ymax - ymin));

  const lineColors = [
    "#1F2328", // ink
    "#0B3D91",
    "#2F6F8F",
    "#1F7A6A",
    "#6D4C8F",
    "#B07D2B",
    "#C94C4C",
    "#556B2F",
  ];

  return (
    <div className="mt-3">
      <div className="text-[11px] text-muted">
        Normalized to <span className="font-mono">100</span> at start date.
      </div>

      <svg viewBox={`0 0 ${viewW} ${viewH}`} className="mt-2 w-full">
        {/* frame */}
        <line x1={left} y1={top + H} x2={left + W} y2={top + H} stroke="#E5E7EB" />
        <line x1={left} y1={top} x2={left} y2={top + H} stroke="#E5E7EB" />

        {/* y grid + labels */}
        {yTicks.map((tv, k) => (
          <g key={k}>
            <line x1={left} y1={y(tv)} x2={left + W} y2={y(tv)} stroke="#F3F4F6" />
            <text x={left - 8} y={y(tv) + 4} textAnchor="end" fontSize="10" fill="#4B5563">
              {tv.toFixed(0)}
            </text>
          </g>
        ))}

        {/* x labels (start/end) */}
        <text x={left} y={top + H + 18} fontSize="10" fill="#4B5563">
          {dates[0]}
        </text>
        <text x={left + W} y={top + H + 18} textAnchor="end" fontSize="10" fill="#4B5563">
          {dates[dates.length - 1]}
        </text>

        {/* ticker lines */}
        {series.map((s, si) => {
          const d = s.idx
            .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`)
            .join(" ");
          const stroke = lineColors[(si + 1) % lineColors.length];
          return <path key={s.t} d={d} fill="none" strokeWidth="2" stroke={stroke} opacity="0.85" />;
        })}

        {/* portfolio overlay */}
        {portfolio && (
          <path
            d={portfolio
              .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`)
              .join(" ")}
            fill="none"
            strokeWidth="3"
            stroke="#1F2328"
            opacity="0.95"
          />
        )}

        {/* right-side labels */}
        {series.map((s, si) => {
          const last = s.idx[s.idx.length - 1];
          const stroke = lineColors[(si + 1) % lineColors.length];
          return (
            <text key={s.t + "_lbl"} x={left + W + 10} y={y(last) + 4} fontSize="10" fill={stroke}>
              {s.t}
            </text>
          );
        })}

        {portfolio && (
          <text x={left + W + 10} y={y(portfolio[portfolio.length - 1]) + 4} fontSize="10" fill="#1F2328">
            PORT
          </text>
        )}
      </svg>

      <div className="mt-2 text-[11px] text-muted">
        Demo data only (static). Next: real returns, benchmarks, and risk metrics.
      </div>
    </div>
  );
}

export default function App() {
  type Holding = { ticker: string; shares: number };

  const [tickers, setTickers] = useState<string[]>(["AAPL", "MSFT"]);
  const [holdings, setHoldings] = useState<Holding[]>([
    { ticker: "AAPL", shares: 1 },
    { ticker: "MSFT", shares: 1 },
  ]);

  // keep holdings in sync with ticker picker:
  // - when a ticker is added: default shares=1
  // - when removed: drop its holding
  useEffect(() => {
    setHoldings((prev) => {
      const prevMap = new Map(prev.map((h) => [h.ticker, h.shares] as const));

      const next = tickers.map((t) => ({
        ticker: t,
        shares: prevMap.get(t) ?? 1,
      }));

      // if a ticker was added and no prior shares existed, apply equidistribution ONLY if
      // all existing shares were still at the default 1 (i.e., user hasn’t edited yet)
      const prevTickers = prev.map((h) => h.ticker);
      const added = tickers.filter((t) => !prevTickers.includes(t));

      if (added.length > 0) {
        const userEdited = prev.some((h) => h.shares !== 1);
        if (!userEdited) {
          // reset all to 1 (equal by shares)
          return next.map((h) => ({ ...h, shares: 1 }));
        }
      }

      return next;
    });
  }, [tickers]);

  const totalShares = useMemo(
    () => holdings.reduce((s, h) => s + (Number.isFinite(h.shares) ? h.shares : 0), 0),
    [holdings]
  );

  const weights = useMemo(() => {
    const denom = totalShares || 1;
    return holdings.map((h) => ({ ticker: h.ticker, w: h.shares / denom }));
  }, [holdings, totalShares]);
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
                <h3 className="text-sm font-semibold">Weights editor</h3>
                <p className="mt-1 text-xs text-muted">Edit shares (left). % updates automatically.</p>

                <div className="mt-3 space-y-2">
                  {holdings.map((h) => {
                    const pct = (h.shares / (totalShares || 1)) * 100;

                    return (
                      <div key={h.ticker} className="rounded-xl bg-wash px-3 py-2">
                        <div className="flex items-center justify-between">
                          <div className="font-mono text-sm">{h.ticker}</div>
                          <div className="font-mono text-sm text-muted">{pct.toFixed(1)}%</div>
                        </div>

                        <div className="mt-2 flex items-center gap-3">
                          <label className="text-xs text-muted">Shares</label>
                          <input
                            className="w-24 rounded-lg border border-border bg-panel px-2 py-1 font-mono text-sm"
                            type="number"
                            min={0}
                            step={1}
                            value={h.shares}
                            onChange={(e) => {
                              const v = Math.max(0, Math.round(Number(e.target.value || 0)));
                              setHoldings((prev) =>
                                prev.map((x) => (x.ticker === h.ticker ? { ...x, shares: v } : x))
                              );
                            }}
                          />
                          <div className="text-xs text-muted">
                            Total shares: <span className="font-mono">{totalShares}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 text-[11px] text-muted">
                  Next: percentage sliders + auto-rebalance of the other tickers.
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
                <h3 className="text-sm font-semibold">Equity curve (demo)</h3>
                <PriceDemoChart tickers={tickers} weights={weights} />
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