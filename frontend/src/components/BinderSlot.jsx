export default function BinderSlot({ slot, onClick }) {
  const card = slot?.card;
  return (
    <button type="button" className={`binder-slot ${card ? 'binder-slot-filled' : 'binder-slot-empty'}`} onClick={onClick}>
      {card ? (
        <>
          <img src={card.images?.small} alt={card.name} className="binder-slot-image" />
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
