import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

// Cookie-session authentication with two roles, backed by the same SQLite
// file as everything else. Passwords use Node's built-in scrypt (no native or
// third-party dependency); sessions are random tokens stored hashed, so a
// database leak does not leak usable cookies.
//
// This layer protects ACCESS to the app. Collection, wishlist, binders and
// simulator data remain shared between all signed-in users — roles gate what
// actions are allowed, they do not partition the data.

export const COOKIE_NAME = 'tcg_session';
export const ROLES = ['admin', 'user'];
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const LOCK_AFTER_FAILURES = 5;
const LOCK_MS = 30_000;
// Beyond per-username locks, a global brake: scrypt costs real CPU per attempt
// (deliberately), so past this many failures across ALL usernames in the lock
// window, refuse logins before hashing. Stops both password spraying across
// rotated usernames and using the login endpoint as a CPU-burn target.
const GLOBAL_MAX_FAILURES = 20;

export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, N, r, p, saltHex, hashHex] = String(stored || '').split(':');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashHex || '', 'hex');
  if (!expected.length) return false;
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(actual, expected);
}

const tokenHash = token => createHash('sha256').update(token).digest('hex');

export function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const raw = part.slice(eq + 1).trim();
    // Another app on the same host can set a cookie with a bare '%', which
    // makes decodeURIComponent throw — keep the raw value instead of letting
    // a cookie we don't own 500 every request.
    let value;
    try { value = decodeURIComponent(raw); } catch { value = raw; }
    cookies[part.slice(0, eq).trim()] = value;
  }
  return cookies;
}

function validUsername(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_-]{3,40}$/.test(name);
}
function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    fail('Password must be 8–200 characters');
  }
}

