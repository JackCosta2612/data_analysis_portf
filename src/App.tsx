import { useEffect, useMemo, useState } from "react";
import TickerPicker from "./components/TickerPicker";
import Sparkline from "./components/Sparkline";

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

type KPI = { totalReturn: number; cagr: number; maxDrawdown: number };

function formatPct(x: number) {
  const v = x * 100;
  const s = (Math.round(v * 10) / 10).toFixed(1);
  return `${s}%`;
}

function kpisFromIndex(series: number[], dates: string[]): KPI {
  if (!series || series.length < 2 || !dates || dates.length < 2) {
    return { totalReturn: 0, cagr: 0, maxDrawdown: 0 };
  }

  const v0 = series[0];
  const v1 = series[series.length - 1];
  const totalReturn = v0 > 0 ? v1 / v0 - 1 : 0;

  const d0 = new Date(dates[0]).getTime();
  const d1 = new Date(dates[dates.length - 1]).getTime();
  const years = Math.max((d1 - d0) / (1000 * 60 * 60 * 24 * 365.25), 1 / 365.25);
  const cagr = Math.pow(1 + totalReturn, 1 / years) - 1;

  let peak = series[0];
  let maxDD = 0;
  for (const v of series) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? v / peak - 1 : 0;
    if (dd < maxDD) maxDD = dd;
  }

  return { totalReturn, cagr, maxDrawdown: maxDD };
}

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
  onComputed,
}: {
  tickers: string[];
  weights: { ticker: string; w: number }[];
  onComputed?: (x: { dates: string[]; portfolio: number[] | null; kpi: KPI | null }) => void;
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

  const kpi = useMemo(() => {
    if (!data || !portfolio) return null as null | KPI;
    return kpisFromIndex(portfolio, data.dates);
  }, [data, portfolio]);

  useEffect(() => {
    if (!onComputed) return;
    onComputed({
      dates: data?.dates ?? [],
      portfolio: portfolio ?? null,
      kpi: kpi ?? null,
    });
  }, [onComputed, data, portfolio, kpi]);

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

      {kpi && (
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-wash px-3 py-2">
            <div className="text-[11px] text-muted">Total return</div>
            <div className="mt-1 font-mono text-sm text-ink">{formatPct(kpi.totalReturn)}</div>
          </div>
          <div className="rounded-xl bg-wash px-3 py-2">
            <div className="text-[11px] text-muted">CAGR</div>
            <div className="mt-1 font-mono text-sm text-ink">{formatPct(kpi.cagr)}</div>
          </div>
          <div className="rounded-xl bg-wash px-3 py-2">
            <div className="text-[11px] text-muted">Max drawdown</div>
            <div className="mt-1 font-mono text-sm text-ink">{formatPct(kpi.maxDrawdown)}</div>
          </div>
        </div>
      )}

      <div className="mt-3 text-[11px] text-muted">
        Demo data only (static). Next: real returns, benchmarks, and risk metrics.
      </div>
    </div>
  );
}

