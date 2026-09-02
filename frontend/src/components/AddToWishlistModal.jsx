import { useState } from 'react';
import { api } from '../api.js';
import CardPriceTable from './CardPriceTable.jsx';

export default function AddToWishlistModal({ card: initialCard, onClose, onAdded }) {
  const [card, setCard] = useState(initialCard);
  const [targetPrice, setTargetPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.addToWishlist({
        cardId: card.id,
        card,
        targetPrice: targetPrice === '' ? null : Number(targetPrice),
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

            <CardPriceTable card={card} onCardUpdated={setCard} />

            <form className="add-form" onSubmit={handleSubmit}>
              <label>
                Target price ($) — flagged once the market price drops to or below this
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="optional"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                />
              </label>
              <label className="notes-label">
                Notes
                <textarea rows={2} placeholder="optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>

              {error && <p className="error-text">{error}</p>}

              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Adding…' : '+ Add to Wishlist'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
