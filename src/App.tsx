import { useEffect, useMemo, useState } from "react";
import Sparkline from "./components/Sparkline";

type UniverseRow = {
  ticker: string;
  name: string;
  assetClass: string;
  riskBucket: string;
};

type BenchmarkMeta = {
  ticker: string;
  label: string;
  market: "NASDAQ" | "NYSE" | "ALL";
};

type PricesDemo = {
  dates: string[];
  series: Record<string, number[]>;
};

type KPI = { totalReturn: number; cagr: number; maxDrawdown: number };

type RangeKey = "1D" | "5D" | "6M" | "YTD" | "1Y" | "5Y" | "ALL";

type MarketKey = "ALL" | "NASDAQ" | "NYSE";

const MARKET_OPTIONS: { key: MarketKey; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "NASDAQ", label: "NASDAQ" },
  { key: "NYSE", label: "NYSE" },
];

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


function wantsIntraday(rangeKey: RangeKey) {
  return rangeKey === "1D" || rangeKey === "5D";
}


// === Per-ticker data helpers ===
type TickerSeriesFile = {
  ticker: string;
  dates: string[];
  close: number[];
  intervalMinutes?: number;
};

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/json")) throw new Error(`Not JSON for ${url}`);
  return (await r.json()) as T;
}

function marketDir(market: MarketKey) {
  if (market === "NASDAQ") return "nasdaq";
  if (market === "NYSE") return "nyse";
  return "";
}

function priceFreq(rangeKey: RangeKey): "intraday" | "daily" {
  return wantsIntraday(rangeKey) ? "intraday" : "daily";
}

const _tickerFileCache = new Map<string, TickerSeriesFile>();

