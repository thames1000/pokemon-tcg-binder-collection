import { bestPrice } from '../pricing.js';

// onWishlist/onUnwishlist are optional — only Library passes them (a quick
// wishlist toggle without opening the full add-to-collection modal). Other
// consumers of this tile (Price Lookup, Wishlist's own search, binder slot
// search) don't pass them, so no button renders there and nothing else
// changes for them. wishlisted controls which of the two fires: a filled
// star (already on the wishlist) removes immediately on click — nothing to
// fill in, so no need for a modal; an empty star opens onWishlist's add
// modal (target price/notes are worth a form).
export default function CardTile({ card, onOpen, onWishlist, onUnwishlist, wishlisted = false }) {
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
      {(onWishlist || onUnwishlist) && (
        <button
          type="button"
          className={`card-tile-wishlist-btn${wishlisted ? ' card-tile-wishlist-btn-active' : ''}`}
          title={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
          onClick={(e) => {
            e.stopPropagation();
            if (wishlisted) onUnwishlist?.(card);
            else onWishlist?.(card);
          }}
        >
          {wishlisted ? '★' : '☆'}
        </button>
      )}
    </div>
  );
}
