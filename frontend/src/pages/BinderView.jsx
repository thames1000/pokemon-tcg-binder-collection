import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import BinderSlot from '../components/BinderSlot.jsx';
import BinderSlotModal from '../components/BinderSlotModal.jsx';

const SLOTS_PER_SIDE = 9;
const SLOTS_PER_PAGE = SLOTS_PER_SIDE * 2;
const VIEW_MODE_KEY = 'binderViewMode';

function dexLabelFor(dexNames, pos) {
  if (!dexNames || pos >= dexNames.length) return null;
  return { number: pos + 1, name: dexNames[pos] };
}

function SideGrid({ label, positions, slotByPosition, dexNames, highlightPosition, onSlotClick }) {
  return (
    <div className="binder-side">
      <div className="binder-side-label">{label}</div>
      <div className="binder-side-grid">
        {positions.map((pos) => (
          <BinderSlot
            key={pos}
            slot={slotByPosition.get(pos) || null}
            dexLabel={dexLabelFor(dexNames, pos)}
            highlighted={pos === highlightPosition}
            onClick={() => onSlotClick(pos)}
          />
        ))}
      </div>
    </div>
  );
}

function PageSpread({ pageNumber, positions: { frontPositions, backPositions }, slotByPosition, dexNames, highlightPosition, onSlotClick, showLabel }) {
  return (
    <div className="binder-spread-wrap" id={`binder-page-${pageNumber}`}>
      {showLabel && <div className="binder-scroll-page-label">Page {pageNumber}</div>}
      <div className="binder-spread">
        <SideGrid label="Front" positions={frontPositions} slotByPosition={slotByPosition} dexNames={dexNames} highlightPosition={highlightPosition} onSlotClick={onSlotClick} />
        <SideGrid label="Back" positions={backPositions} slotByPosition={slotByPosition} dexNames={dexNames} highlightPosition={highlightPosition} onSlotClick={onSlotClick} />
      </div>
    </div>
  );
}

