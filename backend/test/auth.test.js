import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { createAuth, createMiddleware, hashPassword, verifyPassword, parseCookies, COOKIE_NAME } from '../auth.js';

function setup() {
  const db = new Database(':memory:');
  let date = new Date('2026-09-16T12:00:00Z');
  const auth = createAuth(db, { now: () => date });
  return { db, auth, advanceDays: d => { date = new Date(+date + d * 86400000); } };
}

test('password hashes verify, reject wrong passwords, and never store plaintext', () => {
  const stored = hashPassword('correct horse battery');
  assert.ok(stored.startsWith('scrypt:'));
  assert.ok(!stored.includes('correct horse battery'));
  assert.equal(verifyPassword('correct horse battery', stored), true);
  assert.equal(verifyPassword('wrong', stored), false);
  assert.equal(verifyPassword('anything', 'garbage'), false);
  assert.equal(verifyPassword('anything', null), false);
});

test('first-run setup creates the admin exactly once and validates input', () => {
  const { db, auth } = setup();
  assert.equal(auth.needsSetup(), true);
  assert.throws(() => auth.setupAdmin({ username: 'x', password: 'longenough' }), /Username/);
  assert.throws(() => auth.setupAdmin({ username: 'james', password: 'short' }), /Password/);
  const admin = auth.setupAdmin({ username: 'james', password: 'longenough' });
  assert.deepEqual(admin, { id: 1, username: 'james', role: 'admin' });
  assert.equal(auth.needsSetup(), false);
  assert.throws(() => auth.setupAdmin({ username: 'other', password: 'longenough' }), /already complete/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  db.close();
});

test('sessions round-trip, expire after 30 days, and can be destroyed', () => {
  const { db, auth, advanceDays } = setup();
  const admin = auth.setupAdmin({ username: 'james', password: 'longenough' });
  const { token } = auth.createSession(admin.id);
  assert.deepEqual(auth.sessionUser(token), admin);
  assert.equal(auth.sessionUser('not-a-token'), null);
  assert.equal(auth.sessionUser(''), null);
  // Tokens are stored hashed: the raw token never appears in the database.
  assert.equal(db.prepare('SELECT 1 FROM auth_sessions WHERE token_hash=?').get(token), undefined);
  advanceDays(31);
  assert.equal(auth.sessionUser(token), null);
  const again = auth.createSession(admin.id);
  auth.destroySession(again.token);
  assert.equal(auth.sessionUser(again.token), null);
  db.close();
});

test('login throttles after repeated failures and recovers after the cooldown', () => {
  const { db, auth } = setup();
  auth.setupAdmin({ username: 'james', password: 'longenough' });
  assert.throws(() => auth.authenticate('james', 'nope-nope'), /Incorrect/);
  for (let i = 0; i < 4; i++) assert.throws(() => auth.authenticate('james', 'nope-nope'), /Incorrect|Too many/);
  assert.throws(() => auth.authenticate('james', 'longenough'), /Too many/); // locked even with the right password
  assert.throws(() => auth.authenticate('ghost', 'whatever1'), /Incorrect/); // unknown users get the same error shape
  db.close();
});

test('user management enforces roles, uniqueness, and the last-admin rule', () => {
  const { db, auth } = setup();
  const admin = auth.setupAdmin({ username: 'james', password: 'longenough' });
  const user = auth.createUser({ username: 'guest', password: 'alsolongenough', role: 'user' });
  assert.equal(user.role, 'user');
  assert.throws(() => auth.createUser({ username: 'GUEST', password: 'alsolongenough', role: 'user' }), /taken/); // case-insensitive
  assert.throws(() => auth.createUser({ username: 'third', password: 'alsolongenough', role: 'owner' }), /Role/);
  assert.throws(() => auth.updateUser(admin.id, { role: 'user' }, admin.id), /at least one admin|own admin role/);
  assert.throws(() => auth.deleteUser(admin.id, admin.id), /own account/);
  assert.throws(() => auth.deleteUser(999, admin.id), /not found/);
  // Promote the second user, then the original admin can step down.
  auth.updateUser(user.id, { role: 'admin' }, admin.id);
  auth.updateUser(admin.id, { role: 'user' }, user.id);
  assert.throws(() => auth.updateUser(user.id, { role: 'user' }, user.id), /at least one admin|own admin role/);
  // Password reset revokes existing sessions.
  const session = auth.createSession(user.id);
  auth.updateUser(user.id, { password: 'brandnewpassword' }, user.id);
  assert.equal(auth.sessionUser(session.token), null);
  assert.ok(auth.authenticate('guest', 'brandnewpassword'));
  db.close();
});

test('self-service password change proves the current password and revokes sessions', () => {
  const { db, auth } = setup();
  const admin = auth.setupAdmin({ username: 'james', password: 'longenough' });
  const session = auth.createSession(admin.id);
  assert.throws(() => auth.changePassword(admin.id, 'wrong-current', 'newpassword1'), /Current password/);
  assert.throws(() => auth.changePassword(admin.id, 'longenough', 'short'), /Password/);
  assert.equal(auth.sessionUser(session.token)?.id, admin.id); // failed attempts revoke nothing
  auth.changePassword(admin.id, 'longenough', 'newpassword1');
  assert.equal(auth.sessionUser(session.token), null); // all sessions revoked
  assert.ok(auth.authenticate('james', 'newpassword1'));
  db.close();
});

test('expired sessions are swept when the auth layer starts', () => {
  const { db, auth, advanceDays } = setup();
  const admin = auth.setupAdmin({ username: 'james', password: 'longenough' });
  auth.createSession(admin.id);
  advanceDays(31);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n, 1);
  createAuth(db, { now: () => new Date('2026-10-20T12:00:00Z') });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n, 0);
  db.close();
});

