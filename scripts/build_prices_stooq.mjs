/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const UNIVERSE_PATH = path.join(ROOT, "public", "data", "universe.json");
const OUT_PATH = path.join(ROOT, "public", "data", "prices.json");

function toStooqSymbol(ticker) {
  const t = String(ticker || "").trim().toUpperCase();
  if (!t) return null;
  if (t.includes(".")) return t;
  return `${t}.US`;
}

function parseCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((s) => s.trim().toLowerCase());
  const iDate = header.indexOf("date");
  const iClose = header.indexOf("close");
  if (iDate === -1 || iClose === -1) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const date = cols[iDate]?.trim();
    const close = Number(cols[iClose]);
    if (!date) continue;
    if (!Number.isFinite(close)) continue;
    rows.push({ date, close });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

async function fetchStooqDaily(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const r = await fetch(url, { headers: { "user-agent": "data_analysis_portf" } });
  if (!r.ok) throw new Error(`Stooq fetch failed ${symbol}: ${r.status}`);
  const txt = await r.text();
  const rows = parseCsv(txt);
  if (rows.length < 2) throw new Error(`Not enough rows for ${symbol}`);
  return rows;
}

function forwardFillToCalendar(calendarDates, rowsByDate) {
  const out = new Array(calendarDates.length).fill(NaN);
  let last = NaN;

  for (let i = 0; i < calendarDates.length; i++) {
    const d = calendarDates[i];
    const v = rowsByDate.get(d);
    if (v != null && Number.isFinite(v)) last = v;
    out[i] = Number.isFinite(last) ? last : NaN;
  }

  const first = out.find((x) => Number.isFinite(x));
  if (Number.isFinite(first)) {
    for (let i = 0; i < out.length; i++) {
      if (Number.isFinite(out[i])) break;
      out[i] = first;
    }
  }
  return out;
}

async function main() {
  const universe = JSON.parse(await fs.readFile(UNIVERSE_PATH, "utf8"));
  const tickers = [...new Set(universe.map((r) => String(r.ticker).toUpperCase()))];

  const seriesRaw = new Map();

  for (const t of tickers) {
    const sym = toStooqSymbol(t);
    if (!sym) continue;
    try {
      const rows = await fetchStooqDaily(sym);
      seriesRaw.set(t, rows);
    } catch (e) {
      console.warn(`Skip ${t}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const calSet = new Set();
  for (const rows of seriesRaw.values()) for (const r of rows) calSet.add(r.date);
  const dates = [...calSet].sort((a, b) => a.localeCompare(b));
  if (dates.length < 2) throw new Error("Calendar has <2 dates");

  const series = {};
  for (const [t, rows] of seriesRaw.entries()) {
    const map = new Map(rows.map((r) => [r.date, r.close]));
    series[t] = forwardFillToCalendar(dates, map);
  }

  const out = { dates, series };
  await fs.writeFile(OUT_PATH, JSON.stringify(out), "utf8");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});