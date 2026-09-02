import { useState } from 'react';
import CardPriceTable from './CardPriceTable.jsx';
import AddToCollectionForm from './AddToCollectionForm.jsx';

export default function PriceLookupModal({ card: initialCard, onClose, onAdded }) {
  const [card, setCard] = useState(initialCard);
  const [showAddForm, setShowAddForm] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

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

            {justAdded ? (
              <p className="success-text">Added to your collection.</p>
            ) : showAddForm ? (
              <AddToCollectionForm
                card={card}
                onAdded={() => {
                  onAdded?.();
                  setJustAdded(true);
                }}
              />
            ) : (
              <button type="button" className="btn-primary" onClick={() => setShowAddForm(true)}>
                + Add to Collection
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