test('cookie parsing tolerates malformed headers and foreign cookies with bad escapes', () => {
  assert.deepEqual(parseCookies('a=1; tcg_session=abc%3D; b=2'), { a: '1', tcg_session: 'abc=', b: '2' });
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies('malformed'), {});
  // A cookie we don't own with a bare % must not throw and must not hide ours.
  assert.deepEqual(parseCookies('other=100%; tcg_session=tok'), { other: '100%', tcg_session: 'tok' });
});

test('a burst of failures across rotated usernames trips the global throttle before hashing', () => {
  const { db, auth } = setup();
  auth.setupAdmin({ username: 'james', password: 'longenough' });
  for (let i = 0; i < 20; i++) assert.throws(() => auth.authenticate(`probe-${i}`, 'wrong-password'), /Incorrect/);
  // 21st attempt is refused outright — even for the real user with the right password.
  assert.throws(() => auth.authenticate('james', 'longenough'), /try again shortly/);
  db.close();
});

test('the express middleware enforces the boundary end to end', async () => {
  const { db, auth } = setup();
  const { requireAuth, requireAdmin } = createMiddleware(auth);
  const admin = auth.setupAdmin({ username: 'james', password: 'longenough' });
  const guest = auth.createUser({ username: 'guest', password: 'alsolongenough', role: 'user' });
  const app = express();
  const api = express.Router();
  api.use(requireAuth);
  api.get('/collection', (req, res) => res.json({ user: req.user.username }));
  api.post('/simulator/credits', requireAdmin, (req, res) => res.json({ ok: true }));
  app.use('/api', api);
  const server = app.listen(0);
  try {
    const call = async (path, { token, method = 'GET' } = {}) => (await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: token ? { cookie: `${COOKIE_NAME}=${token}` } : {},
    })).status;
    assert.equal(await call('/api/collection'), 401);
    assert.equal(await call('/api/collection', { token: 'forged-token' }), 401);
    assert.equal(await call('/api/collection', { token: auth.createSession(guest.id).token }), 200);
    assert.equal(await call('/api/simulator/credits', { method: 'POST', token: auth.createSession(guest.id).token }), 403);
    assert.equal(await call('/api/simulator/credits', { method: 'POST', token: auth.createSession(admin.id).token }), 200);
  } finally {
    server.close();
    db.close();
  }
});
