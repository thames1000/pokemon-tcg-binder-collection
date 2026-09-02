import { useEffect, useState } from 'react';
import { api } from '../api.js';
import StatTile from '../components/StatTile.jsx';
import LineChart from '../components/charts/LineChart.jsx';
import BarChart from '../components/charts/BarChart.jsx';

function DeltaRow({ item }) {
  const isUp = item.delta >= 0;
  return (
    <div className="delta-row">
      {item.image && <img src={item.image} alt={item.name} className="delta-row-image" />}
      <div className="delta-row-body">
        <div className="delta-row-name">{item.name}</div>
        <div className="muted">
          {item.quantity} owned · paid ${item.costBasis.toFixed(2)} · now ${item.currentValue.toFixed(2)}
        </div>
      </div>
      <div className={`stat-delta ${isUp ? 'stat-delta-up' : 'stat-delta-down'}`}>
        <span aria-hidden="true">{isUp ? '▲' : '▼'}</span>
        <span>
          {isUp ? '+' : ''}
          {item.delta.toFixed(2)}
          {item.deltaPct != null && ` (${isUp ? '+' : ''}${item.deltaPct.toFixed(1)}%)`}
        </span>
      </div>
    </div>
  );
}

export default function Analytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getCollectionAnalytics()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page"><p className="muted">Loading…</p></div>;
  if (error) return <div className="page"><p className="error-text">{error}</p></div>;
  if (!data || data.uniqueCards === 0) {
    return (
      <div className="page">
        <h1>Analytics</h1>
        <p className="muted">Add some cards to your collection to see value trends and breakdowns here.</p>
      </div>
    );
  }

  const hasCostBasis = data.gainers.length > 0 || data.losers.length > 0;

  return (
    <div className="page">
      <h1>Analytics</h1>
      <p className="page-subtitle">Value trends, breakdowns, and unrealized profit/loss for your collection.</p>

      <div className="summary-cards">
        <StatTile label="Estimated value" value={`$${data.totalValue.toFixed(2)}`} />
        {hasCostBasis && (
          <StatTile
            label="Unrealized P/L"
            value={`$${data.costBasisTotal.toFixed(2)} paid`}
            delta={data.totalUnrealizedPL}
            deltaLabel="vs. paid"
          />
        )}
        <StatTile label="Unique cards" value={data.uniqueCards} />
        <StatTile label="Total cards" value={data.totalCards} />
      </div>

      <section className="analytics-section">
        <h2>Value over time</h2>
        <LineChart points={data.valueHistory.map((h) => ({ label: h.date.slice(5), value: h.totalValue }))} />
      </section>

      <div className="analytics-grid">
        <section className="analytics-section">
          <h2>By set</h2>
          <BarChart data={data.bySet.map((s) => ({ label: s.label, value: s.value }))} />
        </section>
        <section className="analytics-section">
          <h2>By rarity</h2>
          <BarChart data={data.byRarity.map((r) => ({ label: r.label, value: r.value }))} />
        </section>
      </div>

      {hasCostBasis && (
        <div className="analytics-grid">
          <section className="analytics-section">
            <h2>Top gainers</h2>
            {data.gainers.length === 0 ? (
              <p className="muted">No gainers yet — add a "price paid" when adding cards to track this.</p>
            ) : (
              data.gainers.map((g) => <DeltaRow key={g.cardId + g.name} item={g} />)
            )}
          </section>
          <section className="analytics-section">
            <h2>Top losers</h2>
            {data.losers.length === 0 ? (
              <p className="muted">No losers — nice.</p>
            ) : (
              data.losers.map((l) => <DeltaRow key={l.cardId + l.name} item={l} />)
            )}
          </section>
        </div>
      )}

      {!hasCostBasis && (
        <p className="muted">
          Add a "price paid" when adding cards to your collection to see profit/loss tracking here.
        </p>
      )}
    </div>
  );
}
