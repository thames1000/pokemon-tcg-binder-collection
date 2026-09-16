import 'dotenv/config';
import express from 'express';
import cardsRouter from './routes/cards.js';
import collectionRouter from './routes/collection.js';
import wishlistRouter from './routes/wishlist.js';
import bindersRouter from './routes/binders.js';
import simulatorRouter from './routes/simulator.js';
import authRouter, { requireAuth } from './routes/auth.js';
import { warmSetsCache } from './pokemonApi.js';

const app = express();
const PORT = process.env.PORT || 3001;

// No CORS middleware on purpose: the app is same-origin (the Vite dev server
// proxies /api). Wildcard CORS was dead weight, and a credentialed CORS config
// would hand cookie-authenticated access to any origin — don't add one.
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
// Every router registered on `protectedApi` requires a signed-in user — new
// routers belong here, where the guard is structural rather than positional.
const protectedApi = express.Router();
protectedApi.use(requireAuth);
protectedApi.use('/cards', cardsRouter);
protectedApi.use('/collection', collectionRouter);
protectedApi.use('/wishlist', wishlistRouter);
protectedApi.use('/binders', bindersRouter);
protectedApi.use('/simulator', simulatorRouter);
app.use('/api', protectedApi);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Loopback by default: /api/auth/setup is public until the first account
// exists, so exposing a fresh instance to a network is an explicit choice
// (HOST=0.0.0.0), made after setup or behind a private network.
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`Pokemon TCG Tracker API listening on http://${HOST}:${PORT}`);
  warmSetsCache();
});
