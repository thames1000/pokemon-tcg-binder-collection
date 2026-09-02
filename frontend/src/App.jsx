import { useCallback, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Library from './pages/Library.jsx';
import Collection from './pages/Collection.jsx';
import PriceLookup from './pages/PriceLookup.jsx';
import Analytics from './pages/Analytics.jsx';
import Wishlist from './pages/Wishlist.jsx';
import BinderList from './pages/BinderList.jsx';
import BinderView from './pages/BinderView.jsx';
import { api } from './api.js';

export default function App() {
  const [totalValue, setTotalValue] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshValue = useCallback(() => {
    api
      .getCollectionValue()
      .then((v) => setTotalValue(v.totalValue))
      .catch(() => {});
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    refreshValue();
  }, [refreshValue]);

  return (
    <div className="app">
      <Navbar totalValue={totalValue} />
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
        </Routes>
      </main>
    </div>
  );
}
