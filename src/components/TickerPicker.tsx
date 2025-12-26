import { useEffect, useMemo, useState } from "react";
import Select from "react-select";

type TickerRow = {
  ticker: string;
  name?: string;
};

type Option = {
  value: string; // ticker
  label: string; // "TICKER · Name"
};

export default function TickerPicker(props: {
  value: string[];
  onChange: (next: string[]) => void;
  maxTickers?: number;
}) {
  const { value, onChange, maxTickers = 10 } = props;

  const [rows, setRows] = useState<TickerRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL || "/";
    const url = `${base}data/tickers.json`;

    (async () => {
      try {
        setErr(null);
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Fetch failed: ${r.status} (${url})`);
        const data = (await r.json()) as unknown;

        // Accept either: array of rows OR { tickers: [...] }
        const arr =
          Array.isArray(data)
            ? (data as unknown[])
            : (typeof data === "object" && data && "tickers" in (data as Record<string, unknown>))
              ? (((data as Record<string, unknown>).tickers as unknown[]) ?? [])
              : [];

        const cleaned: TickerRow[] = arr
          .map((x) => x as Partial<TickerRow>)
          .filter((x): x is { ticker: string; name?: string } => typeof x.ticker === "string" && x.ticker.length > 0)
          .map((x) => ({ ticker: x.ticker.toUpperCase(), name: x.name }));

        setRows(cleaned);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg);
        setRows([]);
      }
    })();
  }, []);

  const options: Option[] = useMemo(() => {
    const r = rows ?? [];
    return r
      .slice()
      .sort((a, b) => a.ticker.localeCompare(b.ticker))
      .map((x) => ({
        value: x.ticker,
        label: x.name ? `${x.ticker} · ${x.name}` : x.ticker,
      }));
  }, [rows]);

  const selectedSet = useMemo(() => new Set(value.map((t) => t.toUpperCase())), [value]);

  const selected: Option[] = useMemo(() => {
    return options.filter((o) => selectedSet.has(o.value));
  }, [options, selectedSet]);

  const atLimit = value.length >= maxTickers;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="text-sm font-semibold">Ticker picker</h3>
          <p className="mt-1 text-xs text-muted">Search and select tickers (static universe).</p>
        </div>
        <div className="text-[11px] text-muted">
          {value.length}/{maxTickers}
        </div>
      </div>

      <div className="mt-3">
        <Select<Option, true>
          isMulti
          isSearchable
          options={options}
          value={selected}
          isOptionDisabled={(opt) => atLimit && !selectedSet.has(opt.value)}
          onChange={(newValue) => onChange(newValue.map((v) => v.value))}
          isLoading={rows === null}
          placeholder={rows ? "Type a ticker or name…" : "Loading…"}
          noOptionsMessage={() => (err ? "Failed to load tickers.json" : "No matches")}
        />
        {err && (
          <div className="mt-2 text-xs text-red-600">
            Ticker load failed: <span className="font-mono">{err}</span>
          </div>
        )}
      </div>
    </div>
  );
}