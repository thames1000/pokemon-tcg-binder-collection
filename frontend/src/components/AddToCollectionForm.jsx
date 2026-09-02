import { useState } from 'react';
import { api } from '../api.js';
import { tcgplayerVariants, VARIANT_OPTIONS } from '../pricing.js';

const CONDITIONS = ['Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];

export default function AddToCollectionForm({ card, onAdded, submitLabel = 'Add to Collection', initialVariant }) {
  const variants = tcgplayerVariants(card);
  const defaultVariant = initialVariant || variants[0]?.label || VARIANT_OPTIONS[0];

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
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="add-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <label>
          Quantity
          <input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
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
        <textarea rows={2} placeholder="optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {error && <p className="error-text">{error}</p>}

      <button type="submit" className="btn-primary" disabled={saving}>
        {saving ? 'Adding…' : submitLabel}
      </button>
    </form>
  );
}
