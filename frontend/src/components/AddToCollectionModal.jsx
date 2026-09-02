import { useState } from 'react';
import { api } from '../api.js';
import { tcgplayerVariants, VARIANT_OPTIONS } from '../pricing.js';

const CONDITIONS = ['Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];

export default function AddToCollectionModal({ card, onClose, onAdded }) {
  const variants = tcgplayerVariants(card);
  const defaultVariant = variants[0]?.label || VARIANT_OPTIONS[0];

  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState('Near Mint');
  const [variant, setVariant] = useState(defaultVariant);
  const [acquiredPrice, setAcquiredPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.addToCollection({
        cardId: card.id,
        card,
        quantity: Number(quantity) || 1,
        condition,
        variant,
        acquiredPrice: acquiredPrice === '' ? null : Number(acquiredPrice),
        notes: notes || null,
      });
      onAdded?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const cardmarket = card.cardmarket?.prices;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="modal-body">
          <div className="modal-image">
            {card.images?.large ? (
              <img src={card.images.large} alt={card.name} />
            ) : (
              <div className="card-tile-placeholder">No image</div>
            )}
          </div>

          <div className="modal-details">
            <h2>{card.name}</h2>
            <p className="modal-subtitle">
              {card.set?.name} · #{card.number} · {card.rarity || 'Unknown rarity'}
            </p>

            {(variants.length > 0 || cardmarket) && (
              <div className="price-table">
                <h3>Market prices</h3>
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
              </div>
            )}
            {variants.length === 0 && !cardmarket && <p className="muted">No price data available for this card yet.</p>}

            <form className="add-form" onSubmit={handleSubmit}>
              <div className="form-row">
                <label>
                  Quantity
                  <input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Condition
                  <select value={condition} onChange={(e) => setCondition(e.target.value)}>
                    {CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form-row">
                <label>
                  Variant
                  <select value={variant} onChange={(e) => setVariant(e.target.value)}>
                    {(variants.length ? variants.map((v) => v.label) : VARIANT_OPTIONS).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Price paid ($)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="optional"
                    value={acquiredPrice}
                    onChange={(e) => setAcquiredPrice(e.target.value)}
                  />
                </label>
              </div>
              <label className="notes-label">
                Notes
                <textarea
                  rows={2}
                  placeholder="optional"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>

              {error && <p className="error-text">{error}</p>}

              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Adding…' : 'Add to Collection'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
