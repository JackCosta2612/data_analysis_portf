import { useEffect, useMemo, useState } from "react";
import Select from "react-select";

export type Ticker = { ticker: string; name: string };

type Option = { value: string; label: string };

export default function TickerPicker(props: {
  value: string[];
  onChange: (tickers: string[]) => void;
}) {
  const [universe, setUniverse] = useState<Ticker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch("/data_analysis_portf/data/tickers.json");
      const data = (await res.json()) as Ticker[];
      setUniverse(data);
      setLoading(false);
    })();
  }, []);

  const options: Option[] = useMemo(
    () =>
      universe.map((t) => ({
        value: t.ticker,
        label: `${t.ticker}  ·  ${t.name}`,
      })),
    [universe]
  );

  const selected: Option[] = useMemo(() => {
    const map = new Map(options.map((o) => [o.value, o]));
    return props.value.map((v) => map.get(v)).filter(Boolean) as Option[];
  }, [props.value, options]);

  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">Ticker picker</div>
      <div className="text-xs text-muted">
        Search and select tickers (static universe).
      </div>

      <Select
        isMulti
        isLoading={loading}
        options={options}
        value={selected}
        onChange={(vals) => props.onChange(vals.map((v) => v.value))}
        placeholder={loading ? "Loading tickers..." : "Type to search…"}
        classNamePrefix="rs"
        styles={{
          control: (base) => ({
            ...base,
            borderRadius: 12,
            borderColor: "#E5E7EB",
            boxShadow: "none",
            minHeight: 40,
          }),
          menu: (base) => ({ ...base, borderRadius: 12 }),
        }}
      />
    </div>
  );
}
