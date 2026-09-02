import { useState } from 'react';
import { api } from '../api.js';
import { tcgplayerVariants } from '../pricing.js';

// Renders a card's TCGplayer/Cardmarket price breakdown, with a button to force a
// live re-fetch (bypassing the backend's cache) instead of waiting out its TTL.
export default function CardPriceTable({ card, onCardUpdated }) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const [refreshedAt, setRefreshedAt] = useState(null);

  const variants = tcgplayerVariants(card);
  const cardmarket = card.cardmarket?.prices;

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const fresh = await api.refreshCardPrice(card.id);
      onCardUpdated?.(fresh);
      setRefreshedAt(new Date());
    } catch (err) {
      setRefreshError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="price-table">
      <div className="price-table-header">
        <h3>Market prices</h3>
        <button type="button" className="btn-small" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : '↻ Refresh price'}
        </button>
      </div>

      {(variants.length > 0 || cardmarket) && (
        <>
          {variants.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Low</th>
                  <th>Market</th>
                  <th>High</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <tr key={v.key}>
                    <td>{v.label}</td>
                    <td>{v.low != null ? `$${v.low.toFixed(2)}` : '—'}</td>
                    <td>{v.market != null ? `$${v.market.toFixed(2)}` : '—'}</td>
                    <td>{v.high != null ? `$${v.high.toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {cardmarket && (
            <p className="cardmarket-line">
              Cardmarket trend: €{cardmarket.trendPrice?.toFixed(2) ?? '—'} · average: €
              {cardmarket.averageSellPrice?.toFixed(2) ?? '—'}
            </p>
          )}
        </>
      )}
      {variants.length === 0 && !cardmarket && <p className="muted">No price data available for this card yet.</p>}

      {refreshError && <p className="error-text">{refreshError}</p>}
      {refreshedAt && !refreshError && (
        <p className="muted price-refreshed-note">Refreshed at {refreshedAt.toLocaleTimeString()}</p>
      )}
    </div>
  );
}
