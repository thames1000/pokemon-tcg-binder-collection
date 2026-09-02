import { useCallback, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Library from './pages/Library.jsx';
import Collection from './pages/Collection.jsx';
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
        </Routes>
      </main>
    </div>
  );
}
