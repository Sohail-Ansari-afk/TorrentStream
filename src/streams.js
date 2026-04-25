const axios = require('axios');

// ─── Providers (tried in order) ───────────────────────────
// Note: jackettio/stremio-jackett require Jackett API key config — skip them
// Torrentio works locally; on Render it 403s → fallback to YTS/EZTV via proxy
const PROVIDERS = [
  { name: 'torrentio', base: 'https://torrentio.strem.fun' },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://app.strem.io',
  'Referer': 'https://app.strem.io/',
};

// Public trackers to attach to magnet links
const TRACKERS = [
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:80',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.leechers-paradise.org:6969',
  'udp://p4p.arenabg.com:1337',
  'udp://tracker.coppersurfer.tk:6969',
  'http://track.one:1234/announce',
  'https://tracker.tamersunion.org:443/announce',
];

// ─── Main Stream Fetcher ──────────────────────────────────
async function getStreams(type, id) {
  const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';

  try {
    // Try each Stremio-compatible provider
    for (const provider of PROVIDERS) {
      try {
        const url = `${provider.base}/stream/${type}/${encodeURIComponent(id)}.json`;
        console.log(`[STREAM] Trying: ${url}`);

        const response = await axios.get(url, { timeout: 15000, headers: HEADERS });
        const raw = response.data.streams || [];

        // Debug: log first 2 raw streams so we can see the format
        if (raw.length > 0) {
          console.log(`[DEBUG] ${provider.name} raw[0]:`, JSON.stringify(raw[0], null, 2));
        }

        if (!raw.length) {
          console.log(`[STREAM] ${provider.name} returned 0 streams`);
          continue;
        }

        console.log(`[STREAM] ✅ Got ${raw.length} streams from ${provider.name}`);

        // Classify streams
        const httpStreams  = raw.filter(s => s.url && (s.url.startsWith('http://') || s.url.startsWith('https://')));
        const hashStreams  = raw.filter(s => s.infoHash || (s.url && s.url.startsWith('magnet:')));

        console.log(`[STREAM] HTTP: ${httpStreams.length} | Hash/Magnet: ${hashStreams.length}`);

        // HTTP streams → play directly in Aniyomi ✅
        if (httpStreams.length > 0) {
          console.log(`[STREAM] Using direct HTTP streams`);
          return { streams: httpStreams.map(s => formatStream(s, id, null)) };
        }

        // infoHash/magnet → convert to our proxy HTTP URL ✅
        if (hashStreams.length > 0) {
          console.log(`[STREAM] Converting ${hashStreams.length} hash streams to proxy URLs`);
          const streams = hashStreams.map(s => {
            const hash = s.infoHash || extractInfoHash(s.url);
            const idx  = s.fileIdx ?? 0;
            if (!hash) return null;
            // Our proxy converts the torrent to a direct HTTP video stream
            const proxyUrl = `${serverUrl}/proxy/${hash}/${idx}`;
            return formatStream(s, id, proxyUrl);
          }).filter(Boolean);
          return { streams };
        }

      } catch (err) {
        console.log(`[STREAM] ❌ ${provider.name} failed: ${err.message}`);
      }
    }

    // All providers blocked → use public APIs
    console.log('[STREAM] All providers blocked, using fallback APIs');
    return getFallback(type, id, serverUrl);

  } catch (err) {
    console.error('[STREAM] Fatal error:', err.message);
    return { streams: [] };
  }
}

// ─── Format a stream object ───────────────────────────────
function formatStream(s, id, overrideUrl) {
  const quality = extractQuality(s.name || s.title || '');
  return {
    name: `TorrentStream\n${quality}`,
    title: formatTitle(s),
    url: overrideUrl || s.url,
    behaviorHints: {
      notWebReady: false,
      bingeGroup: `ts-${s.infoHash || id}`
    }
  };
}

// ─── Fallback: YTS (movies) + EZTV (TV) ──────────────────
async function getFallback(type, id, serverUrl) {
  try {
    if (type === 'movie') return getYTSStreams(id, serverUrl);
    return getEZTVStreams(id, serverUrl);
  } catch (err) {
    return { streams: [] };
  }
}

