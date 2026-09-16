const BASE = '/api';

// Registered by App: any 401 means the session ended (expiry, admin password
// reset, deleted account) and the shell should fall back to the login screen.
let unauthorizedHandler = null;
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401 && unauthorizedHandler) unauthorizedHandler();
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
  auth: {
    me: () => request('/auth/me'),
    setup: (username, password) => request('/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) }),
    login: (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    logout: () => request('/auth/logout', { method: 'POST' }),
    changePassword: (currentPassword, newPassword) => request('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
    listUsers: () => request('/auth/users'),
    createUser: (payload) => request('/auth/users', { method: 'POST', body: JSON.stringify(payload) }),
    updateUser: (id, payload) => request(`/auth/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    deleteUser: (id) => request(`/auth/users/${id}`, { method: 'DELETE' }),
  },
  simulator: {
    state: () => request('/simulator'),
    grantCredits: (cents, key) => request('/simulator/credits', { method: 'POST', body: JSON.stringify({ cents, key }) }),
    market: (params) => request(`/simulator/market?${new URLSearchParams(params)}`),
    prepare: (setId) => request('/simulator/prepare', { method: 'POST', body: JSON.stringify({ setId }) }),
    buyPack: (setId, expectedCents, key) => request('/simulator/packs/buy', { method: 'POST', body: JSON.stringify({ setId, expectedCents, key }) }),
    openPack: (setId, key) => request('/simulator/packs/open', { method: 'POST', body: JSON.stringify({ setId, key }) }),
    reveal: (id, payload) => request(`/simulator/packs/${id}/reveal`, { method: 'POST', body: JSON.stringify(payload) }),
    daily: (key) => request('/simulator/daily', { method: 'POST', body: JSON.stringify({ key }) }),
    trade: (payload) => request('/simulator/trade', { method: 'POST', body: JSON.stringify(payload) }),
    createBinder: (payload) => request('/simulator/binders', { method: 'POST', body: JSON.stringify(payload) }),
    binder: (id) => request(`/simulator/binders/${id}`),
    place: (id, position, placement) => request(`/simulator/binders/${id}/slots/${position}`, { method: 'PUT', body: JSON.stringify(placement || {}) }),
    deleteBinder: (id) => request(`/simulator/binders/${id}`, { method: 'DELETE' }),
  },
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
  wishlistMissingInBinder: (binderId) => request(`/binders/${binderId}/wishlist-missing`, { method: 'POST' }),
};
