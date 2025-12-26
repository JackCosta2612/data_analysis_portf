export type PriceRow = {
  date: string;      // ISO date string
  ticker: string;    // e.g. "AAPL"
  close: number;     // price
};

export type SeriesPoint = { date: string; value: number };

export function normalizeWeights(weights: Record<string, number>) {
  const entries = Object.entries(weights).filter(([, v]) => Number.isFinite(v) && v > 0);
  const sum = entries.reduce((a, [, v]) => a + v, 0);
  const out: Record<string, number> = {};
  for (const [k, v] of entries) out[k] = sum > 0 ? v / sum : 0;
  return out;
}

export function buildWide(prices: PriceRow[]) {
  // date -> ticker -> close
  const byDate: Record<string, Record<string, number>> = {};
  for (const r of prices) {
    if (!r?.date || !r?.ticker || !Number.isFinite(r.close)) continue;
    const d = r.date;
    const t = r.ticker.toUpperCase();
    (byDate[d] ||= {})[t] = r.close;
  }
  const dates = Object.keys(byDate).sort();
  return { dates, byDate };
}

function pct(a: number, b: number) {
  // return (b/a - 1), safe
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) return 0;
  return b / a - 1;
}

export function computePortfolioIndex(
  prices: PriceRow[],
  tickers: string[],
  weightsAbs: Record<string, number>,
  baseValue = 100
): SeriesPoint[] {
  const tset = new Set(tickers.map((t) => t.toUpperCase()));
  const w = normalizeWeights(
    Object.fromEntries(Object.entries(weightsAbs).map(([k, v]) => [k.toUpperCase(), v]))
  );

  const { dates, byDate } = buildWide(prices.filter((r) => tset.has(r.ticker.toUpperCase())));

  if (dates.length < 2) return [];

  // forward fill per ticker so sparse series don't kill the index
  const last: Record<string, number> = {};
  let value = baseValue;

  const out: SeriesPoint[] = [{ date: dates[0], value }];

  for (let i = 1; i < dates.length; i++) {
    const d0 = dates[i - 1];
    const d1 = dates[i];

    const row0 = byDate[d0] || {};
    const row1 = byDate[d1] || {};

    // update last seen prices (ffill)
    for (const t of Object.keys(row0)) if (Number.isFinite(row0[t])) last[t] = row0[t];
    const prev = { ...last };
    for (const t of Object.keys(row1)) if (Number.isFinite(row1[t])) last[t] = row1[t];

    // weighted daily return
    let r = 0;
    for (const t of Object.keys(w)) {
      const p0 = prev[t];
      const p1 = last[t];
      r += w[t] * pct(p0, p1);
    }

    value = value * (1 + r);
    out.push({ date: d1, value });
  }

  return out;
}

export function kpisFromIndex(series: SeriesPoint[]) {
  if (series.length < 2) {
    return { totalReturn: 0, cagr: 0, maxDrawdown: 0 };
  }

  const v0 = series[0].value;
  const v1 = series[series.length - 1].value;
  const totalReturn = v0 > 0 ? v1 / v0 - 1 : 0;

  const d0 = new Date(series[0].date).getTime();
  const d1 = new Date(series[series.length - 1].date).getTime();
  const years = Math.max((d1 - d0) / (1000 * 60 * 60 * 24 * 365.25), 1 / 365.25);
  const cagr = Math.pow(1 + totalReturn, 1 / years) - 1;

  let peak = series[0].value;
  let maxDD = 0;
  for (const p of series) {
    if (p.value > peak) peak = p.value;
    const dd = peak > 0 ? p.value / peak - 1 : 0;
    if (dd < maxDD) maxDD = dd;
  }

  return { totalReturn, cagr, maxDrawdown: maxDD };
}

export function formatPct(x: number) {
  const v = (x * 100);
  const s = (Math.round(v * 10) / 10).toFixed(1);
  return `${s}%`;
}
