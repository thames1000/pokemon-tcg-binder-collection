import { NavLink } from 'react-router-dom';
import { api } from '../api.js';

async function changePassword() {
  const currentPassword = window.prompt('Current password:');
  if (currentPassword == null) return;
  const newPassword = window.prompt('New password (8+ characters):');
  if (newPassword == null) return;
  if (newPassword.length < 8) return window.alert('Password must be at least 8 characters; nothing was changed.');
  const again = window.prompt('Repeat the new password:');
  if (again == null) return;
  if (again !== newPassword) return window.alert('The passwords did not match; nothing was changed.');
  try {
    await api.auth.changePassword(currentPassword, newPassword);
    window.alert('Password changed. Other signed-in devices were signed out.');
  } catch (e) {
    window.alert(e.message);
  }
}

export default function Navbar({ totalValue, user, onLogout }) {
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
          <NavLink to="/price-lookup" className={({ isActive }) => (isActive ? 'active' : '')}>
            Price Lookup
          </NavLink>
          <NavLink to="/analytics" className={({ isActive }) => (isActive ? 'active' : '')}>
            Analytics
          </NavLink>
          <NavLink to="/wishlist" className={({ isActive }) => (isActive ? 'active' : '')}>
            Wishlist
          </NavLink>
          <NavLink to="/binders" className={({ isActive }) => (isActive ? 'active' : '')}>
            Binders
          </NavLink>
          <NavLink to="/simulator" className={({ isActive }) => (isActive ? 'active' : '')}>
            Pack Simulator
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>
              Users
            </NavLink>
          )}
        </nav>
        {totalValue != null && (
          <div className="value-badge">
            <span className="value-badge-label">Collection value</span>
            <span className="value-badge-amount">${totalValue.toFixed(2)}</span>
          </div>
        )}
        {user && (
          <div className="user-badge">
            <span>
              {user.username}
              {user.role === 'admin' && <small> · admin</small>}
            </span>
            <button type="button" onClick={changePassword}>Password</button>
            <button type="button" onClick={onLogout}>Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}
