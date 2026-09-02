import { bestPrice } from '../pricing.js';

export default function CardTile({ card, onOpen }) {
  const price = bestPrice(card);
  return (
    <button className="card-tile" onClick={() => onOpen(card)}>
      <div className="card-tile-image-wrap">
        {card.images?.small ? (
          <img src={card.images.small} alt={card.name} loading="lazy" />
        ) : (
          <div className="card-tile-placeholder">No image</div>
        )}
      </div>
      <div className="card-tile-body">
        <div className="card-tile-name">{card.name}</div>
        <div className="card-tile-meta">
          {card.set?.name} · #{card.number}
        </div>
        {price && (
          <div className="card-tile-price">
            {price.currency === 'USD' ? '$' : '€'}
            {price.amount.toFixed(2)}
          </div>
        )}
      </div>
    </button>
  );
}
