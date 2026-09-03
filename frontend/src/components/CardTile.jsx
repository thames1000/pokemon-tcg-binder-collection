import { bestPrice } from '../pricing.js';

// onWishlist is optional — only Library passes it (a quick "add to wishlist"
// without opening the full add-to-collection modal). Other consumers of this
// tile (Price Lookup, Wishlist's own search, binder slot search) don't pass
// it, so no button renders there and nothing else changes for them.
export default function CardTile({ card, onOpen, onWishlist }) {
  const price = bestPrice(card);
  return (
    <div className="card-tile">
      <button type="button" className="card-tile-open" onClick={() => onOpen(card)}>
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
      {onWishlist && (
        <button
          type="button"
          className="card-tile-wishlist-btn"
          title="Add to wishlist"
          onClick={(e) => {
            e.stopPropagation();
            onWishlist(card);
          }}
        >
          ☆
        </button>
      )}
    </div>
  );
}
