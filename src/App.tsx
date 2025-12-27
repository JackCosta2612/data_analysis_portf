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

type RangeKey = "1D" | "5D" | "6M" | "YTD" | "1Y" | "5Y" | "ALL";

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "1D", label: "1D" },
  { key: "5D", label: "5D" },
  { key: "6M", label: "6M" },
  { key: "YTD", label: "YTD" },
  { key: "1Y", label: "1Y" },
  { key: "5Y", label: "5Y" },
  { key: "ALL", label: "All" },
];

function _shiftDate(d: Date, { days = 0, months = 0, years = 0 }: { days?: number; months?: number; years?: number }) {
  const out = new Date(d.getTime());
  if (years) out.setFullYear(out.getFullYear() + years);
  if (months) out.setMonth(out.getMonth() + months);
  if (days) out.setDate(out.getDate() + days);
  return out;
}

function rangeStart(end: Date, key: RangeKey): Date | null {
  if (key === "ALL") return null;
  if (key === "1D") return _shiftDate(end, { days: -1 });
  if (key === "5D") return _shiftDate(end, { days: -5 });
  if (key === "6M") return _shiftDate(end, { months: -6 });
  if (key === "YTD") return new Date(end.getFullYear(), 0, 1);
  if (key === "1Y") return _shiftDate(end, { years: -1 });
  return _shiftDate(end, { years: -5 });
}

function indicesForRange(dates: string[], key: RangeKey): number[] {
  if (!dates || dates.length === 0) return [];

  const ts = dates
    .map((d, i) => ({ i, t: new Date(d).getTime() }))
    .filter((x) => Number.isFinite(x.t));

  if (ts.length === 0) {
    // fallback: treat as simple ordinal series
    const minN = Math.min(dates.length, key === "1D" ? 2 : key === "5D" ? 6 : dates.length);
    return Array.from({ length: minN }, (_, k) => dates.length - minN + k);
  }

  ts.sort((a, b) => a.t - b.t);
  const end = new Date(ts[ts.length - 1].t);
  const start = rangeStart(end, key);

  let idx = start ? ts.filter((x) => x.t >= start.getTime()).map((x) => x.i) : ts.map((x) => x.i);

  // Ensure we have enough points to draw a meaningful line
  if (idx.length < 2 && dates.length >= 2) {
    const take = Math.min(dates.length, key === "1D" ? 2 : key === "5D" ? 6 : 12);
    idx = Array.from({ length: take }, (_, k) => dates.length - take + k);
  }

  return idx;
}

const AXIS_FONT_FAMILY =
  "Roboto Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace";
const AXIS_FONT_SIZE = 10;
const AXIS_FILL = "#4B5563";

function firstFinite(xs: number[]): number | null {
  for (const v of xs) {
    if (Number.isFinite(v)) return v as number;
  }
  return null;
}

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


