import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';

const CONDITIONS = ['Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];

function CollectionRow({ item, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(item.quantity);
  const [condition, setCondition] = useState(item.condition);
  const [notes, setNotes] = useState(item.notes || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.updateCollectionItem(item.id, { quantity: Number(quantity), condition, notes });
      setEditing(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${item.card?.name} from your collection?`)) return;
    await api.removeFromCollection(item.id);
    onChanged();
  }

  const card = item.card;

  return (
    <tr>
      <td className="col-image">
        {card?.images?.small && <img src={card.images.small} alt={card.name} />}
      </td>
      <td>
        <div className="row-name">{card?.name || item.cardId}</div>
        <div className="row-meta">
          {card?.set?.name} · #{card?.number}
        </div>
      </td>
      <td>{item.variant}</td>
      <td>
        {editing ? (
          <select value={condition} onChange={(e) => setCondition(e.target.value)}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : (
          item.condition
        )}
      </td>
      <td>
        {editing ? (
          <input
            type="number"
            min="1"
            className="qty-input"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        ) : (
          item.quantity
        )}
      </td>
      <td>{item.currentPrice ? `$${item.currentPrice.amount.toFixed(2)}` : '—'}</td>
      <td className="col-value">{item.lineValue != null ? `$${item.lineValue.toFixed(2)}` : '—'}</td>
      <td>
        {editing ? (
          <input
            type="text"
            className="notes-input"
            placeholder="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        ) : (
          <span className="muted">{item.notes}</span>
        )}
      </td>
      <td className="col-actions">
        {editing ? (
          <>
            <button className="btn-small" onClick={save} disabled={saving}>
              Save
            </button>
            <button className="btn-small btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="btn-small btn-ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="btn-small btn-danger" onClick={remove}>
              Remove
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

export default function Collection({ refreshKey, onCollectionChanged }) {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [collection, value] = await Promise.all([api.getCollection(), api.getCollectionValue()]);
      setItems(collection);
      setSummary(value);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  function handleChanged() {
    load();
    onCollectionChanged?.();
  }

  return (
    <div className="page">
      <h1>My Collection</h1>

      {summary && (
        <div className="summary-cards">
          <div className="summary-card">
            <div className="summary-label">Unique cards</div>
            <div className="summary-value">{summary.uniqueCards}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Total cards</div>
            <div className="summary-value">{summary.totalCards}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Estimated value</div>
            <div className="summary-value">${summary.totalValue.toFixed(2)}</div>
          </div>
          {summary.missingPrice > 0 && (
            <div className="summary-card">
              <div className="summary-label">Missing price</div>
              <div className="summary-value">{summary.missingPrice}</div>
            </div>
          )}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      {!loading && items.length === 0 && !error && (
        <p className="muted">Your collection is empty. Add cards from the Library tab.</p>
      )}

      {items.length > 0 && (
        <div className="table-wrap">
          <table className="collection-table">
            <thead>
              <tr>
                <th></th>
                <th>Card</th>
                <th>Variant</th>
                <th>Condition</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Value</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <CollectionRow key={item.id} item={item} onChanged={handleChanged} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