function pagePositions(pageIndex) {
  const frontStart = pageIndex * SLOTS_PER_PAGE;
  const backStart = frontStart + SLOTS_PER_SIDE;
  return {
    frontPositions: Array.from({ length: SLOTS_PER_SIDE }, (_, i) => frontStart + i),
    backPositions: Array.from({ length: SLOTS_PER_SIDE }, (_, i) => backStart + i),
  };
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
  const [dexNames, setDexNames] = useState(null);
  const [findQuery, setFindQuery] = useState('');
  const [matches, setMatches] = useState([]); // positions matching the last search
  const [matchIndex, setMatchIndex] = useState(0);
  const [highlightPosition, setHighlightPosition] = useState(null);
  const [findMessage, setFindMessage] = useState(null);
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem(VIEW_MODE_KEY) || 'page';
    } catch {
      return 'page';
    }
  });

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

  useEffect(() => {
    if (binder?.isNationalDex && !dexNames) {
      api.getNationalDex().then(setDexNames).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binder?.isNationalDex]);

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

  function setMode(mode) {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      /* private browsing etc. — fine, just won't persist */
    }
  }

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
      setPageIndex(pageCount); // jump to the new last page (page mode only)
    } finally {
      setAddingPage(false);
    }
  }

  // Jump to whichever page holds `position` (switching page in 'page' mode, or
  // smooth-scrolling to that page's anchor in 'scroll' mode) and flash a
  // highlight on the slot itself so it's not just "the right page" but "right
  // there." setPageIndex/setHighlightPosition are both called synchronously
  // here, so React batches them into one re-render — the new page renders
  // already highlighted, no flash-then-highlight race.
  function jumpToPosition(pos) {
    const targetPage = Math.floor(pos / SLOTS_PER_PAGE);
    if (viewMode === 'page') {
      setPageIndex(targetPage);
    } else {
      document.getElementById(`binder-page-${targetPage + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setHighlightPosition(pos);
    setTimeout(() => setHighlightPosition((p) => (p === pos ? null : p)), 3000);
  }

  function handleFindSubmit(e) {
    e.preventDefault();
    const q = findQuery.trim().toLowerCase();
    if (!q) {
      setMatches([]);
      setFindMessage(null);
      return;
    }
    const found = [];
    const filledPositions = new Set();
    binder.slots.forEach((s) => {
      filledPositions.add(s.position);
      if (s.card?.name?.toLowerCase().includes(q)) found.push(s.position);
    });
    // For a National Dex binder, also offer empty slots whose species label
    // matches — the whole point of finding a slot is often "where would this
    // card go" before you actually own a copy to place there.
    if (dexNames) {
      dexNames.forEach((dexName, i) => {
        if (!filledPositions.has(i) && dexName.toLowerCase().includes(q)) found.push(i);
      });
    }
    found.sort((a, b) => a - b);
    if (found.length === 0) {
      setMatches([]);
      setFindMessage(`No slot matches "${findQuery.trim()}"`);
      setHighlightPosition(null);
      return;
    }
    setMatches(found);
    setMatchIndex(0);
    setFindMessage(`${found.length} match${found.length > 1 ? 'es' : ''}`);
    jumpToPosition(found[0]);
  }

  function goToMatch(delta) {
    if (matches.length === 0) return;
    const next = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(next);
    jumpToPosition(matches[next]);
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
        {binder.isNationalDex ? 'National Dex · ' : ''}
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

      <form className="binder-find-bar" onSubmit={handleFindSubmit}>
        <input
          type="text"
          placeholder="Find a card in this binder…"
          value={findQuery}
          onChange={(e) => setFindQuery(e.target.value)}
        />
        <button type="submit" className="btn-small">
          Find
        </button>
        {matches.length > 1 && (
          <div className="binder-find-nav">
            <button type="button" className="btn-small" onClick={() => goToMatch(-1)}>
              ← Prev
            </button>
            <span className="muted">
              {matchIndex + 1} of {matches.length}
            </span>
            <button type="button" className="btn-small" onClick={() => goToMatch(1)}>
              Next →
            </button>
          </div>
        )}
        {findMessage && matches.length <= 1 && <span className="muted">{findMessage}</span>}
      </form>

      <div className="binder-page-nav">
        {viewMode === 'page' ? (
          <>
            <button disabled={pageIndex <= 0} onClick={() => setPageIndex((p) => p - 1)}>
              ← Prev page
            </button>
            <span>
              Page {pageIndex + 1} of {pageCount}
            </span>
            <button disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((p) => p + 1)}>
              Next page →
            </button>
          </>
        ) : (
          <span className="muted">{pageCount} pages, scroll to browse</span>
        )}
        <button type="button" className="btn-small" onClick={addPage} disabled={addingPage}>
          {addingPage ? 'Adding…' : '+ Add page'}
        </button>
        <div className="binder-view-toggle">
          <button type="button" className={viewMode === 'page' ? 'btn-mode active' : 'btn-mode'} onClick={() => setMode('page')}>
            One page
          </button>
          <button type="button" className={viewMode === 'scroll' ? 'btn-mode active' : 'btn-mode'} onClick={() => setMode('scroll')}>
            Scroll all pages
          </button>
        </div>
      </div>

      {viewMode === 'page' ? (
        <PageSpread
          pageNumber={pageIndex + 1}
          positions={pagePositions(pageIndex)}
          slotByPosition={slotByPosition}
          dexNames={dexNames}
          highlightPosition={highlightPosition}
          onSlotClick={setActiveSlotPos}
          showLabel={false}
        />
      ) : (
        <div className="binder-scroll-list">
          {Array.from({ length: pageCount }, (_, i) => (
            <PageSpread
              key={i}
              pageNumber={i + 1}
              positions={pagePositions(i)}
              slotByPosition={slotByPosition}
              dexNames={dexNames}
              highlightPosition={highlightPosition}
              onSlotClick={setActiveSlotPos}
              showLabel
            />
          ))}
        </div>
      )}

      {activeSlotPos != null && (
        <BinderSlotModal
          binderId={id}
          position={activeSlotPos}
          slot={slotByPosition.get(activeSlotPos) || null}
          dexLabel={dexLabelFor(dexNames, activeSlotPos)}
          onClose={() => setActiveSlotPos(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