function TickerPriceCards({
  tickers,
  rangeKey,
  placement = "sidebar",
}: {
  tickers: string[];
  rangeKey: RangeKey;
  placement?: "sidebar" | "main";
}) {
  const [prices, setPrices] = useState<PricesDemo | null>(null);
  const [universe, setUniverse] = useState<UniverseRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL || "/";
    const uPricesReal = `${base}data/prices.json`;
    const uPricesDemo = `${base}data/prices_demo.json`;
    const uUniverse = `${base}data/universe.json`;

    (async () => {
      try {
        setErr(null);
        const [rP0, rU] = await Promise.all([fetch(uPricesReal), fetch(uUniverse)]);
        const rP = rP0.ok ? rP0 : await fetch(uPricesDemo);
        if (!rP.ok || !rU.ok) {
          throw new Error(`Fetch failed: prices(real=${rP0.status}, demo=${rP.status}) universe=${rU.status} (base=${base})`);
        }
        setPrices((await rP.json()) as PricesDemo);
        setUniverse((await rU.json()) as UniverseRow[]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setPrices(null);
        setUniverse(null);
      }
    })();
  }, []);

  const uniMap = useMemo(() => {
    const m = new Map<string, UniverseRow>();
    for (const r of universe ?? []) m.set(r.ticker.toUpperCase(), r);
    return m;
  }, [universe]);

  const shown = useMemo(() => {
    const wanted = tickers.map((t) => t.toUpperCase());
    if (!prices) return wanted;
    return wanted.filter((t) => t in (prices.series ?? {}));
  }, [tickers, prices]);

  const selIdx = useMemo(() => {
    if (!prices) return [] as number[];
    return indicesForRange(prices.dates, rangeKey);
  }, [prices, rangeKey]);

  const datesR = useMemo(() => {
    if (!prices) return [] as string[];
    return selIdx.map((i) => prices.dates[i]).filter((d) => typeof d === "string");
  }, [prices, selIdx]);

  const LineCard = ({ t }: { t: string }) => {
    const y0 = prices?.series?.[t] ?? [];
    const yR = selIdx.map((i) => y0[i]).map((v) => (Number.isFinite(v) ? (v as number) : NaN));
    const clean = yR.filter((v) => Number.isFinite(v)) as number[];

    const first = Number.isFinite(yR[0]) ? (yR[0] as number) : (clean[0] ?? NaN);
    const last = Number.isFinite(yR[yR.length - 1]) ? (yR[yR.length - 1] as number) : (clean[clean.length - 1] ?? NaN);
    const ret = Number.isFinite(first) && Number.isFinite(last) && first !== 0 ? last / first - 1 : 0;

    const up = ret >= 0;
    const stroke = up ? "#059669" : "#E11D48";
    const fill = up ? "rgba(5, 150, 105, 0.12)" : "rgba(225, 29, 72, 0.12)";

    const name = uniMap.get(t)?.name;

    if (!prices || datesR.length < 2 || clean.length < 2) {
      return (
        <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-sm">{t}</div>
              <div className="mt-0.5 text-xs text-muted">{name ?? ""}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-muted">Range</div>
              <div className="mt-0.5 font-mono text-sm text-ink">—</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-muted">Not enough points in this range.</div>
        </div>
      );
    }

    // Yahoo-finance style: line + light area fill, minimal axes.
    const labelGutter = 26;
    const viewW = 360 + labelGutter;
    const viewH = 140;
    const left = 10 + labelGutter;
    const right = 10;
    const top = 8;
    const bottom = 22;
    const W = viewW - left - right;
    const H = viewH - top - bottom;

    const ymin0 = Math.min(...clean);
    const ymax0 = Math.max(...clean);
    const pad = (ymax0 - ymin0) * 0.06;
    const ymin = ymin0 - pad;
    const ymax = ymax0 + pad;

    const x = (i: number) => left + (i / Math.max(1, datesR.length - 1)) * W;
    const y = (v: number) => top + (1 - (v - ymin) / (ymax - ymin || 1)) * H;

    const dLine = yR
      .map((v, i) => {
        const vv = Number.isFinite(v) ? (v as number) : NaN;
        if (!Number.isFinite(vv)) return null;
        return `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${y(vv).toFixed(2)}`;
      })
      .filter(Boolean)
      .join(" ");

    const yBase = top + H;
    const x0 = x(0);
    const xN = x(datesR.length - 1);
    const dArea = `${dLine} L ${xN.toFixed(2)} ${yBase.toFixed(2)} L ${x0.toFixed(2)} ${yBase.toFixed(2)} Z`;

    const clsRet = up ? "text-emerald-600" : "text-rose-600";

    return (
      <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-sm">{t}</div>
            <div className="mt-0.5 text-xs text-muted line-clamp-1">{name ?? ""}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-muted">Change</div>
            <div className={`mt-0.5 font-mono text-sm ${clsRet}`}>{formatPct(ret)}</div>
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-wash p-2">
          <svg
            viewBox={`0 0 ${viewW} ${viewH}`}
            className="w-full"
            style={{ fontFamily: AXIS_FONT_FAMILY, fontSize: AXIS_FONT_SIZE, fill: AXIS_FILL }}
          >
            {/* subtle grid */}
            <line x1={left} y1={top + H} x2={left + W} y2={top + H} stroke="#E5E7EB" />
            <line x1={left} y1={top + H * 0.5} x2={left + W} y2={top + H * 0.5} stroke="#F3F4F6" />

            {/* area */}
            <path d={dArea} fill={fill} stroke="none" />

            {/* line */}
            <path d={dLine} fill="none" stroke={stroke} strokeWidth="2.25" />

            {/* y labels (outside plot, in gutter) */}
            <text
              x={left - 8}
              y={top + 10}
              textAnchor="end"
              fontFamily={AXIS_FONT_FAMILY}
              fontSize={AXIS_FONT_SIZE}
              fill={AXIS_FILL}
            >
              {ymax0.toFixed(1)}
            </text>
            <text
              x={left - 8}
              y={top + H + 6}
              textAnchor="end"
              fontFamily={AXIS_FONT_FAMILY}
              fontSize={AXIS_FONT_SIZE}
              fill={AXIS_FILL}
            >
              {ymin0.toFixed(1)}
            </text>

            {/* start/end dates */}
            <text x={left} y={viewH - 6} fontFamily={AXIS_FONT_FAMILY} fontSize={AXIS_FONT_SIZE} fill={AXIS_FILL}>
              {datesR[0]}
            </text>
            <text
              x={left + W}
              y={viewH - 6}
              textAnchor="end"
              fontFamily={AXIS_FONT_FAMILY}
              fontSize={AXIS_FONT_SIZE}
              fill={AXIS_FILL}
            >
              {datesR[datesR.length - 1]}
            </text>
          </svg>
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
          <div>
            Last: <span className="font-mono text-ink">{Number.isFinite(last) ? last.toFixed(2) : "—"}</span>
          </div>
          <div>
            First: <span className="font-mono text-ink">{Number.isFinite(first) ? first.toFixed(2) : "—"}</span>
          </div>
        </div>
      </div>
    );
  };

  if (err) {
    return (
      <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
        <div className="text-sm font-semibold">Tickers</div>
        <div className="mt-2 text-xs text-red-600">
          Data load failed: <span className="font-mono">{err}</span>
        </div>
      </div>
    );
  }

  if (!prices || !universe) {
    return (
      <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
        <div className="text-sm font-semibold">Tickers</div>
        <div className="mt-2 text-xs text-muted">Loading ticker charts…</div>
      </div>
    );
  }

  if (!shown.length) {
    return (
      <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
        <div className="text-sm font-semibold">Tickers</div>
        <div className="mt-2 text-xs text-muted">Select tickers to see individual charts.</div>
      </div>
    );
  }

  return (
    <div className={placement === "main" ? "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" : "space-y-4"}>
      {shown.map((t) => (
        <LineCard key={t} t={t} />
      ))}
    </div>
  );
}

