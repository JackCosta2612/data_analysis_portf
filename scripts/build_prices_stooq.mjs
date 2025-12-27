/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const UNIVERSE_PATH = path.join(ROOT, "public", "data", "universe.json");

// Output structure:
// public/data/{nasdaq,nyse}/{intraday,daily}/{TICKER}.json
const OUT_BASE = path.join(ROOT, "public", "data");
const OUT_TICKERS_ALL_PATH = path.join(OUT_BASE, "tickers_all.json");

const OUT_BENCH_BASE = path.join(OUT_BASE, "benchmarks");
const OUT_BENCH_DAILY_DIR = path.join(OUT_BENCH_BASE, "daily");
const OUT_BENCH_INTRA_DIR = path.join(OUT_BENCH_BASE, "intraday");
const OUT_BENCH_LIST_PATH = path.join(OUT_BENCH_BASE, "benchmarks.json");

// Benchmarks (index proxies). These must exist in your local Stooq dump to be written.
const BENCHMARKS = [
  { ticker: "QQQ", label: "Nasdaq 100 (QQQ)", market: "NASDAQ" },
  { ticker: "SPY", label: "S&P 500 (SPY)", market: "NYSE" },
  { ticker: "DIA", label: "Dow Jones (DIA)", market: "NYSE" },
  { ticker: "IWM", label: "Russell 2000 (IWM)", market: "NYSE" },
  { ticker: "VTI", label: "US Total Market (VTI)", market: "NYSE" },
  { ticker: "VT", label: "Global Equities (VT)", market: "ALL" },
  { ticker: "TLT", label: "US Treasuries 20Y (TLT)", market: "NYSE" },
  { ticker: "AGG", label: "US Bonds Aggregate (AGG)", market: "NYSE" },
  { ticker: "GLD", label: "Gold (GLD)", market: "NYSE" },
];

// Build scope:
// - "universe": only tickers listed in public/data/universe.json
// - "all": every ticker found in the local Stooq intraday tree
const BUILD_SCOPE = (process.env.STOOQ_SCOPE || "all").toLowerCase();

