// label · value · optional signed delta (color = direction, never color alone —
// always paired with an arrow icon and the "vs paid" label).
export default function StatTile({ label, value, delta, deltaLabel }) {
  const hasDelta = delta != null;
  const isUp = hasDelta && delta >= 0;

  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className="summary-value">{value}</div>
      {hasDelta && (
        <div className={`stat-delta ${isUp ? 'stat-delta-up' : 'stat-delta-down'}`}>
          <span aria-hidden="true">{isUp ? '▲' : '▼'}</span>
          <span>
            {isUp ? '+' : ''}
            {delta.toFixed(2)} {deltaLabel}
          </span>
        </div>
      )}
    </div>
  );
}
