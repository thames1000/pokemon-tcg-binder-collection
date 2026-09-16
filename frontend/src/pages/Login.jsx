import { useState } from 'react';
import { api } from '../api.js';

// Shown whenever there is no signed-in session. On a brand-new install
// (no users yet) it creates the first account, which becomes the admin.
export default function Login({ needsSetup, onAuthed }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = needsSetup ? await api.auth.setup(username, password) : await api.auth.login(username, password);
      onAuthed(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <span className="brand-mark" aria-hidden="true">⚡</span>
        <h1>Pokémon TCG Tracker</h1>
        {needsSetup ? (
          <p className="muted">
            Welcome! Create the first account for this tracker. It becomes the
            administrator, and can invite everyone else.
          </p>
        ) : (
          <p className="muted">Sign in to your tracker.</p>
        )}
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={40} autoFocus />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={needsSetup ? 'new-password' : 'current-password'} required minLength={8} maxLength={200} />
        </label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn-primary" disabled={busy}>
          {busy ? 'One moment…' : needsSetup ? 'Create admin account' : 'Sign in'}
        </button>
        {needsSetup && <small className="muted">Passwords need at least 8 characters.</small>}
      </form>
    </div>
  );
}
