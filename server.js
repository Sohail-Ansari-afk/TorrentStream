require('dotenv').config();
const express = require('express');
const cors = require('cors');
const https = require('https');
const catalog = require('./src/catalog');
const streams = require('./src/streams');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

// ─── Manifest ───────────────────────────────────────────
app.get('/manifest.json', (req, res) => {
  res.json({
    id: 'com.torrentstream.addon',
    version: '2.0.0',
    name: 'TorrentStream',
    description: 'Stream Movies, TV Shows & Anime via Torrents',
    types: ['movie', 'series', 'anime'],
    catalogs: [
      {
        type: 'movie',
        id: 'ts_movies_popular',
        name: 'TorrentStream Movies',
        extra: [{ name: 'search', isRequired: false }]
      },
      {
        type: 'series',
        id: 'ts_series_popular',
        name: 'TorrentStream TV Shows',
        extra: [{ name: 'search', isRequired: false }]
      },
      {
        type: 'anime',
        id: 'ts_anime_popular',
        name: 'TorrentStream Anime',
        extra: [{ name: 'search', isRequired: false }]
      }
    ],
    resources: ['catalog', 'stream', 'meta'],
    idPrefixes: ['tt', 'kitsu']
  });
});

// ─── Catalog Routes ──────────────────────────────────────
app.get('/catalog/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    const search = req.query.search || '';
    const result = await catalog.getCatalog(type, id, search);
    res.json(result);
  } catch (err) {
    console.error('Catalog error:', err.message);
    res.json({ metas: [] });
  }
});

// ─── Meta Route ──────────────────────────────────────────
app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    const result = await catalog.getMeta(type, id);
    res.json(result);
  } catch (err) {
    console.error('Meta error:', err.message);
    res.json({ meta: {} });
  }
});

// ─── Stream Route ────────────────────────────────────────
app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    const result = await streams.getStreams(type, id);
    res.json(result);
  } catch (err) {
    console.error('Stream error:', err.message);
    res.json({ streams: [] });
  }
});

// ─── Health Check ────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), version: '2.0.0' });
});

// ─── Start Server ────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ TorrentStream v2 running on ${SERVER_URL}`);
  console.log(`📋 Manifest: ${SERVER_URL}/manifest.json`);
});

// ─── Keep-Alive Ping (prevents Render free tier from sleeping) ───
if (SERVER_URL && SERVER_URL.startsWith('https')) {
  setInterval(() => {
    https.get(`${SERVER_URL}/health`, (res) => {
      console.log(`💓 Keep-alive ping OK (${res.statusCode})`);
    }).on('error', (err) => {
      console.log(`💔 Ping error: ${err.message}`);
    });
  }, 840000); // Every 14 minutes (Render sleeps at 15 min)
  console.log('🔄 Keep-alive ping enabled');
}
