const BASE = '/api';

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  searchCards: ({ name, set, sortBy, page = 1, pageSize = 32 }) => {
    const params = new URLSearchParams();
    if (name) params.set('name', name);
    if (set) params.set('set', set);
    if (sortBy) params.set('sortBy', sortBy);
    params.set('page', page);
    params.set('pageSize', pageSize);
    return request(`/cards/search?${params.toString()}`);
  },
  getCard: (id) => request(`/cards/${id}`),
  refreshCardPrice: (id) => request(`/cards/${id}?force=true`),
  getSets: () => request('/cards/sets'),
  getCardSyncStatus: () => request('/cards/sync-status'),

  getCollection: () => request('/collection'),
  getCollectionValue: () => request('/collection/value'),
  getCollectionAnalytics: () => request('/collection/analytics'),
  addToCollection: (payload) =>
    request('/collection', { method: 'POST', body: JSON.stringify(payload) }),
  updateCollectionItem: (id, payload) =>
    request(`/collection/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  removeFromCollection: (id) => request(`/collection/${id}`, { method: 'DELETE' }),

  async exportCollectionCsv() {
    const res = await fetch(`${BASE}/collection/export`);
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.blob();
  },
  importCollectionCsv: (csvText) =>
    request('/collection/import', { method: 'POST', body: JSON.stringify({ csv: csvText }) }),

  getWishlist: () => request('/wishlist'),
  addToWishlist: (payload) => request('/wishlist', { method: 'POST', body: JSON.stringify(payload) }),
  updateWishlistItem: (id, payload) =>
    request(`/wishlist/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  removeFromWishlist: (id) => request(`/wishlist/${id}`, { method: 'DELETE' }),

  getBinders: () => request('/binders'),
  getBinder: (id) => request(`/binders/${id}`),
  getBinderSetPreview: (setId) => request(`/binders/set-preview?setId=${encodeURIComponent(setId)}`),
  getBinderPokemonPreview: (name) => request(`/binders/pokemon-preview?name=${encodeURIComponent(name)}`),
  getNationalDex: () => request('/binders/national-dex'),
  searchCollectionByName: (name) => request(`/collection/search?name=${encodeURIComponent(name)}`),
  createBinder: (payload) => request('/binders', { method: 'POST', body: JSON.stringify(payload) }),
  updateBinder: (id, payload) => request(`/binders/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteBinder: (id) => request(`/binders/${id}`, { method: 'DELETE' }),
  setBinderSlot: (binderId, position, payload) =>
    request(`/binders/${binderId}/slots/${position}`, { method: 'PUT', body: JSON.stringify(payload) }),
  clearBinderSlot: (binderId, position) =>
    request(`/binders/${binderId}/slots/${position}`, { method: 'DELETE' }),
};
