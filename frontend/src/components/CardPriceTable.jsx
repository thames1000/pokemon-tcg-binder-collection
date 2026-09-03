import { useState } from 'react';
import { api } from '../api.js';
import { tcgplayerVariants } from '../pricing.js';

// card.pricesUpdatedAt comes from the backend as either a SQLite
// datetime('now') string ("2026-09-03 15:40:57", UTC, no zone marker) or an
// ISO string (from a just-completed live fetch) — normalize both to a Date.
function formatLastUpdated(timestamp) {
  if (!timestamp) return null;
  const iso = timestamp.includes('T') ? timestamp : `${timestamp.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

// Renders a card's TCGplayer/Cardmarket price breakdown, with a button to force a
// live re-fetch (bypassing the backend's cache) instead of waiting out its TTL.
export default function CardPriceTable({ card, onCardUpdated }) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const [refreshedAt, setRefreshedAt] = useState(null);

  const variants = tcgplayerVariants(card);
  const cardmarket = card.cardmarket?.prices;
  // Only ever set when pokemontcg.io has neither TCGplayer nor Cardmarket data for
  // this card (common for very recently released sets — see README) — a TCGdex
  // fallback price, if one was found. See backend/tcgdexApi.js.
  const fallback = variants.length === 0 && !cardmarket ? card.priceFallback : null;
  const lastUpdated = formatLastUpdated(card.pricesUpdatedAt);

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
      {fallback && (
        <p className="cardmarket-line">
          {fallback.source || 'TCGdex'}: {fallback.currency === 'EUR' ? '€' : '$'}
          {fallback.amount.toFixed(2)}
          <span className="muted"> (pokemontcg.io has no pricing yet for this card)</span>
        </p>
      )}
      {variants.length === 0 && !cardmarket && !fallback && (
        <p className="muted">No price data available for this card yet.</p>
      )}

      {refreshError && <p className="error-text">{refreshError}</p>}
      {refreshedAt && !refreshError ? (
        <p className="muted price-refreshed-note">Refreshed at {refreshedAt.toLocaleTimeString()}</p>
      ) : (
        lastUpdated && <p className="muted price-refreshed-note">Prices last updated {lastUpdated}</p>
      )}
    </div>
  );
}