async function getYTSStreams(id, serverUrl) {
  try {
    const imdbId = id.split(':')[0];
    const url = `https://yts.mx/api/v2/list_movies.json?query_term=${imdbId}&limit=5`;
    console.log(`[YTS] Fetching: ${url}`);

    const response = await axios.get(url, { timeout: 10000, headers: HEADERS });
    const movies = response.data?.data?.movies || [];
    if (!movies.length) { console.log('[YTS] No results'); return { streams: [] }; }

    const streams = [];
    for (const movie of movies) {
      for (const torrent of (movie.torrents || [])) {
        if (!torrent.hash) continue;
        const hash = torrent.hash.toLowerCase();
        streams.push({
          name: `TorrentStream\n${torrent.quality}`,
          title: `YTS · ${torrent.quality} · ${torrent.type} · 🌱 ${torrent.seeds} · 💾 ${torrent.size}`,
          url: `${serverUrl}/proxy/${hash}/0`,
          behaviorHints: { notWebReady: false, bingeGroup: `yts-${hash}` }
        });
      }
    }
    console.log(`[YTS] ${streams.length} streams`);
    return { streams };
  } catch (err) {
    console.error('[YTS] Error:', err.message);
    return { streams: [] };
  }
}

async function getEZTVStreams(id, serverUrl) {
  try {
    const parts  = id.split(':');
    const imdbId = parts[0].replace('tt', '');
    const season  = String(parts[1] || '1').padStart(2, '0');
    const episode = String(parts[2] || '1').padStart(2, '0');

    const url = `https://eztv.re/api/get-torrents?imdb_id=${imdbId}&limit=100`;
    console.log(`[EZTV] Fetching: ${url}`);

    const response = await axios.get(url, { timeout: 10000, headers: HEADERS });
    const torrents = response.data?.torrents || [];

    const filtered = torrents.filter(t => {
      const title = t.title.toLowerCase();
      return title.includes(`s${season}e${episode}`) ||
             title.includes(`${parseInt(season)}x${episode}`);
    });

    const streams = filtered.slice(0, 10).map(t => {
      const hash = extractInfoHash(t.magnet_url);
      return {
        name: `TorrentStream\n${extractQuality(t.title)}`,
        title: `EZTV · S${season}E${episode} · ${extractQuality(t.title)} · 🌱 ${t.seeds}`,
        url: hash ? `${serverUrl}/proxy/${hash}/0` : t.magnet_url,
        behaviorHints: { notWebReady: false, bingeGroup: `eztv-${imdbId}` }
      };
    });

    console.log(`[EZTV] ${streams.length} streams for S${season}E${episode}`);
    return { streams };
  } catch (err) {
    console.error('[EZTV] Error:', err.message);
    return { streams: [] };
  }
}

// ─── Helpers ──────────────────────────────────────────────
function extractInfoHash(input) {
  if (!input) return null;
  if (/^[a-f0-9]{40}$/i.test(input)) return input.toLowerCase();
  const m = input.match(/xt=urn:btih:([a-f0-9]{40})/i);
  return m ? m[1].toLowerCase() : null;
}

function buildMagnet(hash, name) {
  const tr = TRACKERS.map(t => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name || '')}${tr}`;
}

function extractQuality(text) {
  const m = text.match(/\b(4K|2160p|1080p|720p|480p|360p)\b/i);
  return m ? m[1].toUpperCase() : 'HD';
}

function formatTitle(s) {
  const title = s.title || s.name || '';
  const parts = [];
  const q = title.match(/\b(4K|2160p|1080p|720p|480p|360p)\b/i);
  if (q) parts.push(q[1]);
  const seeds = title.match(/👥\s*(\d+)/);
  if (seeds) parts.push(`🌱 ${seeds[1]}`);
  const size = title.match(/💾\s*([\d.]+ (?:GB|MB))/i);
  if (size) parts.push(`💾 ${size[1]}`);
  return parts.length ? parts.join(' · ') : title.split('\n')[0] || 'Stream';
}

module.exports = { getStreams, buildMagnet, extractInfoHash };