export function createAuth(db, { now = () => new Date() } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','user')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
  `);
  // Expired sessions are otherwise only deleted lazily when their own token is
  // presented; sweep them at startup so the table cannot grow without bound.
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now().toISOString());
  // In-memory login throttle: after repeated failures for a username, refuse
  // further attempts briefly. Resets on success or process restart — a brake
  // on online guessing, not a ban system. Stale entries are pruned on every
  // failure so unauthenticated traffic cannot grow the map without bound.
  const failures = new Map();
  let recentFailures = [];
  function noteFailure(lockKey, previous) {
    const nowMs = Date.now();
    recentFailures.push(nowMs);
    for (const [k, v] of failures) if (v.at < nowMs - LOCK_MS && v.until < nowMs) failures.delete(k);
    const fails = (previous?.fails || 0) + 1;
    failures.set(lockKey, { fails, at: nowMs, until: fails >= LOCK_AFTER_FAILURES ? nowMs + LOCK_MS : 0 });
  }
  const publicUser = row => row && { id: row.id, username: row.username, role: row.role };

  function needsSetup() {
    return !db.prepare('SELECT 1 FROM users LIMIT 1').get();
  }
  function setupAdmin({ username, password }) {
    if (!validUsername(username)) fail('Username must be 3–40 letters, digits, - or _');
    checkPassword(password);
    // Check-and-insert in one transaction so two simultaneous first-run posts
    // cannot both become "the first" admin.
    return db.transaction(() => {
      if (!needsSetup()) fail('Setup is already complete', 409);
      const info = db.prepare('INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)')
        .run(username, hashPassword(password), 'admin', now().toISOString());
      return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid));
    })();
  }
  function authenticate(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string') fail('Username and password are required', 401);
    const lockKey = username.toLowerCase();
    const state = failures.get(lockKey);
    if (state?.until > Date.now()) fail('Too many failed attempts; wait 30 seconds', 429);
    // Both checks run BEFORE any hashing, so a refused attempt costs no CPU.
    recentFailures = recentFailures.filter(t => t > Date.now() - LOCK_MS);
    if (recentFailures.length >= GLOBAL_MAX_FAILURES) fail('Too many failed sign-in attempts; try again shortly', 429);
    const row = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    // Hash even for unknown users so response timing doesn't reveal which
    // usernames exist.
    const ok = row ? verifyPassword(password, row.password_hash) : (hashPassword(password), false);
    if (!ok) {
      noteFailure(lockKey, state);
      fail('Incorrect username or password', 401);
    }
    failures.delete(lockKey);
    return publicUser(row);
  }
  function createSession(userId) {
    const token = randomBytes(32).toString('base64url');
    const created = now();
    const expires = new Date(+created + SESSION_DAYS * 86400000);
    db.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
      .run(tokenHash(token), userId, created.toISOString(), expires.toISOString());
    return { token, maxAgeMs: SESSION_DAYS * 86400000 };
  }
  function sessionUser(token) {
    if (typeof token !== 'string' || !token) return null;
    const row = db.prepare(`
      SELECT u.*, s.expires_at FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash=?
    `).get(tokenHash(token));
    if (!row) return null;
    if (row.expires_at <= now().toISOString()) {
      db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(tokenHash(token));
      return null;
    }
    return publicUser(row);
  }
  function destroySession(token) {
    if (typeof token === 'string' && token) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(tokenHash(token));
  }
  function listUsers() {
    return db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username').all();
  }
  function createUser({ username, password, role }) {
    if (!validUsername(username)) fail('Username must be 3–40 letters, digits, - or _');
    checkPassword(password);
    if (!ROLES.includes(role)) fail('Role must be admin or user');
    const hash = hashPassword(password);
    return db.transaction(() => {
      if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) fail('That username is taken', 409);
      const info = db.prepare('INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)')
        .run(username, hash, role, now().toISOString());
      return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid));
    })();
  }
  // Self-service: anyone can change their own password by proving the current
  // one; every session (including the caller's) is revoked, so the route
  // issues a fresh one.
  function changePassword(userId, currentPassword, newPassword) {
    checkPassword(newPassword);
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(userId) || fail('User not found', 404);
    if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, row.password_hash)) {
      fail('Current password is incorrect', 403);
    }
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(newPassword), userId);
      db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(userId);
    })();
    return publicUser(row);
  }
  function updateUser(id, { role, password }, actingUserId) {
    return db.transaction(() => updateUserInner(id, { role, password }, actingUserId))();
  }
  function updateUserInner(id, { role, password }, actingUserId) {
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(id) || fail('User not found', 404);
    if (role !== undefined) {
      if (!ROLES.includes(role)) fail('Role must be admin or user');
      if (target.role === 'admin' && role !== 'admin' && !otherAdminExists(id)) fail('There must always be at least one admin', 409);
      if (target.id === actingUserId && role !== 'admin') fail('You cannot remove your own admin role', 409);
      db.prepare('UPDATE users SET role=? WHERE id=?').run(role, id);
    }
    if (password !== undefined) {
      checkPassword(password);
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), id);
      // A password reset signs that user out everywhere.
      db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(id);
    }
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  }
  function deleteUser(id, actingUserId) {
    return db.transaction(() => {
      const target = db.prepare('SELECT * FROM users WHERE id=?').get(id) || fail('User not found', 404);
      if (target.id === actingUserId) fail('You cannot delete your own account', 409);
      if (target.role === 'admin' && !otherAdminExists(id)) fail('There must always be at least one admin', 409);
      db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(id);
      db.prepare('DELETE FROM users WHERE id=?').run(id);
      return { deleted: target.id };
    })();
  }
  function otherAdminExists(exceptId) {
    return !!db.prepare("SELECT 1 FROM users WHERE role='admin' AND id != ? LIMIT 1").get(exceptId);
  }
  return { needsSetup, setupAdmin, authenticate, createSession, sessionUser, destroySession, listUsers, createUser, changePassword, updateUser, deleteUser };
}

// Express middleware for an auth instance, defined here (db-free callers can
// test the actual enforcement against an in-memory database).
export function createMiddleware(auth) {
  function requireAuth(req, res, next) {
    const user = auth.sessionUser(parseCookies(req.headers.cookie)[COOKIE_NAME]);
    if (!user) return res.status(401).json({ error: 'Sign in to continue' });
    req.user = user;
    next();
  }
  // Reads req.user, so it fails closed (403) even if it is ever reached
  // without requireAuth having run first.
  function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  }
  return { requireAuth, requireAdmin };
}
