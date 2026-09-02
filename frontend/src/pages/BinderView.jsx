import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import BinderSlot from '../components/BinderSlot.jsx';
import BinderSlotModal from '../components/BinderSlotModal.jsx';

const SLOTS_PER_SIDE = 9;
const SLOTS_PER_PAGE = SLOTS_PER_SIDE * 2;

function SideGrid({ label, positions, slotByPosition, onSlotClick }) {
  return (
    <div className="binder-side">
      <div className="binder-side-label">{label}</div>
      <div className="binder-side-grid">
        {positions.map((pos) => (
          <BinderSlot key={pos} slot={slotByPosition.get(pos) || null} onClick={() => onSlotClick(pos)} />
        ))}
      </div>
    </div>
  );
}

export default function BinderView() {
  const { id } = useParams();
  const [binder, setBinder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [activeSlotPos, setActiveSlotPos] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [addingPage, setAddingPage] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.getBinder(id);
      setBinder(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const slotByPosition = useMemo(() => {
    const map = new Map();
    (binder?.slots || []).forEach((s) => map.set(s.position, s));
    return map;
  }, [binder]);

  if (loading) return <div className="page"><p className="muted">Loading…</p></div>;
  if (error) return <div className="page"><p className="error-text">{error}</p></div>;
  if (!binder) return null;

  const pageCount = binder.pageCount;
  const ownedCount = binder.slots.filter((s) => s.owned).length;
  const ownedPct = binder.totalSlots > 0 ? Math.round((ownedCount / binder.totalSlots) * 100) : 0;
  const frontStart = pageIndex * SLOTS_PER_PAGE;
  const backStart = frontStart + SLOTS_PER_SIDE;
  const frontPositions = Array.from({ length: SLOTS_PER_SIDE }, (_, i) => frontStart + i);
  const backPositions = Array.from({ length: SLOTS_PER_SIDE }, (_, i) => backStart + i);

  async function saveName() {
    if (nameDraft.trim() && nameDraft.trim() !== binder.name) {
      await api.updateBinder(id, { name: nameDraft.trim() });
      load();
    }
    setRenaming(false);
  }

  async function addPage() {
    setAddingPage(true);
    try {
      await api.updateBinder(id, { pageCount: pageCount + 1 });
      await load();
      setPageIndex(pageCount); // jump to the new last page
    } finally {
      setAddingPage(false);
    }
  }

  return (
    <div className="page">
      <Link to="/binders" className="binder-back-link">
        ← All binders
      </Link>

      <div className="page-header-row">
        {renaming ? (
          <input
            type="text"
            className="binder-name-input"
            value={nameDraft}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && saveName()}
          />
        ) : (
          <h1
            onClick={() => {
              setNameDraft(binder.name);
              setRenaming(true);
            }}
            title="Click to rename"
            style={{ cursor: 'pointer' }}
          >
            {binder.name}
          </h1>
        )}
      </div>
      <p className="page-subtitle">
        {binder.sourceSetName ? `${binder.sourceSetName} · ` : ''}
        {binder.sourcePokemonName ? `Every ${binder.sourcePokemonName} card · ` : ''}
        {binder.slots.length}/{binder.totalSlots} slots planned ·{' '}
        <span className={ownedCount > 0 ? 'success-text' : ''}>
          {ownedCount} owned ({ownedPct}%)
        </span>
      </p>

      {binder.estimate && (
        <div className="summary-cards">
          <div className="summary-card">
            <div className="summary-label">Already have</div>
            <div className="summary-value">${binder.estimate.ownedValue.toFixed(2)}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Est. cost to complete</div>
            <div className="summary-value">${binder.estimate.remainingCost.toFixed(2)}</div>
            <div className="muted" style={{ fontSize: '0.72rem', marginTop: '0.2rem' }}>
              {binder.estimate.pricedRemaining} priced
              {binder.estimate.unpricedRemaining > 0 && `, ${binder.estimate.unpricedRemaining} no price data`}
            </div>
          </div>
        </div>
      )}

      <div className="binder-page-nav">
        <button disabled={pageIndex <= 0} onClick={() => setPageIndex((p) => p - 1)}>
          ← Prev page
        </button>
        <span>
          Page {pageIndex + 1} of {pageCount}
        </span>
        <button disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((p) => p + 1)}>
          Next page →
        </button>
        <button type="button" className="btn-small" onClick={addPage} disabled={addingPage}>
          {addingPage ? 'Adding…' : '+ Add page'}
        </button>
      </div>

      <div className="binder-spread">
        <SideGrid label="Front" positions={frontPositions} slotByPosition={slotByPosition} onSlotClick={setActiveSlotPos} />
        <SideGrid label="Back" positions={backPositions} slotByPosition={slotByPosition} onSlotClick={setActiveSlotPos} />
      </div>

      {activeSlotPos != null && (
        <BinderSlotModal
          binderId={id}
          position={activeSlotPos}
          slot={slotByPosition.get(activeSlotPos) || null}
          onClose={() => setActiveSlotPos(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
