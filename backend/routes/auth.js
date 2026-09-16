import { Router } from 'express';
import db from '../db.js';
import { createAuth, createMiddleware, parseCookies, COOKIE_NAME } from '../auth.js';

const auth = createAuth(db);
export const { requireAuth, requireAdmin } = createMiddleware(auth);
const router = Router();

// Set COOKIE_SECURE=1 when serving over HTTPS so browsers refuse to send the
// session cookie over plain HTTP. Left off by default for localhost/LAN use.
const cookieOptions = { httpOnly: true, sameSite: 'lax', path: '/', secure: !!process.env.COOKIE_SECURE };

function route(fn) {
  return (req, res) => {
    try { res.json(fn(req, res)); }
    catch (error) {
      // Only intentional fail(...) messages reach the client; anything
      // unexpected (constraint races, crypto errors) is logged, not leaked.
      if (!error.status) console.error(error);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Internal server error' });
    }
  };
}
function currentUser(req) {
  return auth.sessionUser(parseCookies(req.headers.cookie)[COOKIE_NAME]);
}
function startSession(res, user) {
  const session = auth.createSession(user.id);
  res.cookie(COOKIE_NAME, session.token, { ...cookieOptions, maxAge: session.maxAgeMs });
  return { user };
}

router.get('/me', route(req => ({ user: currentUser(req), needsSetup: auth.needsSetup() })));
// First run only: whoever sets up the instance becomes its admin.
router.post('/setup', route((req, res) => startSession(res, auth.setupAdmin(req.body))));
router.post('/login', route((req, res) => startSession(res, auth.authenticate(req.body.username, req.body.password))));
// Change your own password by proving the current one. All sessions are
// revoked and a fresh one is issued for this browser.
router.post('/password', requireAuth, route((req, res) => {
  return startSession(res, auth.changePassword(req.user.id, req.body.currentPassword, req.body.newPassword));
}));
router.post('/logout', route((req, res) => {
  auth.destroySession(parseCookies(req.headers.cookie)[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME, cookieOptions);
  return { ok: true };
}));

router.get('/users', requireAuth, requireAdmin, route(() => auth.listUsers()));
router.post('/users', requireAuth, requireAdmin, route(req => auth.createUser(req.body)));
router.patch('/users/:id', requireAuth, requireAdmin, route(req => auth.updateUser(Number(req.params.id), req.body, req.user.id)));
router.delete('/users/:id', requireAuth, requireAdmin, route(req => auth.deleteUser(Number(req.params.id), req.user.id)));

export default router;
