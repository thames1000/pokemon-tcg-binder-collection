const COLOR = '#2a78d6'; // sequential blue — magnitude comparison, one hue (not identity)

// Horizontal bar chart: ranked magnitude across categories (by set / by rarity).
// One hue throughout — color here isn't encoding identity, the label is. Direct
// value label at each bar's tip, so nothing depends on reading a shared axis.
export default function BarChart({ data, formatValue = (v) => `$${v.toFixed(2)}` }) {
  if (data.length === 0) return <p className="muted">No priced cards yet.</p>;

  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="bar-chart">
      {data.map((d) => (
        <div className="bar-chart-row" key={d.label}>
          <div className="bar-chart-label" title={d.label}>
            {d.label}
          </div>
          <div className="bar-chart-track">
            <div className="bar-chart-fill" style={{ width: `${Math.max((d.value / max) * 100, 2)}%` }} />
          </div>
          <div className="bar-chart-value">{formatValue(d.value)}</div>
        </div>
      ))}
    </div>
  );
}
