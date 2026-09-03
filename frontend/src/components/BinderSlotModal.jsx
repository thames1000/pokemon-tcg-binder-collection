import { useEffect, useState } from 'react';
import { api } from '../api.js';
import CardTile from './CardTile.jsx';
import CardPriceTable from './CardPriceTable.jsx';
import AddToCollectionForm from './AddToCollectionForm.jsx';
import { useCardSearch } from '../hooks/useCardSearch.js';
import { VARIANT_OPTIONS } from '../pricing.js';

export default function BinderSlotModal({ binderId, position, slot, dexLabel, onClose, onChanged }) {
  const [mode, setMode] = useState(slot ? 'view' : 'search'); // 'view' | 'search' | 'add-to-collection'
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [variant, setVariant] = useState('');
  const [added, setAdded] = useState(false);
  const [viewCard, setViewCard] = useState(slot?.card || null);
  const [ownedMatches, setOwnedMatches] = useState(null);
  const [ownedMatchesLoading, setOwnedMatchesLoading] = useState(false);

  // The hook's own mount-time search is suppressed — we always drive the first
  // search ourselves below, so a dexLabel that arrives a beat after mount (it's
  // fetched async in the parent) can't race a generic search and have whichever
  // one resolves last silently win.
  const {
    name, setName, setId, setSetId, sets, cards, page, setPage,
    totalCount, totalPages, loading, error: searchError, handleSearchSubmit, retry, searchFor, pageSize,
  } = useCardSearch({ skipInitialSearch: true });

  // For an empty slot with a National Dex label, jump straight to "cards you
  // already own matching this Pokémon" plus a search pre-filled with its name
  // — the whole point of the label is not having to figure out what to type.
  // For a plain empty slot (no label), fall back to the original behavior: an
  // unfiltered browse-everything search. Re-runs if dexLabel arrives after
  // mount, so timing can't leave the search box and results out of sync.
  useEffect(() => {
    if (slot?.card) return; // view mode already has a card, nothing to search for
    if (!dexLabel) {
      searchFor('');
      return;
    }
    searchFor(dexLabel.name);
    setOwnedMatchesLoading(true);
    api
      .searchCollectionByName(dexLabel.name)
      .then(setOwnedMatches)
      .catch(() => setOwnedMatches([]))
      .finally(() => setOwnedMatchesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dexLabel?.name]);

  async function place(card, placementVariant) {
    setSaving(true);
    setError(null);
    try {
      await api.setBinderSlot(binderId, position, {
        cardId: card.id,
        card,
        variant: placementVariant !== undefined ? placementVariant : variant || null,
      });
      onChanged?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      await api.clearBinderSlot(binderId, position);
      onChanged?.();
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

        {mode === 'view' && viewCard && (
          <div className="modal-body">
            <div className="modal-image">
              {viewCard.images?.large ? (
                <img src={viewCard.images.large} alt={viewCard.name} />
              ) : (
                <div className="card-tile-placeholder">No image</div>
              )}
            </div>
            <div className="modal-details">
              <h2>{viewCard.name}</h2>
              <p className="modal-subtitle">
                {viewCard.set?.name} · #{viewCard.number} · {viewCard.rarity || 'Unknown rarity'}
                {slot.variant && ` · ${slot.variant}`}
              </p>
              <p className={slot.owned ? 'success-text' : 'muted'}>
                {slot.owned ? '✓ In your collection' : 'Not in your collection yet'}
              </p>

              <CardPriceTable
                card={viewCard}
                onCardUpdated={(fresh) => {
                  setViewCard(fresh);
                  onChanged?.();
                }}
              />

              {error && <p className="error-text">{error}</p>}

              <div className="form-row" style={{ marginTop: '1rem' }}>
                {!slot.owned && (
                  <button type="button" className="btn-primary" onClick={() => setMode('add-to-collection')} disabled={saving}>
                    + Add to Collection
                  </button>
                )}
                <button type="button" className={slot.owned ? 'btn-primary' : 'btn-small'} onClick={() => setMode('search')} disabled={saving}>
                  Replace
                </button>
                <button type="button" className="btn-small btn-danger" onClick={remove} disabled={saving}>
                  {saving ? 'Removing…' : 'Remove from slot'}
                </button>
              </div>
            </div>
          </div>
        )}

        {mode === 'add-to-collection' && viewCard && (
          <div className="modal-body">
            <div className="modal-image">
              {viewCard.images?.large ? (
                <img src={viewCard.images.large} alt={viewCard.name} />
              ) : (
                <div className="card-tile-placeholder">No image</div>
              )}
            </div>
            <div className="modal-details">
              <h2>{viewCard.name}</h2>
              <p className="modal-subtitle">
                {viewCard.set?.name} · #{viewCard.number} · {viewCard.rarity || 'Unknown rarity'}
              </p>

              {added ? (
                <>
                  <p className="success-text">Added to your collection.</p>
                  <button type="button" className="btn-primary" onClick={onClose}>
                    Done
                  </button>
                </>
              ) : (
                <AddToCollectionForm
                  card={viewCard}
                  initialVariant={slot.variant || undefined}
                  onAdded={() => {
                    setAdded(true);
                    onChanged?.();
                  }}
                />
              )}

              {!added && (
                <button type="button" className="btn-small btn-ghost" style={{ marginTop: '0.75rem' }} onClick={() => setMode('view')}>
                  ← Back
                </button>
              )}
            </div>
          </div>
        )}

        {mode === 'search' && (
          <div>
            <h2>{slot?.card ? 'Replace card' : 'Add a card to this slot'}</h2>

            {dexLabel && (
              <p className="modal-subtitle" style={{ marginTop: 0 }}>
                National Dex #{dexLabel.number} · {dexLabel.name}
              </p>
            )}

            {dexLabel && (
              <div className="owned-matches">
                <h3>From your collection</h3>
                {ownedMatchesLoading && <p className="muted">Checking your collection…</p>}
                {!ownedMatchesLoading && ownedMatches?.length === 0 && (
                  <p className="muted">You don't own a "{dexLabel.name}" card yet — search below to plan the slot anyway.</p>
                )}
                {!ownedMatchesLoading && ownedMatches?.length > 0 && (
                  <div className="owned-matches-list">
                    {ownedMatches.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className="owned-match-row"
                        onClick={() => place(item.card, item.variant)}
                        disabled={saving}
                      >
                        {item.card?.images?.small && <img src={item.card.images.small} alt={item.card.name} />}
                        <span className="owned-match-info">
                          <span className="owned-match-name">{item.card?.name}</span>
                          <span className="muted">
                            {item.card?.set?.name} · #{item.card?.number} · {item.variant} · {item.condition}
                            {item.quantity > 1 && ` · ×${item.quantity}`}
                          </span>
                        </span>
                        <span className="btn-small btn-primary" style={{ pointerEvents: 'none' }}>
                          Use this
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="muted" style={{ margin: '0.75rem 0 0', fontSize: '0.78rem' }}>
                  Or search the full library:
                </p>
              </div>
            )}

            <form className="search-bar" onSubmit={handleSearchSubmit}>
              <input type="text" placeholder="Search card name…" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <select value={setId} onChange={(e) => setSetId(e.target.value)}>
                <option value="">All sets</option>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.series})
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-primary">
                Search
              </button>
            </form>

            <label className="binder-variant-picker">
              Planned variant for this slot (optional)
              <select value={variant} onChange={(e) => setVariant(e.target.value)}>
                <option value="">Unspecified</option>
                {VARIANT_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            {(error || searchError) && <p className="error-text">{error || searchError} {searchError && <button type="button" className="btn-small" onClick={retry}>Retry</button>}</p>}
            {loading && <p className="muted">Loading…</p>}
            {saving && <p className="muted">Placing…</p>}

            <div className="card-grid binder-search-grid">
              {cards.map((card) => (
                <CardTile key={card.id} card={card} onOpen={place} />
              ))}
            </div>

            {totalCount > pageSize && (
              <div className="pagination">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ← Prev
                </button>
                <span>
                  Page {page} of {totalPages}
                </span>
                <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
