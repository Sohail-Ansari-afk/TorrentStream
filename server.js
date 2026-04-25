require('dotenv').config();
const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const WebTorrent = require('webtorrent');
const catalog = require('./src/catalog');
const streams = require('./src/streams');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
const START_TIME = Date.now();

// ─── WebTorrent client (shared across requests) ───────────
const wtClient = new WebTorrent();
const activeTorrents = new Map(); // infoHash → torrent

wtClient.on('error', err => console.error('[WEBTORRENT] Client error:', err.message));
console.log('[WEBTORRENT] Client ready');

// ─── Manifest ─────────────────────────────────────────────
app.get('/manifest.json', (req, res) => {
  res.json({
    id: 'com.torrentstream.addon',
    version: '3.0.0',
    name: 'TorrentStream',
    description: 'Stream Movies, TV Shows & Anime via Torrents',
    types: ['movie', 'series', 'anime'],
    catalogs: [
      { type: 'movie',  id: 'ts_movies_popular', name: 'TorrentStream Movies',  extra: [{ name: 'search', isRequired: false }] },
      { type: 'series', id: 'ts_series_popular', name: 'TorrentStream TV Shows', extra: [{ name: 'search', isRequired: false }] },
      { type: 'anime',  id: 'ts_anime_popular',  name: 'TorrentStream Anime',   extra: [{ name: 'search', isRequired: false }] },
    ],
    resources: ['catalog', 'stream', 'meta'],
    idPrefixes: ['tt', 'kitsu']
  });
});

// ─── Catalog ──────────────────────────────────────────────
app.get('/catalog/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    const search = req.query.search || '';
    res.json(await catalog.getCatalog(type, id, search));
  } catch (err) {
    console.error('[CATALOG]', err.message);
    res.json({ metas: [] });
  }
});

// ─── Meta ─────────────────────────────────────────────────
app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    res.json(await catalog.getMeta(type, id));
  } catch (err) {
    console.error('[META]', err.message);
    res.json({ meta: {} });
  }
});

// ─── Stream ───────────────────────────────────────────────
app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    res.json(await streams.getStreams(type, id));
  } catch (err) {
    console.error('[STREAM]', err.message);
    res.json({ streams: [] });
  }
});

// ─── Torrent → HTTP Proxy ──────────────────────────────────
// Called by Aniyomi when it needs to play an infoHash stream
app.get('/proxy/:infoHash/:fileIdx', (req, res) => {
  const { infoHash, fileIdx } = req.params;
  const fileIndex = parseInt(fileIdx) || 0;
  const magnetUri = streams.buildMagnet(infoHash, '');

  console.log(`[PROXY] Request: ${infoHash} file#${fileIndex}`);

  // Reuse torrent if already loaded
  if (activeTorrents.has(infoHash)) {
    console.log(`[PROXY] Reusing existing torrent ${infoHash}`);
    return serveFile(activeTorrents.get(infoHash), fileIndex, req, res);
  }

  // Add the torrent, set 30s timeout
  const timeout = setTimeout(() => {
    if (!activeTorrents.has(infoHash)) {
      console.log(`[PROXY] Timeout for ${infoHash}`);
      if (!res.headersSent) res.status(504).send('Torrent load timeout');
    }
  }, 30000);

  console.log(`[PROXY] Adding torrent: ${infoHash}`);
  wtClient.add(magnetUri, { path: './downloads', strategy: 'sequential' }, (torrent) => {
    clearTimeout(timeout);
    activeTorrents.set(infoHash, torrent);
    console.log(`[PROXY] Torrent ready: ${torrent.name} | Files: ${torrent.files.length}`);

    torrent.on('error', err => {
      console.error(`[PROXY] Torrent error: ${err.message}`);
      activeTorrents.delete(infoHash);
    });

    serveFile(torrent, fileIndex, req, res);
  });

  // Handle duplicate request before torrent loads
  wtClient.on('torrent', (t) => {
    if (t.infoHash === infoHash) clearTimeout(timeout);
  });
});

// ─── Serve a torrent file with range support ───────────────
function serveFile(torrent, fileIndex, req, res) {
  // Pick largest video file if index not found
  let file = torrent.files[fileIndex];
  if (!file) {
    const videoExts = /\.(mp4|mkv|avi|mov|webm|m4v|ts)$/i;
    const videoFiles = torrent.files.filter(f => videoExts.test(f.name));
    file = videoFiles.sort((a, b) => b.length - a.length)[0] || torrent.files[0];
    console.log(`[PROXY] Using file: ${file?.name}`);
  }

  if (!file) {
    return res.status(404).send('No video file found in torrent');
  }

  const fileSize = file.length;
  const range = req.headers.range;
  const ext = file.name.split('.').pop().toLowerCase();
  const mime = {
    mp4: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
    webm: 'video/webm', mov: 'video/quicktime', ts: 'video/mp2t'
  }[ext] || 'video/mp4';

  console.log(`[PROXY] Serving: ${file.name} | Size: ${(fileSize/1e9).toFixed(2)}GB | Range: ${range || 'none'}`);

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : Math.min(start + 10 * 1024 * 1024, fileSize - 1);
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mime,
    });

    const stream = file.createReadStream({ start, end });
    stream.pipe(res);
    stream.on('error', err => console.error('[PROXY] Stream error:', err.message));
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
    });
    const stream = file.createReadStream();
    stream.pipe(res);
    stream.on('error', err => console.error('[PROXY] Stream error:', err.message));
  }
}

// ─── Health Check ─────────────────────────────────────────
app.get('/health', (req, res) => {
  const uptimeSecs = Math.floor((Date.now() - START_TIME) / 1000);
  res.json({
    status: 'ok',
    version: '3.0.0',
    uptime: `${Math.floor(uptimeSecs/3600)}h ${Math.floor((uptimeSecs%3600)/60)}m ${uptimeSecs%60}s`,
    memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    activeTorrents: activeTorrents.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => res.redirect('/manifest.json'));

// ─── Start ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ TorrentStream v3 running on ${SERVER_URL}`);
  console.log(`📋 Manifest: ${SERVER_URL}/manifest.json`);
  console.log(`🔀 Proxy:    ${SERVER_URL}/proxy/:infoHash/:fileIdx`);
  console.log(`💊 Health:   ${SERVER_URL}/health`);

  if (SERVER_URL.startsWith('https')) startKeepAlive(SERVER_URL);
  else console.log('🔕 Keep-alive disabled (local)');
});

// Cleanup stale torrents every hour
setInterval(() => {
  console.log(`[CLEANUP] Active torrents: ${activeTorrents.size}`);
}, 3600000);

// ─── Keep-Alive ───────────────────────────────────────────
function startKeepAlive(url) {
  const doPing = (n) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(`${url}/health`, res => {
      console.log(`💓 Keep-alive #${n} — HTTP ${res.statusCode}`);
    });
    req.on('error', err => console.log(`💔 Keep-alive #${n} failed: ${err.message}`));
    req.setTimeout(15000, () => { req.destroy(); });
  };
  let n = 0;
  setTimeout(() => { doPing(++n); setInterval(() => doPing(++n), 14*60*1000); }, 60000);
  console.log('🔄 Keep-alive enabled (every 14 min)');
}