function PriceDemoChart({
  tickers,
  weights,
  rangeKey,
  onComputed,
}: {
  tickers: string[];
  weights: { ticker: string; w: number }[];
  rangeKey: RangeKey;
  onComputed?: (x: { dates: string[]; portfolio: number[] | null; kpi: KPI | null }) => void;
}) {
  const [data, setData] = useState<PricesDemo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL || "/";
    const urlReal = `${base}data/prices.json`;
    const urlDemo = `${base}data/prices_demo.json`;

    (async () => {
      try {
        setErr(null);
        const r0 = await fetch(urlReal);
        const r = r0.ok ? r0 : await fetch(urlDemo);
        if (!r.ok) throw new Error(`Fetch failed: real=${r0.status} demo=${r.status} (base=${base})`);
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

  const selIdx = useMemo(() => {
    if (!data) return [] as number[];
    return indicesForRange(data.dates, rangeKey);
  }, [data, rangeKey]);

  const datesR = useMemo(() => {
    if (!data) return [] as string[];
    return selIdx.map((i) => data.dates[i]).filter((d) => typeof d === "string");
  }, [data, selIdx]);

  const series = useMemo(() => {
    if (!data) return [] as { t: string; idx: number[] }[];

    return shown.map((t) => {
      const y = data.series[t] ?? [];
      const yR = selIdx.map((i) => y[i]).map((v) => (Number.isFinite(v) ? (v as number) : NaN));
      const base = firstFinite(yR) ?? 1;
      const idx = yR.map((v) => (Number.isFinite(v) ? (base ? ((v as number) / base) * 100 : (v as number)) : NaN));
      return { t, idx };
    });
  }, [data, shown, selIdx]);

  const portfolio = useMemo(() => {
    if (!data || series.length === 0) return null as null | number[];

    const wmap = new Map(weights.map((x) => [x.ticker, x.w] as const));
    const n = datesR.length;
    const out = new Array<number>(n).fill(0);

    for (const s of series) {
      const w = wmap.get(s.t) ?? 0;
      for (let i = 0; i < n; i++) {
        const v = s.idx[i];
        out[i] += (Number.isFinite(v) ? (v as number) : 0) * w;
      }
    }

    return out;
  }, [data, series, weights, datesR.length]);

  const kpi = useMemo(() => {
    if (!data || !portfolio) return null as null | KPI;
    return kpisFromIndex(portfolio, datesR);
  }, [data, portfolio, datesR]);

  useEffect(() => {
    if (!onComputed) return;
    onComputed({
      dates: datesR,
      portfolio: portfolio ?? null,
      kpi: kpi ?? null,
    });
  }, [onComputed, data, portfolio, kpi, datesR]);

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

  const dates = datesR;
  const all = [...series.flatMap((s) => s.idx), ...(portfolio ?? [])].filter((x) => Number.isFinite(x));
  const ymin = Math.min(...all);
  const ymax = Math.max(...all);

  const viewW = 760;
  const viewH = 260;

  // With axis labels rendered as HTML (outside the SVG), we can shrink the internal left margin.
  // Keep a small left padding to avoid stroke clipping on the edge.
  const left = 4;
  const right = 84;
  const top = 14;
  const bottom = 14;

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

      <div className="mt-2 grid grid-cols-[auto,1fr] gap-2 items-stretch">
        {/* Y-axis labels (outside SVG so font size is stable) */}
        <div
          className="flex flex-col justify-between text-right"
          style={{
            width: 44,
            paddingTop: top,
            paddingBottom: bottom,
            fontFamily: AXIS_FONT_FAMILY,
            fontSize: AXIS_FONT_SIZE,
            color: AXIS_FILL,
          }}
        >
          {[...yTicks]
            .slice()
            .reverse()
            .map((tv, k) => (
              <div key={k} style={{ lineHeight: 1 }}>
                {tv.toFixed(0)}
              </div>
            ))}
        </div>

        <div className="min-w-0">
          {/* Keep chart responsive but with a stable aspect ratio matching the viewBox */}
          <div className="aspect-[760/260] w-full">
            <svg
              viewBox={`0 0 ${viewW} ${viewH}`}
              className="h-full w-full"
              style={{ fontFamily: AXIS_FONT_FAMILY, fontSize: AXIS_FONT_SIZE, fill: AXIS_FILL }}
            >
              {/* frame */}
              <line x1={left} y1={top + H} x2={left + W} y2={top + H} stroke="#E5E7EB" />
              <line x1={left} y1={top} x2={left} y2={top + H} stroke="#E5E7EB" />

              {/* y grid (labels are outside) */}
              {yTicks.map((tv, k) => (
                <g key={k}>
                  <line x1={left} y1={y(tv)} x2={left + W} y2={y(tv)} stroke="#F3F4F6" />
                </g>
              ))}

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
                  <text
                    key={s.t + "_lbl"}
                    x={left + W + 10}
                    y={y(last) + 4}
                    fontSize={AXIS_FONT_SIZE}
                    fill={stroke}
                    fontFamily={AXIS_FONT_FAMILY}
                  >
                    {s.t}
                  </text>
                );
              })}

              {portfolio && (
                <text
                  x={left + W + 10}
                  y={y(portfolio[portfolio.length - 1]) + 4}
                  fontSize={AXIS_FONT_SIZE}
                  fill="#1F2328"
                  fontFamily={AXIS_FONT_FAMILY}
                >
                  PORT
                </text>
              )}
            </svg>
          </div>

          {/* X-axis labels (outside SVG so font size is stable) */}
          <div
            className="mt-1 flex justify-between"
            style={{
              paddingLeft: left,
              paddingRight: right,
              fontFamily: AXIS_FONT_FAMILY,
              fontSize: AXIS_FONT_SIZE,
              color: AXIS_FILL,
            }}
          >
            <span>{dates[0]}</span>
            <span>{dates[dates.length - 1]}</span>
          </div>
        </div>
      </div>

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
  rangeKey,
}: {
  portfolioTickers: string[];
  portfolioWeights: { ticker: string; w: number }[];
  portfolio: number[] | null;
  portfolioKpi: KPI | null;
  rangeKey: RangeKey;
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
    const uPricesReal = `${base}data/prices.json`;
    const uPricesDemo = `${base}data/prices_demo.json`;

    (async () => {
      try {
        setErr(null);
        const [rU, rP0] = await Promise.all([fetch(uUniverse), fetch(uPricesReal)]);
        const rP = rP0.ok ? rP0 : await fetch(uPricesDemo);
        if (!rU.ok || !rP.ok) {
          throw new Error(`Fetch failed: universe=${rU.status} prices(real=${rP0.status}, demo=${rP.status}) (base=${base})`);
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

  const selIdx = useMemo(() => {
    if (!prices) return [] as number[];
    return indicesForRange(prices.dates, rangeKey);
  }, [prices, rangeKey]);

  const datesR = useMemo(() => {
    if (!prices) return [] as string[];
    return selIdx.map((i) => prices.dates[i]).filter((d) => typeof d === "string");
  }, [prices, selIdx]);

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

    const yR = selIdx.map((i) => y[i]).map((v) => (Number.isFinite(v) ? (v as number) : NaN));
    if (yR.length < 2) return null;

    const base = firstFinite(yR) ?? 1;
    return yR.map((v) => (Number.isFinite(v) ? (base ? ((v as number) / base) * 100 : (v as number)) : NaN));
  }, [prices, benchmark, selIdx]);

  const benchKpi = useMemo(() => {
    if (!prices || !benchIdx) return null as null | KPI;
    return kpisFromIndex(benchIdx, datesR);
  }, [prices, benchIdx, datesR]);

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
        const yR = selIdx.map((i) => y[i]).map((v) => (Number.isFinite(v) ? (v as number) : NaN));
        const base = firstFinite(yR) ?? 1;
        const idx = yR.map((v) => (Number.isFinite(v) ? (base ? ((v as number) / base) * 100 : (v as number)) : NaN));
        const kpi = kpisFromIndex(idx, datesR);
        return { ...r, kpi, idx };
      })
      .filter((r) => Number.isFinite(r.kpi.totalReturn));

    scored.sort((a, b) => b.kpi.totalReturn - a.kpi.totalReturn);

    const beat =
      portfolioKpi?.totalReturn != null
        ? scored.filter((r) => r.kpi.totalReturn > portfolioKpi.totalReturn)
        : [];

    return (beat.length ? beat : scored).slice(0, 6);
  }, [prices, universe, inferredRiskBucket, portfolioTickers, benchmark, portfolioKpi, selIdx, datesR]);

  const combined = useMemo(() => {
    if (!prices) return null as null | { dates: string[]; port: number[]; bench: number[] };
    if (!portfolio || !benchIdx) return null;

    // Keep lengths aligned to the shortest series.
    const n = Math.min(datesR.length, portfolio.length, benchIdx.length);
    if (n < 2) return null;

    return {
      dates: datesR.slice(0, n),
      port: portfolio.slice(0, n),
      bench: benchIdx.slice(0, n),
    };
  }, [prices, portfolio, benchIdx, datesR]);

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

              <div className="flex flex-col items-end gap-1 text-[11px] text-muted">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-[3px] w-8 rounded-full" style={{ backgroundColor: "#111827" }} />
                  <span>Portfolio</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-[3px] w-8 rounded-full"
                    style={{
                      backgroundImage: "repeating-linear-gradient(to right, #2563EB 0 8px, transparent 8px 14px)",
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
                const labelGutter = 22; // extra room for y-axis labels (prevents clipping)
                const viewW = 760 + labelGutter;
                const viewH = 180;
                const left = 52 + labelGutter;
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
                  <svg
                    viewBox={`0 0 ${viewW} ${viewH}`}
                    className="mt-3 w-full"
                    style={{ fontFamily: AXIS_FONT_FAMILY, fontSize: AXIS_FONT_SIZE, fill: AXIS_FILL }}
                  >
                    {/* frame */}
                    <line x1={left} y1={top + H} x2={left + W} y2={top + H} stroke="#E5E7EB" />
                    <line x1={left} y1={top} x2={left} y2={top + H} stroke="#E5E7EB" />

                    {/* y grid + labels */}
                    {yTicks.map((tv, k) => (
                      <g key={k}>
                        <line x1={left} y1={y(tv)} x2={left + W} y2={y(tv)} stroke="#F3F4F6" />
                        <text
                          x={left - 8}
                          y={y(tv) + 4}
                          textAnchor="end"
                          fontSize={AXIS_FONT_SIZE}
                          fill={AXIS_FILL}
                          fontFamily={AXIS_FONT_FAMILY}
                        >
                          {tv.toFixed(0)}
                        </text>
                      </g>
                    ))}

                    {/* x labels (start/end) */}
                    <text
                      x={left}
                      y={top + H + 18}
                      fontSize={AXIS_FONT_SIZE}
                      fill={AXIS_FILL}
                      fontFamily={AXIS_FONT_FAMILY}
                    >
                      {dates[0]}
                    </text>
                    <text
                      x={left + W}
                      y={top + H + 18}
                      textAnchor="end"
                      fontSize={AXIS_FONT_SIZE}
                      fill={AXIS_FILL}
                      fontFamily={AXIS_FONT_FAMILY}
                    >
                      {dates[dates.length - 1]}
                    </text>

                    {/* benchmark (dashed) */}
                    <path d={dBench} fill="none" stroke="#2563EB" strokeWidth="2" strokeDasharray="6 4" opacity="0.95" />

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
                <div className="mt-1 font-mono text-sm text-ink">{benchKpi ? formatPct(benchKpi.totalReturn) : "—"}</div>
              </div>
            </div>
          </div>

          {(portfolioKpi || benchKpi) && (
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl bg-wash px-3 py-2">
                <div className="text-[11px] text-muted">Portfolio CAGR</div>
                <div className={`mt-1 font-mono text-sm ${portCagrCls}`}>{portfolioKpi ? formatPct(portfolioKpi.cagr) : "—"}</div>
              </div>
              <div className="rounded-xl bg-wash px-3 py-2">
                <div className="text-[11px] text-muted">Benchmark CAGR</div>
                <div className={`mt-1 font-mono text-sm ${benchCagrCls}`}>{benchKpi ? formatPct(benchKpi.cagr) : "—"}</div>
              </div>
              <div className="rounded-xl bg-wash px-3 py-2">
                <div className="text-[11px] text-muted">Portfolio max DD</div>
                <div className={`mt-1 font-mono text-sm ${portDdCls}`}>{portfolioKpi ? formatPct(portfolioKpi.maxDrawdown) : "—"}</div>
              </div>
              <div className="rounded-xl bg-wash px-3 py-2">
                <div className="text-[11px] text-muted">Benchmark max DD</div>
                <div className={`mt-1 font-mono text-sm ${benchDdCls}`}>{benchKpi ? formatPct(benchKpi.maxDrawdown) : "—"}</div>
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
                  const winColors = ["#0B3D91", "#2F6F8F", "#1F7A6A", "#6D4C8F", "#B07D2B", "#C94C4C"];

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
                            <div className={`mt-0.5 font-mono text-[12px] ${cls(dPort)}`}>
                              {dPort == null ? "—" : formatPct(dPort)}
                            </div>
                          </div>
                        </div>

                        <div className="mt-2 text-[11px] text-muted">
                          Δ vs bench:{" "}
                          <span className={`font-mono ${cls(dBench)}`}>{dBench == null ? "—" : formatPct(dBench)}</span>
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

  const [rangeKey, setRangeKey] = useState<RangeKey>("1Y");

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

  const [totalSharesDraft, setTotalSharesDraft] = useState<string>("");
  const [isEditingTotalShares, setIsEditingTotalShares] = useState(false);

  useEffect(() => {
    if (!isEditingTotalShares) setTotalSharesDraft(String(totalShares));
  }, [totalShares, isEditingTotalShares]);

  const setTotalSharesAndRescale = (targetTotal: number) => {
    const T = Math.max(0, Math.round(Number.isFinite(targetTotal) ? targetTotal : 0));

    setHoldings((prev) => {
      if (!prev.length) return prev;

      const curTotal = prev.reduce((s, x) => s + (Number.isFinite(x.shares) ? x.shares : 0), 0);

      // If current total is 0, fall back to equal distribution.
      if (curTotal <= 0) {
        const base = prev.length ? Math.floor(T / prev.length) : 0;
        let rem = prev.length ? T - base * prev.length : 0;
        const ordered = prev.slice().sort((a, b) => a.ticker.localeCompare(b.ticker));
        const alloc = new Map<string, number>();
        for (const x of ordered) {
          const add = rem > 0 ? 1 : 0;
          if (rem > 0) rem -= 1;
          alloc.set(x.ticker, base + add);
        }
        return prev.map((x) => ({ ...x, shares: alloc.get(x.ticker) ?? 0 }));
      }

      // Preserve ratios: shares_i / curTotal.
      const ratios = prev.map((x) => {
        const s = Number.isFinite(x.shares) ? x.shares : 0;
        const exact = (s / curTotal) * T;
        return { ticker: x.ticker, floor: Math.floor(exact), frac: exact - Math.floor(exact) };
      });

      let used = ratios.reduce((s, r) => s + r.floor, 0);
      let rem = T - used;

      // Distribute remainder by largest fractional parts (stable by ticker name).
      ratios.sort((a, b) => (b.frac - a.frac) || a.ticker.localeCompare(b.ticker));
      const extras = new Map<string, number>();
      for (const r of ratios) extras.set(r.ticker, 0);
      for (let i = 0; i < ratios.length && rem > 0; i++) {
        extras.set(ratios[i].ticker, (extras.get(ratios[i].ticker) ?? 0) + 1);
        rem -= 1;
        if (i === ratios.length - 1 && rem > 0) i = -1;
      }

      const finalShares = new Map<string, number>();
      for (const r of ratios) {
        finalShares.set(r.ticker, r.floor + (extras.get(r.ticker) ?? 0));
      }

      return prev.map((x) => ({ ...x, shares: finalShares.get(x.ticker) ?? 0 }));
    });
  };

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

                <div className="mt-3">
                  <div className="text-xs font-semibold">Time range</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {RANGE_OPTIONS.map((opt) => {
                      const active = opt.key === rangeKey;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setRangeKey(opt.key)}
                          className={
                            "rounded-full px-3 py-1 text-[12px] font-semibold transition " +
                            (active
                              ? "bg-gray-200 text-ink border border-border shadow-soft"
                              : "bg-panel text-ink hover:bg-wash border border-border")
                          }
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-[11px] text-muted">Applies to all charts on the right.</div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <TickerPicker value={tickers} onChange={setTickers} />
              </div>

              <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <h3 className="text-sm font-semibold">Weights editor</h3>
                <p className="mt-1 text-xs text-muted">Edit shares (left). % updates automatically.</p>

                <div className="mt-3 space-y-2">
                  {holdings.map((h) => {
                    const denom = Math.max(1, totalShares);
                    const pct = (h.shares / denom) * 100;

                    const setShares = (ticker: string, shares: number) => {
                      const v = Math.max(0, Math.round(Number.isFinite(shares) ? shares : 0));
                      setHoldings((prev) => prev.map((x) => (x.ticker === ticker ? { ...x, shares: v } : x)));
                    };

                    const setPctAndRebalance = (ticker: string, pctTarget: number) => {
                      setHoldings((prev) => {
                        if (!prev.length) return prev;

                        const total = Math.max(
                          1,
                          prev.reduce((s, x) => s + (Number.isFinite(x.shares) ? x.shares : 0), 0)
                        );

                        // desired shares for selected ticker (round UP)
                        let desired = Math.ceil((Math.max(0, Math.min(100, pctTarget)) / 100) * total);
                        desired = Math.min(desired, total);

                        const others = prev.filter((x) => x.ticker !== ticker);
                        const remaining = total - desired;

                        if (others.length === 0) {
                          return prev.map((x) => (x.ticker === ticker ? { ...x, shares: desired } : x));
                        }

                        const otherTotal = others.reduce(
                          (s, x) => s + (Number.isFinite(x.shares) ? x.shares : 0),
                          0
                        );

                        // Allocate remaining shares to others (proportional if possible, else equal).
                        let alloc: { ticker: string; shares: number }[] = [];

                        if (otherTotal <= 0) {
                          const base = Math.floor(remaining / others.length);
                          let rem = remaining - base * others.length;
                          alloc = others
                            .slice()
                            .sort((a, b) => a.ticker.localeCompare(b.ticker))
                            .map((x) => {
                              const add = rem > 0 ? 1 : 0;
                              if (rem > 0) rem -= 1;
                              return { ticker: x.ticker, shares: base + add };
                            });
                        } else {
                          const raw = others.map((x) => {
                            const w = (x.shares || 0) / otherTotal;
                            const exact = w * remaining;
                            return { ticker: x.ticker, floor: Math.floor(exact), frac: exact - Math.floor(exact) };
                          });

                          let used = raw.reduce((s, r) => s + r.floor, 0);
                          let rem = remaining - used;

                          // Distribute leftover by largest fractional parts.
                          raw.sort((a, b) => b.frac - a.frac);
                          const extras = new Map<string, number>();
                          for (const r of raw) extras.set(r.ticker, 0);
                          for (let i = 0; i < raw.length && rem > 0; i++) {
                            extras.set(raw[i].ticker, (extras.get(raw[i].ticker) ?? 0) + 1);
                            rem -= 1;
                            if (i === raw.length - 1 && rem > 0) i = -1; // loop if still remainder
                          }

                          alloc = raw.map((r) => ({
                            ticker: r.ticker,
                            shares: r.floor + (extras.get(r.ticker) ?? 0),
                          }));
                        }

                        return prev.map((x) => {
                          if (x.ticker === ticker) return { ...x, shares: desired };
                          const a = alloc.find((z) => z.ticker === x.ticker);
                          return a ? { ...x, shares: a.shares } : x;
                        });
                      });
                    };

                    return (
                      <div key={h.ticker} className="rounded-xl bg-wash px-3 py-2">
                        <div className="flex items-center justify-between">
                          <div className="font-mono text-sm">{h.ticker}</div>
                        </div>

                        {/* Shares (integer) */}
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-muted">Shares</label>
                    <input
                      className="w-20 rounded-lg border border-border bg-panel px-2 py-1 font-mono text-sm"
                      type="number"
                      min={0}
                      step={1}
                      value={h.shares}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => {
                        const v = Math.max(0, Math.round(Number(e.target.value || 0)));
                        setShares(h.ticker, v);
                      }}
                    />
                          </div>

                          <div className="w-16 text-right font-mono text-sm text-muted tabular-nums">
                            {pct.toFixed(1)}%
                          </div>
                        </div>

                        {/* Slider (full width) */}
                        <div className="mt-2">
                          <input
                            className="w-full"
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={Number.isFinite(pct) ? Math.round(pct) : 0}
                            onChange={(e) => {
                              const v = Math.max(0, Math.min(100, Number(e.target.value || 0)));
                              setPctAndRebalance(h.ticker, v);
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 rounded-xl bg-wash px-3 py-2">
                  <div className="text-[11px] text-muted">Total shares</div>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      className="w-28 rounded-lg border border-border bg-panel px-2 py-1 font-mono text-sm text-ink"
                      type="number"
                      min={0}
                      step={1}
                      value={totalSharesDraft}
                      onFocus={(e) => {
                        setIsEditingTotalShares(true);
                        e.currentTarget.select();
                      }}
                      onChange={(e) => {
                        // keep it editable without triggering rebalancing on each keystroke
                        setTotalSharesDraft(e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const n = Math.max(0, Math.round(Number(totalSharesDraft || 0)));
                          setTotalSharesAndRescale(n);
                          setIsEditingTotalShares(false);
                        }
                        if (e.key === "Escape") {
                          setIsEditingTotalShares(false);
                        }
                      }}
                      onBlur={() => {
                        // leaving the field cancels (keeps current totals)
                        setIsEditingTotalShares(false);
                      }}
                    />

                    <button
                      type="button"
                      className="rounded-lg border border-border bg-panel px-3 py-1 text-sm font-semibold text-ink shadow-soft hover:bg-wash"
                      onClick={() => {
                        const n = Math.max(0, Math.round(Number(totalSharesDraft || 0)));
                        setTotalSharesAndRescale(n);
                        setIsEditingTotalShares(false);
                      }}
                    >
                      Apply
                    </button>

                    <div className="text-[11px] text-muted">Preserves current distribution ratios.</div>
                  </div>
                </div>

                <div className="mt-3 text-[11px] text-muted">
                  Shares and % stay in sync (slider rebalances the others).
                </div>
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
            <div className="mb-6">
              <TickerPriceCards tickers={tickers} rangeKey={rangeKey} placement="main" />
            </div>

            <div className="grid grid-cols-12 gap-6">
              <section className="col-span-12 lg:col-span-8 rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <h3 className="text-sm font-semibold">Equity curve (demo)</h3>
                <PriceDemoChart tickers={tickers} weights={weights} rangeKey={rangeKey} onComputed={setComputed} />
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
                  rangeKey={rangeKey}
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