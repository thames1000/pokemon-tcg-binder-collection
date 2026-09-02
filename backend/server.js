import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cardsRouter, { warmSetsCache } from './routes/cards.js';
import collectionRouter from './routes/collection.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/cards', cardsRouter);
app.use('/api/collection', collectionRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Pokemon TCG Tracker API listening on http://localhost:${PORT}`);
  warmSetsCache();
});
