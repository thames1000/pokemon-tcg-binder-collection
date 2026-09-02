import { useEffect, useState } from 'react';
import { api } from '../api.js';

const SLOTS_PER_PAGE = 18; // 3x3 front + 3x3 back

export default function NewBinderModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState('manual');
  const [pageCount, setPageCount] = useState(4);
  const [sets, setSets] = useState([]);
  const [setId, setSetId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const [preview, setPreview] = useState(null); // { setName, totalCards, rarities }
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [excludePromos, setExcludePromos] = useState(true);
  const [rarityRules, setRarityRules] = useState({}); // { [rarity]: 1 | 2 }

  useEffect(() => {
    api.getSets().then(setSets).catch(() => {});
  }, []);

  useEffect(() => {
    if (mode !== 'set' || !setId) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    api
      .getBinderSetPreview(setId)
      .then((data) => {
        setPreview(data);
        const rules = {};
        data.rarities.forEach((r) => {
          rules[r.rarity] = r.defaultSlots;
        });
        setRarityRules(rules);
      })
      .catch((err) => setPreviewError(err.message))
      .finally(() => setPreviewLoading(false));
  }, [mode, setId]);

  const totalSlots = preview
    ? preview.rarities.reduce((sum, r) => {
        if (excludePromos && r.isPromo) return sum;
        return sum + r.count * (rarityRules[r.rarity] === 2 ? 2 : 1);
      }, 0)
    : null;
  const previewPages = totalSlots != null ? Math.max(1, Math.ceil(totalSlots / SLOTS_PER_PAGE)) : null;

  function toggleRarity(rarity) {
    setRarityRules((prev) => ({ ...prev, [rarity]: prev[rarity] === 2 ? 1 : 2 }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const payload =
        mode === 'set'
          ? { name: name.trim(), mode: 'set', setId, excludePromos, rarityRules }
          : { name: name.trim(), mode: 'manual', pageCount: Number(pageCount) };
      const binder = await api.createBinder(payload);
      onCreated?.(binder);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2>New Binder</h2>

        <form className="add-form" onSubmit={handleSubmit}>
          <label>
            Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Base Set Binder" required />
          </label>

          <div className="binder-mode-toggle">
            <button type="button" className={mode === 'manual' ? 'btn-mode active' : 'btn-mode'} onClick={() => setMode('manual')}>
              Manual entry
            </button>
            <button type="button" className={mode === 'set' ? 'btn-mode active' : 'btn-mode'} onClick={() => setMode('set')}>
              From a master set
            </button>
          </div>

          {mode === 'manual' ? (
            <label>
              Starting page count
              <input type="number" min="1" value={pageCount} onChange={(e) => setPageCount(e.target.value)} />
              <span className="muted" style={{ fontWeight: 400 }}>
                {Number(pageCount) || 0} pages × 18 slots = {(Number(pageCount) || 0) * SLOTS_PER_PAGE} pockets. You can add more pages later.
              </span>
            </label>
          ) : (
            <>
              <label>
                Set
                <select value={setId} onChange={(e) => setSetId(e.target.value)} required>
                  <option value="">Choose a set…</option>
                  {sets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.series}) — {s.total} cards
                    </option>
                  ))}
                </select>
              </label>

              {previewLoading && <p className="muted">Loading rarity breakdown…</p>}
              {previewError && <p className="error-text">{previewError}</p>}

              {preview && (
                <div className="rarity-rules">
                  <label className="rarity-rules-promo">
                    <input type="checkbox" checked={excludePromos} onChange={(e) => setExcludePromos(e.target.checked)} />
                    Exclude promo-rarity cards
                  </label>

                  <div className="rarity-rules-list">
                    {preview.rarities.map((r) => {
                      const excluded = excludePromos && r.isPromo;
                      const checked = rarityRules[r.rarity] === 2;
                      return (
                        <label key={r.rarity} className={`rarity-rule-row ${excluded ? 'rarity-rule-excluded' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={excluded}
                            onChange={() => toggleRarity(r.rarity)}
                          />
                          <span className="rarity-rule-name">
                            {r.rarity} ({r.count}){excluded && ' — excluded'}
                          </span>
                          <span className="rarity-rule-slots">{excluded ? '—' : checked ? '2 slots each' : '1 slot each'}</span>
                        </label>
                      );
                    })}
                  </div>

                  <p className="rarity-rules-total">
                    Total: <strong>{totalSlots} slots</strong> → {previewPages} page{previewPages === 1 ? '' : 's'} (
                    {previewPages * SLOTS_PER_PAGE} pockets), filled in card-number order.
                  </p>
                </div>
              )}
            </>
          )}

          {error && <p className="error-text">{error}</p>}

          <button type="submit" className="btn-primary" disabled={creating || (mode === 'set' && !setId)}>
            {creating ? 'Creating…' : 'Create Binder'}
          </button>
        </form>
      </div>
    </div>
  );
}
