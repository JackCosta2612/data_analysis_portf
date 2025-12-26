type Pt = { value: number };

function pathFrom(values: number[], w: number, h: number, pad = 2) {
  const xs = values.map((_, i) => (i / Math.max(values.length - 1, 1)) * (w - 2 * pad) + pad);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const ys = values.map((v) => {
    const t = max === min ? 0.5 : (v - min) / (max - min);
    return (1 - t) * (h - 2 * pad) + pad;
  });
  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 1; i < values.length; i++) d += ` L ${xs[i]} ${ys[i]}`;
  return d;
}

export default function Sparkline({
  series,
  width = 360,
  height = 90,
  stroke = "#1F2328",
  strokeWidth = 2,
}: {
  series: Pt[];
  width?: number;
  height?: number;
  stroke?: string;
  strokeWidth?: number;
}) {
  const vals = series.map((p) => p.value).filter((v) => Number.isFinite(v));
  if (vals.length < 2) return null;

  const d = pathFrom(vals, width, height);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
    </svg>
  );
}
