export default function BinderSlot({ slot, onClick }) {
  const card = slot?.card;
  const filledClass = card ? (slot.owned ? 'binder-slot-filled binder-slot-owned-yes' : 'binder-slot-filled binder-slot-owned-no') : 'binder-slot-empty';
  return (
    <button type="button" className={`binder-slot ${filledClass}`} onClick={onClick}>
      {card ? (
        <>
          <img src={card.images?.small} alt={card.name} className="binder-slot-image" loading="lazy" />
          {slot.variant && <span className="binder-slot-variant">{slot.variant === 'Reverse Holofoil' ? 'RH' : slot.variant}</span>}
          {slot.owned && (
            <span className="binder-slot-owned" title="In your collection">
              ✓
            </span>
          )}
        </>
      ) : (
        <span className="binder-slot-plus">+</span>
      )}
    </button>
  );
}
