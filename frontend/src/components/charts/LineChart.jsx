import { useMemo, useState } from 'react';

const COLOR = '#2a78d6'; // sequential blue — single series, magnitude over time
const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

function niceMax(value) {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

// Single-series line + area chart (value over time). One hue, no legend needed —
// the title names the series. Hairline gridlines, endpoint label, hover crosshair.
export default function LineChart({ points, formatY = (v) => v.toFixed(2) }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  const { path, areaPath, coords, yTicks, maxY } = useMemo(() => {
    const innerW = WIDTH - PAD.left - PAD.right;
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const max = niceMax(Math.max(...points.map((p) => p.value), 1) * 1.15);
    const xFor = (i) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const yFor = (v) => PAD.top + innerH - (v / max) * innerH;
    const coords = points.map((p, i) => ({ x: xFor(i), y: yFor(p.value), ...p }));
    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
    const area = `${line} L ${coords[coords.length - 1].x} ${PAD.top + innerH} L ${coords[0].x} ${PAD.top + innerH} Z`;
    const yTicks = [0, max / 2, max];
    return { path: line, areaPath: area, coords, yTicks, maxY: max };
  }, [points]);

  if (points.length === 0) {
    return <p className="muted">Not enough history yet — value snapshots build up once a day as you use the app.</p>;
  }

  const hovered = hoverIndex != null ? coords[hoverIndex] : null;
  const last = coords[coords.length - 1];

  function handleMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    let best = Infinity;
    coords.forEach((c, i) => {
      const d = Math.abs(c.x - px);
      if (d < best) { best = d; nearest = i; }
    });
    setHoverIndex(nearest);
  }

  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="line-chart"
        onMouseMove={points.length > 1 ? handleMove : undefined}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {yTicks.map((t, i) => {
          const y = PAD.top + (HEIGHT - PAD.top - PAD.bottom) - (t / maxY) * (HEIGHT - PAD.top - PAD.bottom);
          return (
            <g key={i}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} className="chart-gridline" />
              <text x={PAD.left - 8} y={y + 4} className="chart-axis-label" textAnchor="end">
                ${t >= 1000 ? `${(t / 1000).toFixed(1)}K` : t.toFixed(0)}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill={COLOR} opacity="0.1" stroke="none" />
        {points.length > 1 && <path d={path} fill="none" stroke={COLOR} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}

        {coords.map((c, i) => (i === coords.length - 1 || i === 0 || points.length === 1) && (
          <circle key={i} cx={c.x} cy={c.y} r="5" fill={COLOR} stroke="var(--surface)" strokeWidth="2" />
        ))}

        <text x={last.x} y={last.y - 12} className="chart-end-label" textAnchor="end">
          ${formatY(last.value)}
        </text>

        <text x={coords[0].x} y={HEIGHT - 6} className="chart-axis-label" textAnchor="start">
          {coords[0].label}
        </text>
        {coords.length > 1 && (
          <text x={last.x} y={HEIGHT - 6} className="chart-axis-label" textAnchor="end">
            {last.label}
          </text>
        )}

        {hovered && (
          <>
            <line x1={hovered.x} x2={hovered.x} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="chart-crosshair" />
            <circle cx={hovered.x} cy={hovered.y} r="5" fill={COLOR} stroke="var(--surface)" strokeWidth="2" />
          </>
        )}
      </svg>
      {hovered && (
        <div
          className="chart-tooltip"
          style={{ left: `${(hovered.x / WIDTH) * 100}%`, top: `${(hovered.y / HEIGHT) * 100}%` }}
        >
          <div className="chart-tooltip-label">{hovered.label}</div>
          <div className="chart-tooltip-value">${formatY(hovered.value)}</div>
        </div>
      )}
    </div>
  );
}
