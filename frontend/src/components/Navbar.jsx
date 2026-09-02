import { NavLink } from 'react-router-dom';

export default function Navbar({ totalValue }) {
  return (
    <header className="navbar">
      <div className="navbar-inner">
        <div className="brand">
          <span className="brand-mark">⚡</span>
          <span>Pokémon TCG Tracker</span>
        </div>
        <nav className="nav-links">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            Library
          </NavLink>
          <NavLink to="/collection" className={({ isActive }) => (isActive ? 'active' : '')}>
            My Collection
          </NavLink>
        </nav>
        {totalValue != null && (
          <div className="value-badge">
            <span className="value-badge-label">Collection value</span>
            <span className="value-badge-amount">${totalValue.toFixed(2)}</span>
          </div>
        )}
      </div>
    </header>
  );
}
