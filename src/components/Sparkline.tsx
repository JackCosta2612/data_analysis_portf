import { useEffect, useMemo, useRef, useState } from "react";

type Pt = { value: number };

type Props = {
  series: Pt[];
  width?: number;
  height?: number;
  stroke?: string;
  strokeWidth?: number;
  frameStroke?: string;
  labelColor?: string;
  showFrame?: boolean;
  showYLabels?: boolean;
  showEndpoints?: boolean;
  responsive?: boolean;
  labelFontSize?: number;
};

function buildPath(values: number[], w: number, h: number, pad: number, xOffset: number) {
  const n = values.length;

  const min = Math.min(...values);
  const max = Math.max(...values);

  const xAt = (i: number) => (i / Math.max(n - 1, 1)) * (w - 2 * pad) + pad + xOffset;
  const yAt = (v: number) => {
    const t = max === min ? 0.5 : (v - min) / (max - min);
    return (1 - t) * (h - 2 * pad) + pad;
  };

  const pts = values.map((v, i) => ({ x: xAt(i), y: yAt(v), v }));

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;

  return { d, pts, min, max };
}

export default function Sparkline({
  series,
  width = 360,
  height = 110,
  stroke = "#1F2328",
  strokeWidth = 2,
  frameStroke = "#E5E7EB",
  labelColor = "#4B5563",
  showFrame = true,
  showYLabels = true,
  showEndpoints = true,
  responsive = true,
  labelFontSize = 12,
}: Props) {
  const vals = series.map((p) => p.value).filter((v) => Number.isFinite(v));
  if (vals.length < 2) return null;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [wrapWidth, setWrapWidth] = useState<number | null>(null);

  useEffect(() => {
    if (!responsive) return;
    const el = wrapRef.current;
    if (!el) return;

    const update = () => {
      const w = el.getBoundingClientRect().width;
      if (Number.isFinite(w) && w > 0) setWrapWidth(Math.floor(w));
    };

    update();

    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, [responsive]);

  const totalW = responsive && wrapWidth && wrapWidth > 0 ? wrapWidth : width;

  // Left gutter reserved for Y labels so they don't overlap the plot.
  const labelGutter = showYLabels ? Math.max(34, Math.ceil(labelFontSize * 3.2)) : 0;

  // Plot area width (keep a sane minimum so the chart doesn't collapse).
  const plotW = Math.max(140, totalW - labelGutter);

  // X offset for everything that belongs to the plot.
  const x0 = labelGutter;

  // Extra padding prevents the stroke from being clipped at the left/right ends.
  const pad = Math.max(8, Math.ceil(strokeWidth * 2.5));
  const { d, pts, min, max } = useMemo(
    () => buildPath(vals, plotW, height, pad, x0),
    [vals.join(","), plotW, height, pad, x0]
  );

  const y0 = height - pad; // baseline
  const leftX = x0 + pad;
  const rightX = x0 + plotW - pad;

  const fmt = (v: number) => {
    if (!Number.isFinite(v)) return "";
    // compact formatting
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return `${v.toFixed(1)}`;
  };

  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${plotW + labelGutter} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", overflow: "visible", display: "block" }}
        aria-label="sparkline"
        role="img"
      >
        {showFrame && (
          <>
            {/* frame */}
            <rect
              x={x0 + pad}
              y={pad}
              width={plotW - 2 * pad}
              height={height - 2 * pad}
              fill="none"
              stroke={frameStroke}
              strokeWidth={1}
              rx={6}
            />
            {/* baseline */}
            <line x1={leftX} y1={y0} x2={rightX} y2={y0} stroke={frameStroke} strokeWidth={1} />
          </>
        )}

        {/* path */}
        <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} />

        {showEndpoints && (
          <>
            <circle cx={pts[0].x} cy={pts[0].y} r={2.5} fill={stroke} />
            <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={2.5} fill={stroke} />
          </>
        )}

        {showYLabels && (
          <>
            <text
              x={x0 - 8}
              y={pad + labelFontSize - 2}
              fontSize={labelFontSize}
              fill={labelColor}
              textAnchor="end"
              dominantBaseline="alphabetic"
            >
              {fmt(max)}
            </text>
            <text
              x={x0 - 8}
              y={height - pad - 2}
              fontSize={labelFontSize}
              fill={labelColor}
              textAnchor="end"
              dominantBaseline="alphabetic"
            >
              {fmt(min)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
