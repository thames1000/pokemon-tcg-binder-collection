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
  searchCards: ({ name, set, page = 1, pageSize = 32 }) => {
    const params = new URLSearchParams();
    if (name) params.set('name', name);
    if (set) params.set('set', set);
    params.set('page', page);
    params.set('pageSize', pageSize);
    return request(`/cards/search?${params.toString()}`);
  },
  getCard: (id) => request(`/cards/${id}`),
  getSets: () => request('/cards/sets'),

  getCollection: () => request('/collection'),
  getCollectionValue: () => request('/collection/value'),
  addToCollection: (payload) =>
    request('/collection', { method: 'POST', body: JSON.stringify(payload) }),
  updateCollectionItem: (id, payload) =>
    request(`/collection/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  removeFromCollection: (id) => request(`/collection/${id}`, { method: 'DELETE' }),
};