async function loadTickerFile(params: {
  base: string;
  market: MarketKey;
  freq: "intraday" | "daily";
  ticker: string;
}): Promise<{ file: TickerSeriesFile; usedUrl: string; usedMarketDir: string }> {
  const t = params.ticker.toUpperCase();
  const mk = params.market;
  const freq = params.freq;

  const mkDirs = mk === "ALL" ? ["nasdaq", "nyse"] : [marketDir(mk)];

  let lastErr: unknown = null;
  for (const md of mkDirs) {
    const url = `${params.base}data/${md}/${freq}/${t}.json`;
    const cacheKey = `${md}:${freq}:${t}`;

    if (_tickerFileCache.has(cacheKey)) {
      return { file: _tickerFileCache.get(cacheKey)!, usedUrl: url, usedMarketDir: md };
    }

    try {
      const file = await fetchJson<TickerSeriesFile>(url);
      _tickerFileCache.set(cacheKey, file);
      return { file, usedUrl: url, usedMarketDir: md };
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(
    `Missing ticker file for ${t} (${freq}) in market=${mk}. Last error: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  );
}

const _benchFileCache = new Map<string, TickerSeriesFile>();

async function loadBenchmarkFile(params: {
  base: string;
  freq: "intraday" | "daily";
  ticker: string;
}): Promise<{ file: TickerSeriesFile; usedUrl: string }> {
  const t = params.ticker.toUpperCase();
  const freq = params.freq;

  const url = `${params.base}data/benchmarks/${freq}/${t}.json`;
  const cacheKey = `${freq}:${t}`;

  if (_benchFileCache.has(cacheKey)) {
    return { file: _benchFileCache.get(cacheKey)!, usedUrl: url };
  }

  const file = await fetchJson<TickerSeriesFile>(url);
  _benchFileCache.set(cacheKey, file);
  return { file, usedUrl: url };
}

function unionSortedDates(series: { dates: string[] }[]) {
  const s = new Set<string>();
  for (const x of series) for (const d of x.dates ?? []) if (typeof d === "string") s.add(d);
  return [...s].sort((a, b) => a.localeCompare(b));
}

function forwardFillSeries(calendar: string[], dateToValue: Map<string, number>) {
  const out: number[] = new Array<number>(calendar.length);
  let last: number | null = null;
  for (let i = 0; i < calendar.length; i++) {
    const d = calendar[i];
    const v = dateToValue.get(d);
    if (Number.isFinite(v)) last = v as number;
    out[i] = last == null ? NaN : last;
  }
  return out;
}

function buildPricesDemoFromTickerFiles(files: { ticker: string; dates: string[]; close: number[] }[]): PricesDemo {
  const dates = unionSortedDates(files);
  const series: Record<string, number[]> = {};
  for (const f of files) {
    const m = new Map<string, number>();
    const n = Math.min(f.dates?.length ?? 0, f.close?.length ?? 0);
    for (let i = 0; i < n; i++) {
      const d = f.dates[i];
      const v = f.close[i];
      if (typeof d === "string" && Number.isFinite(v)) m.set(d, v as number);
    }
    series[f.ticker.toUpperCase()] = forwardFillSeries(dates, m);
  }
  return { dates, series };
}

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
  market,
  placement = "sidebar",
}: {
  tickers: string[];
  rangeKey: RangeKey;
  market: MarketKey;
  placement?: "sidebar" | "main";
}) {
  const [prices, setPrices] = useState<PricesDemo | null>(null);
  const [universe, setUniverse] = useState<UniverseRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [source, setSource] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    const base = import.meta.env.BASE_URL || "/";
    const freq = priceFreq(rangeKey);

    const uUniverse = `${base}data/universe.json`;

    (async () => {
      try {
        if (cancelled) return;
        setErr(null);

        const [uni, files] = await Promise.all([
          fetchJson<UniverseRow[]>(uUniverse),
          (async () => {
            const wanted = tickers
              .map((t) => t.toUpperCase())
              .slice(0, placement === "main" ? 24 : 12);

            const out: TickerSeriesFile[] = [];
            let anyUrl = "";

            for (const t of wanted) {
              try {
                const res = await loadTickerFile({ base, market, freq, ticker: t });
                if (cancelled) return [] as TickerSeriesFile[];
                out.push({
                  ticker: t,
                  dates: res.file.dates,
                  close: res.file.close,
                  intervalMinutes: res.file.intervalMinutes,
                });
                anyUrl = res.usedUrl;
              } catch {
                // ignore missing tickers in this market
              }
            }

            if (!cancelled && anyUrl) setSource(anyUrl);
            return out;
          })(),
        ]);

        if (cancelled) return;

        setUniverse(uni);

        if (files.length === 0) {
          setPrices({ dates: [], series: {} });
          return;
        }

        setPrices(buildPricesDemoFromTickerFiles(files));
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setPrices(null);
        setUniverse(null);
        setSource("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [market, rangeKey, tickers, placement]);

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

  const fmtDate = (d: string) => {
    if (!d) return d;
    if (d.includes("T")) return d.slice(0, 16).replace("T", " ");
    return d;
  };

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
    // Render axis labels outside the SVG (stable font sizing).
    const viewW = 360;
    const viewH = 140;
    const left = 10;
    const right = 10;
    const top = 8;
    const bottom = 12;
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
          <div className="grid grid-cols-[auto,1fr] items-stretch gap-2">
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
              <div style={{ lineHeight: 1 }}>{ymax0.toFixed(1)}</div>
              <div style={{ lineHeight: 1 }}>{ymin0.toFixed(1)}</div>
            </div>

            <div className="min-w-0">
              <div className="aspect-[360/140] w-full">
                <svg
                  viewBox={`0 0 ${viewW} ${viewH}`}
                  className="h-full w-full"
                  style={{ fontFamily: AXIS_FONT_FAMILY, fontSize: AXIS_FONT_SIZE, fill: AXIS_FILL }}
                >
                  {/* subtle grid */}
                  <line x1={left} y1={top + H} x2={left + W} y2={top + H} stroke="#E5E7EB" />
                  <line x1={left} y1={top + H * 0.5} x2={left + W} y2={top + H * 0.5} stroke="#F3F4F6" />

                  {/* area */}
                  <path d={dArea} fill={fill} stroke="none" />

                  {/* line */}
                  <path d={dLine} fill="none" stroke={stroke} strokeWidth="2.25" />
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
                <span>{fmtDate(datesR[0])}</span>
                <span>{fmtDate(datesR[datesR.length - 1])}</span>
              </div>
            </div>
          </div>
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
          {source ? (
            <div className="mt-1 text-[11px] text-muted">
              Source: <span className="font-mono">{source}</span>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (!prices || !universe) {
    return (
      <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
        <div className="text-sm font-semibold">Tickers</div>
        <div className="mt-2 text-xs text-muted">Loading ticker charts… <span className="font-mono">{market}</span> · <span className="font-mono">{rangeKey}</span></div>
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
    <div>
      <div className={placement === "main" ? "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" : "space-y-4"}>
        {shown.map((t) => (
          <LineCard key={t} t={t} />
        ))}
      </div>
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
  market: MarketKey;
  onComputed?: (x: { dates: string[]; portfolio: number[] | null; kpi: KPI | null }) => void;
}) {
  const [data, setData] = useState<PricesDemo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const base = import.meta.env.BASE_URL || "/";
    const freq = priceFreq(rangeKey);

    (async () => {
      try {
        if (cancelled) return;
        setErr(null);

        const wanted = tickers.map((t) => t.toUpperCase());
        const files: TickerSeriesFile[] = [];

        for (const t of wanted) {
          try {
            const res = await loadTickerFile({ base, market: "ALL", freq, ticker: t });
            if (cancelled) return;
            files.push({
              ticker: t,
              dates: res.file.dates,
              close: res.file.close,
              intervalMinutes: res.file.intervalMinutes,
            });
          } catch {
            // ignore missing tickers
          }
        }

        if (cancelled) return;

        if (!files.length) {
          setData({ dates: [], series: {} });
          return;
        }

        setData(buildPricesDemoFromTickerFiles(files));
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setData(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rangeKey, tickers]);

  const shown = useMemo(() => {
    if (!data) return [] as string[];
    return tickers.filter((t) => t in data.series);
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

    const wmap = new Map(weights.map((x) => [x.ticker.toUpperCase(), x.w] as const));

    // Renormalize weights to the subset of tickers that exist in the loaded dataset.
    let wSum = 0;
    for (const s of series) wSum += wmap.get(s.t.toUpperCase()) ?? 0;
    if (!Number.isFinite(wSum) || wSum <= 0) return null;

    const n = datesR.length;
    const out = new Array<number>(n).fill(0);

    for (const s of series) {
      const wRaw = wmap.get(s.t.toUpperCase()) ?? 0;
      const w = wRaw / wSum;
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
        Select tickers that exist in the loaded dataset.
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
  market: MarketKey;
}) {
  const [universe, setUniverse] = useState<UniverseRow[] | null>(null);
  const [prices, setPrices] = useState<PricesDemo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [benchMeta, setBenchMeta] = useState<BenchmarkMeta[]>([]);

  const [benchmark, setBenchmark] = useState<string>("QQQ");

  useEffect(() => {
    let cancelled = false;

    const base = import.meta.env.BASE_URL || "/";
    const freq = priceFreq(rangeKey);
    const uUniverse = `${base}data/universe.json`;
    const uBench = `${base}data/benchmarks/benchmarks.json`;

    (async () => {
      try {
        if (cancelled) return;
        setErr(null);

        const [uni, bmRaw] = await Promise.all([
          fetchJson<UniverseRow[]>(uUniverse),
          fetchJson<any[]>(uBench).catch(() => [] as any[]),
        ]);

        if (cancelled) return;
        setUniverse(uni);

        const bm = (bmRaw ?? [])
          .filter((x) => x && typeof x.ticker === "string")
          .map((x) => {
            const t = String(x.ticker).toUpperCase();
            const lbl = typeof x.label === "string" ? x.label : t;
            const m0 = String(x.market ?? "ALL").toUpperCase();
            const m: BenchmarkMeta["market"] = m0 === "NASDAQ" ? "NASDAQ" : m0 === "NYSE" ? "NYSE" : "ALL";
            return { ticker: t, label: lbl, market: m } as BenchmarkMeta;
          });

        setBenchMeta(bm);

        const neededStocks = new Set<string>();
        for (const t of portfolioTickers) neededStocks.add(String(t).toUpperCase());
        for (const r of uni) neededStocks.add(String(r.ticker).toUpperCase());

        const stockFiles: TickerSeriesFile[] = [];

        for (const t of neededStocks) {
          try {
            // Search both market directories regardless of Controls selection.
            const res = await loadTickerFile({ base, market: "ALL", freq, ticker: t });
            if (cancelled) return;
            stockFiles.push({
              ticker: t,
              dates: res.file.dates,
              close: res.file.close,
              intervalMinutes: res.file.intervalMinutes,
            });
          } catch {
            // ignore missing
          }
        }

        // Benchmarks are loaded from the dedicated benchmarks directory.
        const benchFiles: TickerSeriesFile[] = [];
        for (const b of bm) {
          try {
            const res = await loadBenchmarkFile({ base, freq, ticker: b.ticker });
            if (cancelled) return;
            benchFiles.push({
              ticker: b.ticker,
              dates: res.file.dates,
              close: res.file.close,
              intervalMinutes: res.file.intervalMinutes,
            });
          } catch {
            // ignore missing
          }
        }

        const files = [...stockFiles, ...benchFiles];

        if (cancelled) return;

        if (!files.length) {
          setPrices({ dates: [], series: {} });
          return;
        }

        setPrices(buildPricesDemoFromTickerFiles(files));
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setUniverse(null);
        setBenchMeta([]);
        setPrices(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rangeKey, portfolioTickers]);

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

  const normalizeBucket = (b: string | null | undefined) => {
    const x = String(b ?? "").trim().toLowerCase();
    if (!x) return "unknown";
    if (x.startsWith("low")) return "low";
    if (x.startsWith("med")) return "medium";
    if (x.startsWith("high")) return "high";
    if (x.includes("low")) return "low";
    if (x.includes("medium") || x.includes("mid")) return "medium";
    if (x.includes("high")) return "high";
    if (x.includes("unknown")) return "unknown";
    return x;
  };

  const bucketLabel = (b: string) => {
    if (b === "low") return "Low";
    if (b === "medium") return "Medium";
    if (b === "high") return "High";
    return b === "unknown" ? "Unknown" : b;
  };

  const adjacentBuckets = (b: string) => {
    if (b === "low") return ["low", "medium"];
    if (b === "medium") return ["medium", "low", "high"];
    if (b === "high") return ["high", "medium"];
    return ["unknown", "low", "medium", "high"];
  };

  const fallbackBucketForTicker = (t: string) => {
    const T = t.toUpperCase();

    const meta = uniMap.get(T);
    const asset = String(meta?.assetClass ?? "").toLowerCase();
    const name = String(meta?.name ?? "").toLowerCase();

    const hay = `${asset} ${name}`;

    if (
      hay.includes("bond") ||
      hay.includes("treasury") ||
      hay.includes("t-bill") ||
      hay.includes("money market") ||
      hay.includes("cash")
    ) {
      return "low";
    }
    if (hay.includes("utilities") || hay.includes("consumer staples") || hay.includes("dividend")) {
      return "low";
    }

    if (
      hay.includes("emerging") ||
      hay.includes("china") ||
      hay.includes("biotech") ||
      hay.includes("semiconductor") ||
      hay.includes("technology") ||
      hay.includes("sector")
    ) {
      return "high";
    }
    if (hay.includes("leveraged") || hay.includes("2x") || hay.includes("3x") || hay.includes("crypto")) {
      return "high";
    }

    return "medium";
  };

  const availableBench = useMemo(() => {
    if (!prices) return [] as { ticker: string; label: string }[];

    const s = prices.series ?? {};
    return (benchMeta ?? [])
      .filter((b) => b?.ticker)
      .map((b) => ({ ticker: String(b.ticker).toUpperCase(), label: b.label }))
      .filter((b) => b.ticker in s)
      .map((b) => ({ ticker: b.ticker, label: b.label || b.ticker }));
  }, [prices, benchMeta]);

  useEffect(() => {
    if (!availableBench.length) return;
    if (!availableBench.some((b) => b.ticker === benchmark)) {
      setBenchmark(availableBench[0].ticker);
    }
  }, [availableBench, benchmark]);

  const inferredRiskBucket = useMemo(() => {
    if (!portfolioWeights.length) return "unknown";

    const byBucket = new Map<string, number>();

    for (const w of portfolioWeights) {
      const t = w.ticker.toUpperCase();
      const raw = uniMap.get(t)?.riskBucket;
      const nb = normalizeBucket(raw);
      const bucket = nb !== "unknown" ? nb : fallbackBucketForTicker(t);
      byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + w.w);
    }

    let best = "unknown";
    let bestW = -1;
    for (const [b, ww] of byBucket.entries()) {
      if (ww > bestW) {
        bestW = ww;
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
      .filter((r) => {
        const rb = normalizeBucket(r.riskBucket);
        const want = adjacentBuckets(inferredRiskBucket);
        return want.includes(rb);
      })
      .filter((r) => r.ticker in s)
      .filter((r) => !portfolioSet.has(r.ticker))
      .filter((r) => r.ticker !== benchmark.toUpperCase());

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
                {bucketLabel(inferredRiskBucket)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-xs text-muted">Benchmark</div>
              <select
                className={
                  "rounded-xl border border-border bg-panel px-3 py-2 text-sm " +
                  (!availableBench.length ? "text-muted" : "")
                }
                value={benchmark}
                onChange={(e) => setBenchmark(e.target.value)}
                disabled={!availableBench.length}
              >
                {!availableBench.length ? (
                  <option value="" key="_none">
                    No benchmarks available
                  </option>
                ) : null}

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
                Select tickers (and a benchmark that exists in the loaded data) to render a comparison.
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
              Top performers in the same <span className="font-mono">riskBucket</span> ({bucketLabel(inferredRiskBucket)}) that
              outperform the current portfolio (when possible).
            </div>

            {winners.length === 0 ? (
              <div className="mt-3 text-xs text-muted">No comparable tickers found in the loaded data.</div>
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


        </>
      )}
    </div>
  );
}

function LocalTickerPicker({
  value,
  onChange,
  market,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  market: MarketKey;
}) {
  const [options, setOptions] = useState<string[]>([]);
  const [q, setQ] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseCount, setBrowseCount] = useState(400);

  useEffect(() => {
    const base = import.meta.env.BASE_URL || "/";

    (async () => {
      try {
        setErr(null);

        const url =
          market === "ALL"
            ? `${base}data/tickers_all.json`
            : `${base}data/${marketDir(market)}/tickers.json`;

        const tickers = await fetchJson<string[]>(url);
        const cleaned = (tickers ?? [])
          .map((t) => String(t).toUpperCase())
          .filter((t) => t.length > 0)
          .sort((a, b) => a.localeCompare(b));

        setOptions(cleaned);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setOptions([]);
      }
    })();
  }, [market]);


  const selected = useMemo(() => new Set(value.map((t) => t.toUpperCase())), [value]);

  const POPULAR: Record<MarketKey, string[]> = {
    NASDAQ: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "COST"],
    NYSE: ["BRK.B", "JPM", "JNJ", "V", "PG", "UNH", "XOM", "HD", "WMT"],
    ALL: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "BRK.B", "JPM", "JNJ", "XOM"],
  };

  const allowedSet = useMemo(() => new Set(options.map((t) => t.toUpperCase())), [options]);

  const popularSuggestions = useMemo(() => {
    const base = POPULAR[market] ?? POPULAR.ALL;
    return base
      .map((t) => t.toUpperCase())
      .filter((t) => allowedSet.has(t))
      .filter((t) => !selected.has(t));
  }, [market, allowedSet, selected]);

  const filtered = useMemo(() => {
    const qq = q.trim().toUpperCase();
    const xs = options.filter((t) => !selected.has(t));

    if (!qq) {
      const LIMIT = 12;
      return popularSuggestions.slice(0, LIMIT);
    }

    return xs.filter((t) => t.includes(qq)).slice(0, 25);
  }, [options, q, selected, popularSuggestions]);

  const browseList = useMemo(() => {
    const qq = q.trim().toUpperCase();
    const xs = options.filter((t) => !selected.has(t));
    if (!qq) return xs;
    return xs.filter((t) => t.includes(qq));
  }, [options, q, selected]);

  useEffect(() => {
    // Reset browse pagination when inputs change
    setBrowseCount(400);
  }, [market, q, options.length, value.length]);

  const add = (t: string) => {
    const T = t.toUpperCase();
    if (!T || selected.has(T)) return;
    onChange([...value, T]);
    setQ("");
  };
  const remove = (t: string) => {
    const T = t.toUpperCase();
    onChange(value.filter((x) => x.toUpperCase() !== T));
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Ticker picker</h3>
          <div className="mt-1 text-xs text-muted">Search and select tickers (local Stooq lists).</div>
        </div>
        <div className="text-[11px] text-muted">
          <span className="font-mono">{value.length}</span>
          <span className="mx-1">/</span>
          <span className="font-mono">10</span>
        </div>
      </div>

      <div className="mt-3">
        <input
          className="w-full rounded-xl border border-border bg-panel px-3 py-2 font-mono text-sm text-ink placeholder:text-muted"
          placeholder="Type a ticker (e.g., AAPL)"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setBrowseOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filtered.length) add(filtered[0]);
          }}
        />

        {err ? (
          <div className="mt-2 text-xs text-red-600">
            Ticker list failed: <span className="font-mono">{err}</span>
          </div>
        ) : (
          <div className="mt-2 rounded-xl border border-border bg-wash p-2">
            {filtered.length === 0 ? (
              <div className="text-xs text-muted">No matches.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {filtered.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="rounded-full border border-border bg-panel px-3 py-1 text-[12px] font-semibold text-ink hover:bg-wash"
                    onClick={() => add(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Dropdown-style manual browser */}
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setBrowseOpen((v) => !v)}
            className="w-full rounded-xl border border-border bg-panel px-3 py-2 text-left text-sm font-semibold text-ink hover:bg-wash"
          >
            {browseOpen ? "Hide" : "Browse"} all tickers
            <span className="ml-2 text-[11px] font-normal text-muted">({browseList.length.toLocaleString()})</span>
          </button>

          {browseOpen ? (
            <div
              className="mt-2 max-h-56 overflow-auto rounded-xl border border-border bg-wash p-2"
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
                  setBrowseCount((c) => Math.min(c + 400, browseList.length));
                }
              }}
            >
              {browseList.length === 0 ? (
                <div className="text-xs text-muted">No matches.</div>
              ) : (
                <div className="flex flex-col gap-1">
                  {browseList.slice(0, browseCount).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-mono text-ink hover:bg-panel"
                      onClick={() => add(t)}
                    >
                      <span>{t}</span>
                      <span className="text-[11px] font-sans text-muted">Add</span>
                    </button>
                  ))}

                  {browseCount < browseList.length ? (
                    <div className="mt-2 text-center text-[11px] text-muted">
                      Scroll to load more…
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </div>


      </div>

      {value.length > 0 ? (
        <div className="mt-3">
          <div className="text-[11px] text-muted">Selected</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {value.map((t) => (
              <div key={t} className="flex items-center gap-2 rounded-full border border-border bg-panel px-3 py-1">
                <span className="font-mono text-[12px] text-ink">{t.toUpperCase()}</span>
                <button
                  type="button"
                  className="text-[12px] font-semibold text-muted hover:text-ink"
                  onClick={() => remove(t)}
                  aria-label={`Remove ${t}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
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
  const [market, setMarket] = useState<MarketKey>("ALL");

  const [activeMarkets, setActiveMarkets] = useState<{ NASDAQ: boolean; NYSE: boolean }>({
    NASDAQ: true,
    NYSE: true,
  });

  const [nasdaqTickers, setNasdaqTickers] = useState<string[]>([]);
  const [nyseTickers, setNyseTickers] = useState<string[]>([]);

  useEffect(() => {
    const base = import.meta.env.BASE_URL || "/";

    (async () => {
      try {
        const [nas, ny] = await Promise.all([
          fetchJson<string[]>(`${base}data/nasdaq/tickers.json`).catch(() => [] as string[]),
          fetchJson<string[]>(`${base}data/nyse/tickers.json`).catch(() => [] as string[]),
        ]);

        setNasdaqTickers((nas ?? []).map((t) => String(t).toUpperCase()));
        setNyseTickers((ny ?? []).map((t) => t.toUpperCase()));
      } catch {
        setNasdaqTickers([]);
        setNyseTickers([]);
      }
    })();
  }, []);

  const nasdaqSet = useMemo(() => new Set(nasdaqTickers.map((t) => t.toUpperCase())), [nasdaqTickers]);
  const nyseSet = useMemo(() => new Set(nyseTickers.map((t) => t.toUpperCase())), [nyseTickers]);

  useEffect(() => {
    // Market selection constrains picker; it should not drop portfolio tickers.
    // It only sets which market is currently included in calculations.
    if (market === "NASDAQ") setActiveMarkets({ NASDAQ: true, NYSE: false });
    else if (market === "NYSE") setActiveMarkets({ NASDAQ: false, NYSE: true });
    else setActiveMarkets({ NASDAQ: true, NYSE: true });
  }, [market]);

  const holdingsByMarket = useMemo(() => {
    const nas: Holding[] = [];
    const ny: Holding[] = [];
    const other: Holding[] = [];

    for (const h of holdings) {
      const t = h.ticker.toUpperCase();
      const inNas = nasdaqSet.has(t);
      const inNy = nyseSet.has(t);

      if (inNas && !inNy) nas.push(h);
      else if (inNy && !inNas) ny.push(h);
      else if (inNas && inNy) {
        // Rare overlap, keep under both markets for visibility.
        nas.push(h);
        ny.push(h);
      } else {
        other.push(h);
      }
    }

    return { nas, ny, other };
  }, [holdings, nasdaqSet, nyseSet]);

  const activeTickers = useMemo(() => {
    return tickers.filter((t0) => {
      const t = t0.toUpperCase();
      const inNas = nasdaqSet.has(t);
      const inNy = nyseSet.has(t);

      if (inNas && !inNy) return activeMarkets.NASDAQ;
      if (inNy && !inNas) return activeMarkets.NYSE;
      if (inNas && inNy) return activeMarkets.NASDAQ || activeMarkets.NYSE;

      // Unknown: keep active so we never silently drop portfolio components.
      return true;
    });
  }, [tickers, nasdaqSet, nyseSet, activeMarkets]);

  const togglesLocked = market !== "ALL";

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

  const activeWeights = useMemo(() => {
    const set = new Set(activeTickers.map((t) => t.toUpperCase()));
    return weights.filter((w) => set.has(w.ticker.toUpperCase()));
  }, [weights, activeTickers]);
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
                  <div className="text-xs font-semibold">Market</div>
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      className="rounded-xl border border-border bg-panel px-3 py-2 text-sm"
                      value={market}
                      onChange={(e) => setMarket(e.target.value as MarketKey)}
                    >
                      {MARKET_OPTIONS.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

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
                <LocalTickerPicker value={tickers} onChange={setTickers} market={market} />
              </div>

              <div className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <h3 className="text-sm font-semibold">Weights editor</h3>
                <p className="mt-1 text-xs text-muted">Edit shares (left). % updates automatically.</p>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={togglesLocked}
                    onClick={() => setActiveMarkets((m) => ({ ...m, NASDAQ: !m.NASDAQ }))}
                    className={
                      "rounded-full border px-3 py-1 text-[12px] font-semibold transition " +
                      (activeMarkets.NASDAQ
                        ? "border-border bg-wash text-ink"
                        : "border-border bg-panel text-muted hover:bg-wash") +
                      (togglesLocked ? " opacity-60 cursor-not-allowed" : "")
                    }
                  >
                    NASDAQ {activeMarkets.NASDAQ ? "On" : "Off"}
                  </button>

                  <button
                    type="button"
                    disabled={togglesLocked}
                    onClick={() => setActiveMarkets((m) => ({ ...m, NYSE: !m.NYSE }))}
                    className={
                      "rounded-full border px-3 py-1 text-[12px] font-semibold transition " +
                      (activeMarkets.NYSE
                        ? "border-border bg-wash text-ink"
                        : "border-border bg-panel text-muted hover:bg-wash") +
                      (togglesLocked ? " opacity-60 cursor-not-allowed" : "")
                    }
                  >
                    NYSE {activeMarkets.NYSE ? "On" : "Off"}
                  </button>

                  <div className="ml-auto text-[11px] text-muted">
                    Included in analysis: <span className="font-mono">{activeTickers.length}</span>
                  </div>
                </div>

                <div className="mt-3 space-y-4">
                  {/* NASDAQ section */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs font-semibold">NASDAQ</div>
                      {!activeMarkets.NASDAQ ? (
                        <div className="text-[11px] text-muted">Excluded from analysis</div>
                      ) : (
                        <div className="text-[11px] text-muted">Included</div>
                      )}
                    </div>

                    <div className={"space-y-2 " + (!activeMarkets.NASDAQ ? "opacity-60" : "")}>
                      {holdingsByMarket.nas.length === 0 ? (
                        <div className="rounded-xl bg-wash px-3 py-2 text-xs text-muted">No NASDAQ tickers selected.</div>
                      ) : (
                        holdingsByMarket.nas.map((h) => {
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
                        })
                      )}
                    </div>
                  </div>

                  {/* NYSE section */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs font-semibold">NYSE</div>
                      {!activeMarkets.NYSE ? (
                        <div className="text-[11px] text-muted">Excluded from analysis</div>
                      ) : (
                        <div className="text-[11px] text-muted">Included</div>
                      )}
                    </div>

                    <div className={"space-y-2 " + (!activeMarkets.NYSE ? "opacity-60" : "")}>
                      {holdingsByMarket.ny.length === 0 ? (
                        <div className="rounded-xl bg-wash px-3 py-2 text-xs text-muted">No NYSE tickers selected.</div>
                      ) : (
                        holdingsByMarket.ny.map((h) => {
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

                                raw.sort((a, b) => b.frac - a.frac);
                                const extras = new Map<string, number>();
                                for (const r of raw) extras.set(r.ticker, 0);
                                for (let i = 0; i < raw.length && rem > 0; i++) {
                                  extras.set(raw[i].ticker, (extras.get(raw[i].ticker) ?? 0) + 1);
                                  rem -= 1;
                                  if (i === raw.length - 1 && rem > 0) i = -1;
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
                        })
                      )}
                    </div>
                  </div>

                  {/* Unknown section (always included) */}
                  {holdingsByMarket.other.length > 0 ? (
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-xs font-semibold">Other</div>
                        <div className="text-[11px] text-muted">Included</div>
                      </div>
                      <div className="space-y-2">
                        {holdingsByMarket.other.map((h) => {
                          const denom = Math.max(1, totalShares);
                          const pct = (h.shares / denom) * 100;

                          const setShares = (ticker: string, shares: number) => {
                            const v = Math.max(0, Math.round(Number.isFinite(shares) ? shares : 0));
                            setHoldings((prev) => prev.map((x) => (x.ticker === ticker ? { ...x, shares: v } : x)));
                          };

                          return (
                            <div key={h.ticker} className="rounded-xl bg-wash px-3 py-2">
                              <div className="flex items-center justify-between">
                                <div className="font-mono text-sm">{h.ticker}</div>
                              </div>

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
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
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
              <TickerPriceCards tickers={activeTickers} rangeKey={rangeKey} market={market} placement="main" />
            </div>

            <div className="grid grid-cols-12 gap-6">
              <section className="col-span-12 lg:col-span-8 rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <h3 className="text-sm font-semibold">Equity curve</h3>
                <PriceDemoChart tickers={activeTickers} weights={activeWeights} rangeKey={rangeKey} market={market} onComputed={setComputed} />
              </section>

              <section className="col-span-12 lg:col-span-4 rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <h3 className="text-sm font-semibold">Drawdown</h3>

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
                  portfolioTickers={activeTickers}
                  portfolioWeights={activeWeights}
                  portfolio={computed?.portfolio ?? null}
                  portfolioKpi={computed?.kpi ?? null}
                  rangeKey={rangeKey}
                  market={market}
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