require('dotenv').config();
const express = require('express');
const cors = require('cors');
const catalog = require('./src/catalog');
const streams = require('./src/streams');
const torrent = require('./src/torrent');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ─── Manifest ───────────────────────────────────────────
app.get('/manifest.json', (req, res) => {
  res.json({
    id: 'com.torrentstream.aniyomi',
    version: '1.0.0',
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

// ─── Torrent Proxy (converts magnet to HTTP stream) ──────
app.get('/torrentstream/:infoHash/:fileIndex', async (req, res) => {
  try {
    const { infoHash, fileIndex } = req.params;
    await torrent.streamTorrent(infoHash, parseInt(fileIndex), req, res);
  } catch (err) {
    console.error('Torrent stream error:', err.message);
    res.status(500).send('Stream failed');
  }
});

app.listen(PORT, () => {
  console.log(`TorrentStream running on http://localhost:${PORT}`);
  console.log(`Manifest: http://localhost:${PORT}/manifest.json`);
});