function BenchmarkAndWinnersCard({
  portfolioTickers,
  portfolioWeights,
  portfolio,
  portfolioKpi,
}: {
  portfolioTickers: string[];
  portfolioWeights: { ticker: string; w: number }[];
  portfolio: number[] | null;
  portfolioKpi: KPI | null;
}) {
  const [universe, setUniverse] = useState<UniverseRow[] | null>(null);
  const [prices, setPrices] = useState<PricesDemo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const BENCH_CANDIDATES: { ticker: string; label: string }[] = [
    { ticker: "SPY", label: "SPY · S&P 500" },
    { ticker: "QQQ", label: "QQQ · Nasdaq 100" },
    { ticker: "VT", label: "VT · Global equities" },
    { ticker: "VEA", label: "VEA · Developed ex-US" },
    { ticker: "EEM", label: "EEM · Emerging markets" },
    { ticker: "AGG", label: "AGG · US bonds" },
    { ticker: "GLD", label: "GLD · Gold" },
  ];

  const [benchmark, setBenchmark] = useState<string>("SPY");

  useEffect(() => {
    const base = import.meta.env.BASE_URL || "/";
    const uUniverse = `${base}data/universe.json`;
    const uPrices = `${base}data/prices_demo.json`;

    (async () => {
      try {
        setErr(null);
        const [rU, rP] = await Promise.all([fetch(uUniverse), fetch(uPrices)]);
        if (!rU.ok || !rP.ok) {
          throw new Error(
            `Fetch failed: universe=${rU.status} prices=${rP.status} (base=${base})`
          );
        }
        setUniverse((await rU.json()) as UniverseRow[]);
        setPrices((await rP.json()) as PricesDemo);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setUniverse(null);
        setPrices(null);
      }
    })();
  }, []);

  const uniMap = useMemo(() => {
    const m = new Map<string, UniverseRow>();
    for (const r of universe ?? []) m.set(r.ticker.toUpperCase(), r);
    return m;
  }, [universe]);

  const availableBench = useMemo(() => {
    if (!prices) return [] as { ticker: string; label: string }[];
    const s = prices.series ?? {};
    const filtered = BENCH_CANDIDATES.filter((b) => b.ticker in s);
    if (filtered.length > 0) return filtered;

    const keys = Object.keys(s).slice(0, 6);
    return keys.map((k) => ({ ticker: k, label: `${k} · (demo series)` }));
  }, [prices]);

  useEffect(() => {
    if (!availableBench.length) return;
    if (!availableBench.some((b) => b.ticker === benchmark)) {
      setBenchmark(availableBench[0].ticker);
    }
  }, [availableBench, benchmark]);

  const inferredRiskBucket = useMemo(() => {
    if (!portfolioWeights.length) return "—";

    const byBucket = new Map<string, number>();
    for (const w of portfolioWeights) {
      const bucket = uniMap.get(w.ticker)?.riskBucket ?? "Unknown";
      byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + w.w);
    }

    let best = "Unknown";
    let bestW = -1;
    for (const [b, w] of byBucket.entries()) {
      if (w > bestW) {
        bestW = w;
        best = b;
      }
    }
    return best;
  }, [portfolioWeights, uniMap]);

  const benchIdx = useMemo(() => {
    if (!prices) return null as null | number[];
    const y = prices.series?.[benchmark];
    if (!y || y.length < 2) return null;
    const base = y[0] ?? 1;
    return y.map((v) => (base ? (v / base) * 100 : v));
  }, [prices, benchmark]);

  const benchKpi = useMemo(() => {
    if (!prices || !benchIdx) return null as null | KPI;
    return kpisFromIndex(benchIdx, prices.dates);
  }, [prices, benchIdx]);

  const winners = useMemo(() => {
    if (!prices || !universe) return [] as (UniverseRow & { kpi: KPI; idx: number[] })[];

    const s = prices.series ?? {};
    const portfolioSet = new Set(portfolioTickers.map((t) => t.toUpperCase()));

    const candidates = universe
      .map((r) => ({ ...r, ticker: r.ticker.toUpperCase() }))
      .filter((r) => r.riskBucket === inferredRiskBucket)
      .filter((r) => r.ticker in s)
      .filter((r) => !portfolioSet.has(r.ticker))
      .filter((r) => r.ticker !== benchmark);

    const scored = candidates
      .map((r) => {
        const y = s[r.ticker] ?? [];
        const base = y[0] ?? 1;
        const idx = y.map((v) => (base ? (v / base) * 100 : v));
        const kpi = kpisFromIndex(idx, prices.dates);
        return { ...r, kpi, idx };
      })
      .filter((r) => Number.isFinite(r.kpi.totalReturn));

    scored.sort((a, b) => b.kpi.totalReturn - a.kpi.totalReturn);

    const beat =
      portfolioKpi?.totalReturn != null
        ? scored.filter((r) => r.kpi.totalReturn > portfolioKpi.totalReturn)
        : [];

    return (beat.length ? beat : scored).slice(0, 6);
  }, [prices, universe, inferredRiskBucket, portfolioTickers, benchmark, portfolioKpi]);

  const combined = useMemo(() => {
    if (!prices) return null as null | { dates: string[]; port: number[]; bench: number[] };
    if (!portfolio || !benchIdx) return null;

    // Keep lengths aligned to the shortest series.
    const n = Math.min(prices.dates.length, portfolio.length, benchIdx.length);
    if (n < 2) return null;

    return {
      dates: prices.dates.slice(0, n),
      port: portfolio.slice(0, n),
      bench: benchIdx.slice(0, n),
    };
  }, [prices, portfolio, benchIdx]);

  const cmpClass = (a: number | null | undefined, b: number | null | undefined, higherIsBetter = true) => {
    if (a == null || b == null) return "text-ink";
    if (!Number.isFinite(a) || !Number.isFinite(b)) return "text-ink";
    if (Math.abs(a - b) < 1e-12) return "text-ink";
    const better = higherIsBetter ? a > b : a < b;
    return better ? "text-emerald-600" : "text-rose-600";
  };

  const portCagrCls = cmpClass(portfolioKpi?.cagr ?? null, benchKpi?.cagr ?? null, true);
  const benchCagrCls = cmpClass(benchKpi?.cagr ?? null, portfolioKpi?.cagr ?? null, true);
  // Max drawdown is negative: a value closer to 0 is better, so “higher is better”.
  const portDdCls = cmpClass(portfolioKpi?.maxDrawdown ?? null, benchKpi?.maxDrawdown ?? null, true);
  const benchDdCls = cmpClass(benchKpi?.maxDrawdown ?? null, portfolioKpi?.maxDrawdown ?? null, true);

  return (
    <div className="mt-3">
      {err && (
        <div className="text-xs text-red-600">
          Data load failed: <span className="font-mono">{err}</span>
        </div>
      )}

      {!err && (!prices || !universe) && <div className="text-xs text-muted">Loading…</div>}

      {!err && prices && universe && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[11px] text-muted">
              Risk bucket inferred from current portfolio:{" "}
              <span className="ml-1 rounded-full border border-border bg-wash px-2 py-0.5 font-mono text-ink">
                {inferredRiskBucket}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-xs text-muted">Benchmark</div>
              <select
                className="rounded-xl border border-border bg-panel px-3 py-2 text-sm"
                value={benchmark}
                onChange={(e) => setBenchmark(e.target.value)}
              >
                {availableBench.map((b) => (
                  <option key={b.ticker} value={b.ticker}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-wash p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-semibold">Portfolio vs benchmark</div>
                <div className="mt-1 text-[11px] text-muted">
                  Both series are normalized to 100 at the first date for easier comparison.
                </div>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-muted">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-[2px] w-6 rounded-full bg-ink" />
                  <span>Portfolio</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-[2px] w-6 rounded-full"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(to right, #2563EB 0 8px, transparent 8px 14px)",
                    }}
                  />
                  <span>Benchmark</span>
                </div>
              </div>
            </div>

            {!combined ? (
              <div className="mt-3 text-xs text-muted">
                Select tickers (and a benchmark that exists in the demo dataset) to render a comparison.
              </div>
            ) : (
              (() => {
                const viewW = 760;
                const viewH = 180;
                const left = 52;
                const right = 18;
                const top = 14;
                const bottom = 26;
                const W = viewW - left - right;
                const H = viewH - top - bottom;

                const dates = combined.dates;
                const port = combined.port;
                const bench = combined.bench;

                const all = [...port, ...bench].filter((x) => Number.isFinite(x));
                const ymin0 = Math.min(...all);
                const ymax0 = Math.max(...all);
                const pad = (ymax0 - ymin0) * 0.04;
                const ymin = ymin0 - pad;
                const ymax = ymax0 + pad;

                const x = (i: number) => left + (i / Math.max(1, dates.length - 1)) * W;
                const y = (v: number) => top + (1 - (v - ymin) / (ymax - ymin || 1)) * H;

                const yTicks = [0, 0.5, 1].map((p) => ymin + p * (ymax - ymin));

                const dPort = port
                  .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`)
                  .join(" ");
                const dBench = bench
                  .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`)
                  .join(" ");

                return (
                  <svg viewBox={`0 0 ${viewW} ${viewH}`} className="mt-3 w-full">
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

                    {/* benchmark (dashed) */}
                    <path
                      d={dBench}
                      fill="none"
                      stroke="#2563EB"
                      strokeWidth="2"
                      strokeDasharray="6 4"
                      opacity="0.95"
                    />

                    {/* portfolio (solid) */}
                    <path d={dPort} fill="none" stroke="#111827" strokeWidth="2.5" opacity="0.95" />
                  </svg>
                );
              })()
            )}

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-panel px-3 py-2">
                <div className="text-[11px] text-muted">Portfolio total</div>
                <div className="mt-1 font-mono text-sm text-ink">
                  {portfolioKpi ? formatPct(portfolioKpi.totalReturn) : "—"}
                </div>
              </div>
              <div className="rounded-xl bg-panel px-3 py-2">
                <div className="text-[11px] text-muted">Benchmark total</div>
                <div className="mt-1 font-mono text-sm text-ink">
                  {benchKpi ? formatPct(benchKpi.totalReturn) : "—"}
                </div>
              </div>
            </div>
          </div>

          {(portfolioKpi || benchKpi) && (
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl bg-wash px-3 py-2">
                <div className="text-[11px] text-muted">Portfolio CAGR</div>
                <div className={`mt-1 font-mono text-sm ${portCagrCls}`}>
                  {portfolioKpi ? formatPct(portfolioKpi.cagr) : "—"}
                </div>
              </div>
              <div className="rounded-xl bg-wash px-3 py-2">
                <div className="text-[11px] text-muted">Benchmark CAGR</div>
                <div className={`mt-1 font-mono text-sm ${benchCagrCls}`}>
                  {benchKpi ? formatPct(benchKpi.cagr) : "—"}
                </div>
              </div>
              <div className="rounded-xl bg-wash px-3 py-2">
                <div className="text-[11px] text-muted">Portfolio max DD</div>
                <div className={`mt-1 font-mono text-sm ${portDdCls}`}>
                  {portfolioKpi ? formatPct(portfolioKpi.maxDrawdown) : "—"}
                </div>
              </div>
              <div className="rounded-xl bg-wash px-3 py-2">
                <div className="text-[11px] text-muted">Benchmark max DD</div>
                <div className={`mt-1 font-mono text-sm ${benchDdCls}`}>
                  {benchKpi ? formatPct(benchKpi.maxDrawdown) : "—"}
                </div>
              </div>
            </div>
          )}

          <div className="mt-5">
            <div className="text-xs font-semibold">Similar-risk winners</div>
            <div className="mt-1 text-[11px] text-muted">
              Top performers in the same <span className="font-mono">riskBucket</span> ({inferredRiskBucket}) that
              outperform the current portfolio (when possible).
            </div>

            {winners.length === 0 ? (
              <div className="mt-3 text-xs text-muted">No comparable tickers found in the current demo dataset.</div>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(() => {
                  const winColors = [
                    "#0B3D91",
                    "#2F6F8F",
                    "#1F7A6A",
                    "#6D4C8F",
                    "#B07D2B",
                    "#C94C4C",
                  ];

                  return winners.map((r, i) => {
                    const stroke = winColors[i % winColors.length];
                    const spark = (r.idx ?? []).map((v) => ({ value: v }));

                    const dPort =
                      portfolioKpi?.totalReturn != null ? r.kpi.totalReturn - portfolioKpi.totalReturn : null;
                    const dBench = benchKpi?.totalReturn != null ? r.kpi.totalReturn - benchKpi.totalReturn : null;

                    const cls = (x: number | null) => {
                      if (x == null || !Number.isFinite(x)) return "text-ink";
                      if (Math.abs(x) < 1e-12) return "text-ink";
                      return x > 0 ? "text-emerald-600" : "text-rose-600";
                    };

                    return (
                      <div key={r.ticker} className="rounded-2xl border border-border bg-panel p-3 shadow-soft">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-mono text-sm">{r.ticker}</div>
                            <div className="mt-0.5 text-xs text-muted line-clamp-2">{r.name}</div>
                          </div>

                          <div className="text-right">
                            <div className="text-[11px] text-muted">Total</div>
                            <div className="mt-0.5 font-mono text-sm text-ink">{formatPct(r.kpi.totalReturn)}</div>
                          </div>
                        </div>

                        <div className="mt-2 rounded-xl bg-wash p-2">
                          <Sparkline series={spark} width={260} height={70} stroke={stroke} strokeWidth={2} />
                        </div>

                        <div className="mt-3 grid grid-cols-3 gap-2">
                          <div className="rounded-xl bg-wash px-2 py-2">
                            <div className="text-[11px] text-muted">CAGR</div>
                            <div className="mt-0.5 font-mono text-[12px] text-ink">{formatPct(r.kpi.cagr)}</div>
                          </div>
                          <div className="rounded-xl bg-wash px-2 py-2">
                            <div className="text-[11px] text-muted">Max DD</div>
                            <div className="mt-0.5 font-mono text-[12px] text-ink">{formatPct(r.kpi.maxDrawdown)}</div>
                          </div>
                          <div className="rounded-xl bg-wash px-2 py-2">
                            <div className="text-[11px] text-muted">Δ vs Port</div>
                            <div className={`mt-0.5 font-mono text-[12px] ${cls(dPort)}`}>{dPort == null ? "—" : formatPct(dPort)}</div>
                          </div>
                        </div>

                        <div className="mt-2 text-[11px] text-muted">
                          Δ vs bench: <span className={`font-mono ${cls(dBench)}`}>{dBench == null ? "—" : formatPct(dBench)}</span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>

          <div className="mt-4 text-[11px] text-muted">
            Demo logic uses <span className="font-mono">universe.json</span> (risk buckets) +{" "}
            <span className="font-mono">prices_demo.json</span> (static prices). Next: replace with real historical data.
          </div>
        </>
      )}
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

  const [computed, setComputed] = useState<{
    dates: string[];
    portfolio: number[] | null;
    kpi: KPI | null;
  } | null>(null);

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
                <PriceDemoChart tickers={tickers} weights={weights} onComputed={setComputed} />
              </section>

              <section className="col-span-12 lg:col-span-4 rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <h3 className="text-sm font-semibold">Drawdown (demo)</h3>

                {!computed?.portfolio || computed.portfolio.length < 2 ? (
                  <div className="mt-3 text-xs text-muted">Select tickers to compute a portfolio drawdown.</div>
                ) : (
                  (() => {
                    const dd: number[] = [];
                    let peak = computed.portfolio![0];
                    for (const v of computed.portfolio!) {
                      if (v > peak) peak = v;
                      dd.push(peak > 0 ? v / peak - 1 : 0);
                    }

                    const ddPts = dd.map((v) => ({ value: v * 100 }));

                    const minDD = Math.min(...dd);
                    const currentDD = dd[dd.length - 1] ?? 0;
                    const avgDD = dd.length ? dd.reduce((a, b) => a + b, 0) / dd.length : 0;
                    const pctInDD = dd.length ? dd.filter((v) => v < 0).length / dd.length : 0;

                    // drawdown durations (in points)
                    let currentLen = 0;
                    for (let i = dd.length - 1; i >= 0; i--) {
                      if (dd[i] < 0) currentLen++;
                      else break;
                    }
                    let maxLen = 0;
                    let run = 0;
                    for (const v of dd) {
                      if (v < 0) {
                        run++;
                        if (run > maxLen) maxLen = run;
                      } else {
                        run = 0;
                      }
                    }

                    return (
                      <div className="mt-3">
                        <div className="text-[11px] text-muted">Negative % from peak (higher is better).</div>

                        <div className="mt-2 rounded-xl bg-wash p-3">
                          <Sparkline series={ddPts} width={520} height={120} stroke="#1F2328" strokeWidth={2} />
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3">
                          <div className="rounded-xl bg-wash px-3 py-2">
                            <div className="text-[11px] text-muted">Current drawdown</div>
                            <div className="mt-1 font-mono text-sm text-ink">{formatPct(currentDD)}</div>
                          </div>
                          <div className="rounded-xl bg-wash px-3 py-2">
                            <div className="text-[11px] text-muted">Worst drawdown</div>
                            <div className="mt-1 font-mono text-sm text-ink">{formatPct(minDD)}</div>
                          </div>
                          <div className="rounded-xl bg-wash px-3 py-2">
                            <div className="text-[11px] text-muted">Time in drawdown</div>
                            <div className="mt-1 font-mono text-sm text-ink">{formatPct(pctInDD)}</div>
                          </div>
                          <div className="rounded-xl bg-wash px-3 py-2">
                            <div className="text-[11px] text-muted">Max drawdown length</div>
                            <div className="mt-1 font-mono text-sm text-ink">{maxLen} pts</div>
                          </div>
                        </div>

                        <div className="mt-3 text-[11px] text-muted">
                          Avg drawdown: <span className="font-mono text-ink">{formatPct(avgDD)}</span> · Current streak: {" "}
                          <span className="font-mono text-ink">{currentLen} pts</span>
                        </div>
                      </div>
                    );
                  })()
                )}
              </section>

              <section className="col-span-12 rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <h3 className="text-sm font-semibold">Benchmark and similar-risk winners</h3>
                <BenchmarkAndWinnersCard
                  portfolioTickers={tickers}
                  portfolioWeights={weights}
                  portfolio={computed?.portfolio ?? null}
                  portfolioKpi={computed?.kpi ?? null}
                />
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