// Market filter (matches folder names like "nasdaq stocks" / "nyse stocks")
// Example: STOOQ_MARKETS="nasdaq,nyse" (default)
const MARKET_FILTER = new Set(
  (process.env.STOOQ_MARKETS || "nasdaq,nyse")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

// Local Stooq intraday dataset root (defaults to your current placement).
// Expected to contain the `hourly/` subtree.
const INTRA_ROOT = process.env.STOOQ_INTRA_ROOT
  ? path.resolve(process.env.STOOQ_INTRA_ROOT)
  : path.join(ROOT, "public", "data", "data");

// 60 for hourly, 5 for 5-minute, etc.
const INTRA_INTERVAL_MINUTES = Number(process.env.STOOQ_INTRA_INTERVAL_MINUTES || 60);

// Hourly file size can explode. Keep the last N days for per-ticker intraday JSON.
const INTRA_DAYS_BACK = Number(process.env.STOOQ_INTRA_DAYS_BACK || 5);

// Daily dataset derived from intraday (last bar per day). Default to last 5 years. Use 0 for all.
const DAILY_DAYS_BACK = Number(process.env.STOOQ_DAILY_DAYS_BACK || 365 * 5);

// How deep to search for files under INTRA_ROOT
const INTRA_MAX_DEPTH = Number(process.env.STOOQ_INTRA_MAX_DEPTH || 9);

function detectMarketFromPath(p) {
  const s = p.toLowerCase();
  if (s.includes("/nasdaq stocks/") || s.includes("\\nasdaq stocks\\")) return "nasdaq";
  if (s.includes("/nyse stocks/") || s.includes("\\nyse stocks\\")) return "nyse";

  // Some benchmark/ETF instruments may live outside these folders. Treat them as unknown market.
  return "unknown";
}
async function findTickerFileAnyMarket(rootDir, maxDepth, tickerUpper) {
  const want = `${tickerUpper.toLowerCase()}.us.txt`;
  const queue = [{ dir: rootDir, depth: 0 }];

  while (queue.length) {
    const cur = queue.shift();
    let entries;
    try {
      entries = await fs.readdir(cur.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      const full = path.join(cur.dir, ent.name);

      if (ent.isDirectory() && cur.depth < maxDepth) {
        queue.push({ dir: full, depth: cur.depth + 1 });
        continue;
      }

      if (!ent.isFile()) continue;
      if (ent.name.toLowerCase() === want) return full;
    }
  }

  return null;
}

function cutoffDateIsoPrefix(daysBack) {
  if (!Number.isFinite(daysBack) || daysBack <= 0) return null;
  const now = new Date();
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  cutoff.setUTCDate(cutoff.getUTCDate() - daysBack);
  return cutoff.toISOString().slice(0, 10); // YYYY-MM-DD
}

function toIsoDateTime(dateYYYYMMDD, timeHHMMSS) {
  if (!dateYYYYMMDD || dateYYYYMMDD.length !== 8) return null;
  const y = dateYYYYMMDD.slice(0, 4);
  const m = dateYYYYMMDD.slice(4, 6);
  const d = dateYYYYMMDD.slice(6, 8);

  const t = String(timeHHMMSS || "").padStart(6, "0");
  const hh = t.slice(0, 2);
  const mm = t.slice(2, 4);
  const ss = t.slice(4, 6);

  // Lexicographically sortable
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
}

function parseIntradayTxt(txt, intervalMinutesFilter) {
  const lines = txt.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const rows = [];
  for (const line of lines) {
    const cols = line.split(",");
    if (cols.length < 9) continue;

    const sym = cols[0]?.trim();
    const interval = Number(cols[1]);
    const date = cols[2]?.trim();
    const time = cols[3]?.trim();
    const close = Number(cols[7]);

    if (!sym || !sym.includes(".")) continue;
    if (!Number.isFinite(interval)) continue;
    if (Number.isFinite(intervalMinutesFilter) && intervalMinutesFilter > 0 && interval !== intervalMinutesFilter) continue;

    const dt = toIsoDateTime(date, time);
    if (!dt) continue;
    if (!Number.isFinite(close)) continue;

    rows.push({ dt, close });
  }

  rows.sort((a, b) => a.dt.localeCompare(b.dt));
  return rows;
}

async function buildIntradayFileIndex(rootDir, maxDepth, marketFilterSet) {
  // Returns: { nasdaq: Map<TICKER, path>, nyse: Map<TICKER, path> }
  const out = {
    nasdaq: new Map(),
    nyse: new Map(),
  };

  const queue = [{ dir: rootDir, depth: 0 }];

  while (queue.length) {
    const cur = queue.shift();
    let entries;
    try {
      entries = await fs.readdir(cur.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      const full = path.join(cur.dir, ent.name);

      if (ent.isDirectory() && cur.depth < maxDepth) {
        queue.push({ dir: full, depth: cur.depth + 1 });
        continue;
      }

      if (!ent.isFile()) continue;
      const name = ent.name.toLowerCase();
      if (!name.endsWith(".us.txt")) continue;

      const mkt = detectMarketFromPath(full);
      if (mkt === "unknown") continue;
      if (marketFilterSet.size && !marketFilterSet.has(mkt)) continue;

      const ticker = name.replace(".us.txt", "").toUpperCase();
      if (!ticker) continue;

      const target = mkt === "nasdaq" ? out.nasdaq : out.nyse;
      if (!target.has(ticker)) target.set(ticker, full);
    }
  }

  return out;
}

async function loadIntradayRows(filePath, intervalMinutes, daysBack) {
  const txt = await fs.readFile(filePath, "utf8");
  let rows = parseIntradayTxt(txt, intervalMinutes);

  const cutoffPrefix = cutoffDateIsoPrefix(daysBack);
  if (cutoffPrefix) rows = rows.filter((r) => r.dt.slice(0, 10) >= cutoffPrefix);

  if (rows.length < 2) throw new Error("Not enough intraday rows after filter");
  return rows;
}

async function ensureOutDirs() {
  for (const m of ["nasdaq", "nyse"]) {
    await fs.mkdir(path.join(OUT_BASE, m, "intraday"), { recursive: true });
    await fs.mkdir(path.join(OUT_BASE, m, "daily"), { recursive: true });
  }

  await fs.mkdir(OUT_BENCH_INTRA_DIR, { recursive: true });
  await fs.mkdir(OUT_BENCH_DAILY_DIR, { recursive: true });
}

async function writeJson(p, obj) {
  await fs.writeFile(p, JSON.stringify(obj), "utf8");
}

async function main() {
  // Validate intraday dataset root
  let intraRoot = INTRA_ROOT;
  try {
    const st = await fs.stat(intraRoot);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch {
    intraRoot = null;
  }
  if (!intraRoot) {
    console.warn(`No intraday dataset found under: ${INTRA_ROOT}`);
    return;
  }

  const universe = JSON.parse(await fs.readFile(UNIVERSE_PATH, "utf8"));
  const universeTickers = new Set(universe.map((r) => String(r.ticker).toUpperCase()));

  await ensureOutDirs();

  // Build market-aware index once
  const idx = await buildIntradayFileIndex(intraRoot, INTRA_MAX_DEPTH, MARKET_FILTER);
  const tickersNasdaqAll = [...idx.nasdaq.keys()].sort((a, b) => a.localeCompare(b));
  const tickersNyseAll = [...idx.nyse.keys()].sort((a, b) => a.localeCompare(b));
  const tickersAll = [...new Set([...tickersNasdaqAll, ...tickersNyseAll])].sort((a, b) => a.localeCompare(b));

  // Write ticker lists
  await writeJson(path.join(OUT_BASE, "nasdaq", "tickers.json"), tickersNasdaqAll);
  await writeJson(path.join(OUT_BASE, "nyse", "tickers.json"), tickersNyseAll);
  await writeJson(OUT_TICKERS_ALL_PATH, tickersAll);

  const pick = (t) => (BUILD_SCOPE === "universe" ? universeTickers.has(t) : true);

  // Build benchmark datasets (per-ticker JSONs) from local Stooq files, if present.
  const benchOut = [];

  for (const b of BENCHMARKS) {
    const t = String(b.ticker).toUpperCase();
    try {
      const fp = await findTickerFileAnyMarket(intraRoot, INTRA_MAX_DEPTH, t);
      if (!fp) {
        console.warn(`Benchmark missing in local dump: ${t} (skipping)`);
        continue;
      }

      // Intraday JSON (last N days)
      const rowsIntra = await loadIntradayRows(fp, INTRA_INTERVAL_MINUTES, INTRA_DAYS_BACK);
      await writeJson(path.join(OUT_BENCH_INTRA_DIR, `${t}.json`), {
        ticker: t,
        intervalMinutes: INTRA_INTERVAL_MINUTES,
        dates: rowsIntra.map((r) => r.dt),
        close: rowsIntra.map((r) => r.close),
      });

      // Daily JSON derived from intraday (last bar per day)
      const rowsDailySrc = await loadIntradayRows(
        fp,
        INTRA_INTERVAL_MINUTES,
        DAILY_DAYS_BACK > 0 ? DAILY_DAYS_BACK : 365 * 50
      );

      const lastByDay = new Map();
      for (const r of rowsDailySrc) {
        const day = r.dt.slice(0, 10);
        lastByDay.set(day, r.close);
      }
      const dailyDates = [...lastByDay.keys()].sort((a, b) => a.localeCompare(b));
      const dailyClose = dailyDates.map((d) => lastByDay.get(d));

      if (dailyDates.length >= 2) {
        await writeJson(path.join(OUT_BENCH_DAILY_DIR, `${t}.json`), {
          ticker: t,
          dates: dailyDates,
          close: dailyClose,
        });
      }

      benchOut.push({ ticker: t, label: b.label, market: b.market });
    } catch (e) {
      console.warn(`Benchmark build failed ${t}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await writeJson(OUT_BENCH_LIST_PATH, benchOut);

  // Build per-ticker JSONs per market
  for (const [market, mp] of [
    ["nasdaq", idx.nasdaq],
    ["nyse", idx.nyse],
  ]) {
    const outIntraDir = path.join(OUT_BASE, market, "intraday");
    const outDailyDir = path.join(OUT_BASE, market, "daily");

    const tickers = [...mp.keys()].sort((a, b) => a.localeCompare(b)).filter(pick);

    for (const t of tickers) {
      const filePath = mp.get(t);
      if (!filePath) continue;

      try {
        // Intraday JSON (last N days)
        const rowsIntra = await loadIntradayRows(filePath, INTRA_INTERVAL_MINUTES, INTRA_DAYS_BACK);
        const intradayDates = rowsIntra.map((r) => r.dt);
        const intradayClose = rowsIntra.map((r) => r.close);
        await writeJson(path.join(outIntraDir, `${t}.json`), {
          ticker: t,
          intervalMinutes: INTRA_INTERVAL_MINUTES,
          dates: intradayDates,
          close: intradayClose,
        });

        // Daily JSON derived from intraday (last bar per day)
        const rowsDailySrc = await loadIntradayRows(
          filePath,
          INTRA_INTERVAL_MINUTES,
          DAILY_DAYS_BACK > 0 ? DAILY_DAYS_BACK : 365 * 50
        );

        const lastByDay = new Map();
        for (const r of rowsDailySrc) {
          const day = r.dt.slice(0, 10);
          lastByDay.set(day, r.close);
        }
        const dailyDates = [...lastByDay.keys()].sort((a, b) => a.localeCompare(b));
        const dailyClose = dailyDates.map((d) => lastByDay.get(d));

        if (dailyDates.length >= 2) {
          await writeJson(path.join(outDailyDir, `${t}.json`), {
            ticker: t,
            dates: dailyDates,
            close: dailyClose,
          });
        }
      } catch (e) {
        console.warn(`Skip ${market} ${t}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});