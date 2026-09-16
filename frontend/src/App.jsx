import { useCallback, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Library from './pages/Library.jsx';
import Collection from './pages/Collection.jsx';
import PriceLookup from './pages/PriceLookup.jsx';
import Analytics from './pages/Analytics.jsx';
import Wishlist from './pages/Wishlist.jsx';
import BinderList from './pages/BinderList.jsx';
import BinderView from './pages/BinderView.jsx';
import Simulator from './pages/Simulator.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import Login from './pages/Login.jsx';
import { api, onUnauthorized } from './api.js';

export default function App() {
  // undefined = still checking the session, null = signed out.
  const [user, setUser] = useState(undefined);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [totalValue, setTotalValue] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    // Any later 401 (expired session, admin reset, deleted account) drops the
    // app back to the login screen instead of every page erroring in place.
    onUnauthorized(() => setUser((current) => (current === undefined ? current : null)));
    api.auth
      .me()
      .then((r) => {
        setUser(r.user);
        setNeedsSetup(r.needsSetup);
      })
      .catch(() => setUser(null));
  }, []);

  const refreshValue = useCallback(() => {
    api
      .getCollectionValue()
      .then((v) => setTotalValue(v.totalValue))
      .catch(() => {});
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (user) refreshValue();
  }, [user, refreshValue]);

  async function logout() {
    try {
      await api.auth.logout();
    } catch {
      /* the session cookie is cleared server-side; treat as signed out regardless */
    }
    setUser(null);
    setTotalValue(null);
  }

  if (user === undefined) {
    return (
      <div className="login-page">
        <p role="status">Checking your session…</p>
      </div>
    );
  }
  if (!user) {
    return (
      <Login
        needsSetup={needsSetup}
        onAuthed={(u) => {
          setUser(u);
          setNeedsSetup(false);
        }}
      />
    );
  }

  return (
    <div className="app">
      <Navbar totalValue={totalValue} user={user} onLogout={logout} />
      <main className="main">
        <Routes>
          <Route path="/" element={<Library onCollectionChanged={refreshValue} />} />
          <Route
            path="/collection"
            element={<Collection refreshKey={refreshKey} onCollectionChanged={refreshValue} />}
          />
          <Route path="/price-lookup" element={<PriceLookup onCollectionChanged={refreshValue} />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/wishlist" element={<Wishlist />} />
          <Route path="/binders" element={<BinderList />} />
          <Route path="/binders/:id" element={<BinderView />} />
          <Route path="/simulator" element={<Simulator user={user} />} />
          <Route
            path="/admin"
            element={user.role === 'admin' ? <AdminUsers user={user} /> : <Navigate to="/" replace />}
          />
        </Routes>
      </main>
    </div>
  );
}
