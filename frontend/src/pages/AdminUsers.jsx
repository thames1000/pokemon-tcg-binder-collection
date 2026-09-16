import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

// Admin-only user management. Roles gate actions; all signed-in users still
// share the same collection and simulator data.
export default function AdminUsers({ user }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');

  const load = useCallback(() => {
    api.auth.listUsers().then(setUsers).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function run(action, message) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      load();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>Users</h1>
      <p className="page-subtitle">
        Everyone here shares the same collection, binders and simulator. Admins can
        manage accounts and grant simulator credits for testing.
      </p>
      {error && <p className="error-text" role="alert">{error}</p>}
      {notice && <p className="sim-notice" role="status">{notice}</p>}

      <form
        className="search-bar"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(
            () => api.auth.createUser({ username: newUsername, password: newPassword, role: newRole }),
            `Created ${newUsername}.`
          );
          if (ok) {
            setNewUsername('');
            setNewPassword('');
            setNewRole('user');
          }
        }}
      >
        <input aria-label="New username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="Username" required minLength={3} maxLength={40} />
        <input aria-label="New user password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Password (8+ characters)" required minLength={8} maxLength={200} autoComplete="new-password" />
        <select aria-label="New user role" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
          <option value="user">Regular user</option>
          <option value="admin">Admin</option>
        </select>
        <button disabled={busy}>Add user</button>
      </form>

      {!users ? (
        <p role="status">Loading users…</p>
      ) : (
        <div className="admin-users">
          {users.map((u) => (
            <div className="admin-user-row" key={u.id}>
              <div>
                <strong>{u.username}</strong>
                {u.id === user.id && <span className="sim-chip">You</span>}
                <small className="muted"> · joined {new Date(u.created_at).toLocaleDateString()}</small>
              </div>
              <div className="sim-actions">
                <label>
                  Role
                  <select
                    value={u.role}
                    disabled={busy}
                    onChange={(e) => run(() => api.auth.updateUser(u.id, { role: e.target.value }), `${u.username} is now ${e.target.value === 'admin' ? 'an admin' : 'a regular user'}.`)}
                  >
                    <option value="user">Regular user</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <button
                  disabled={busy}
                  onClick={() => {
                    const password = window.prompt(`New password for ${u.username} (8+ characters). They will be signed out everywhere.`);
                    if (password == null) return;
                    if (password.length < 8) { setError('Password must be at least 8 characters; nothing was changed.'); return; }
                    if (window.confirm(`Set this as ${u.username}'s new password and sign them out everywhere?`)) {
                      run(() => api.auth.updateUser(u.id, { password }), `Password reset for ${u.username}.`);
                    }
                  }}
                >
                  Reset password
                </button>
                <button
                  disabled={busy || u.id === user.id}
                  onClick={() => {
                    if (window.confirm(`Delete ${u.username}? Their sign-in goes away; the shared collection is untouched.`)) {
                      run(() => api.auth.deleteUser(u.id), `Deleted ${u.username}.`);
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
