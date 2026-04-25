const axios = require('axios');

// ─── Provider List (tried in order) ──────────────────────
const PROVIDERS = [
  'https://torrentio.strem.fun',
  'https://stremio-jackett.elfhosted.com',
  'https://jackettio.elfhosted.com',
];

// Full browser-spoofed headers to bypass IP blocks
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Origin': 'https://app.strem.io',
  'Referer': 'https://app.strem.io/',
  'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site',
  'Connection': 'keep-alive'
};

// ─── Main Stream Fetcher ──────────────────────────────────
async function getStreams(type, id) {
  try {
    // Step 1: Try each Stremio-compatible provider
    for (const provider of PROVIDERS) {
      try {
        const url = `${provider}/stream/${type}/${encodeURIComponent(id)}.json`;
        console.log(`Trying: ${url}`);

        const response = await axios.get(url, {
          timeout: 15000,
          headers: BROWSER_HEADERS
        });

        const streams = response.data.streams || [];
        if (streams.length > 0) {
          console.log(`✅ Got ${streams.length} streams from ${provider}`);
          return formatStreams(streams, id);
        }
        console.log(`⚠️  ${provider} returned 0 streams`);
      } catch (err) {
        console.log(`❌ ${provider} failed: ${err.message}`);
      }
    }

    // Step 2: All providers failed → use direct APIs
    console.log('All providers blocked, using fallback APIs...');
    return getFallbackStreams(type, id);

  } catch (err) {
    console.error('getStreams error:', err.message);
    return { streams: [] };
  }
}

// ─── Format streams from Stremio-compatible providers ─────
function formatStreams(torrentioStreams, id) {
  const streams = torrentioStreams.map(stream => {
    // Support both direct URL and infoHash streams
    const result = {
      name: `TorrentStream\n${extractQuality(stream.name || stream.title || '')}`,
      title: formatTitle(stream),
      behaviorHints: {
        notWebReady: false,
        bingeGroup: `ts-${stream.infoHash || id}`
      }
    };

    if (stream.url) result.url = stream.url;
    if (stream.infoHash) {
      result.infoHash = stream.infoHash;
      result.fileIdx = stream.fileIdx ?? 0;
    }

    return result;
  }).filter(s => s.url || s.infoHash);

  return { streams };
}

// ─── Fallback: YTS (movies) / EZTV (TV shows) ────────────
async function getFallbackStreams(type, id) {
  try {
    if (type === 'movie') {
      return getYTSStreams(id);
    } else {
      return getEZTVStreams(id);
    }
  } catch (err) {
    console.error('Fallback error:', err.message);
    return { streams: [] };
  }
}

// ─── YTS API (movies — public, never blocked) ─────────────
async function getYTSStreams(id) {
  try {
    const imdbId = id.startsWith('tt') ? id : `tt${id}`;
    const url = `https://yts.mx/api/v2/list_movies.json?query_term=${imdbId}&limit=5`;
    console.log(`YTS fallback: ${url}`);

    const response = await axios.get(url, {
      timeout: 10000,
      headers: BROWSER_HEADERS
    });

    const movies = response.data?.data?.movies || [];
    if (!movies.length) {
      console.log('YTS: no movies found');
      return { streams: [] };
    }

    const streams = [];
    for (const movie of movies) {
      for (const torrent of (movie.torrents || [])) {
        if (!torrent.hash) continue;
        const magnet = buildMagnet(torrent.hash, movie.title);
        streams.push({
          name: `TorrentStream\n${torrent.quality}`,
          title: `${torrent.quality} · ${torrent.type} · 🌱 ${torrent.seeds} seeds · 💾 ${torrent.size}`,
          url: magnet,
          infoHash: torrent.hash.toLowerCase(),
          fileIdx: 0,
          behaviorHints: { notWebReady: false, bingeGroup: `yts-${torrent.hash}` }
        });
      }
    }

    console.log(`YTS: found ${streams.length} streams`);
    return { streams };
  } catch (err) {
    console.error('YTS error:', err.message);
    return { streams: [] };
  }
}

// ─── EZTV API (TV shows — public, never blocked) ──────────
async function getEZTVStreams(id) {
  try {
    // Parse id format: tt1234:1:2 (show:season:episode)
    const parts = id.split(':');
    const imdbId = parts[0].replace('tt', '');
    const season = String(parts[1] || '1').padStart(2, '0');
    const episode = String(parts[2] || '1').padStart(2, '0');

    const url = `https://eztv.re/api/get-torrents?imdb_id=${imdbId}&limit=100`;
    console.log(`EZTV fallback: ${url}`);

    const response = await axios.get(url, {
      timeout: 10000,
      headers: BROWSER_HEADERS
    });

    const torrents = response.data?.torrents || [];

    // Filter for matching S##E## pattern
    const filtered = torrents.filter(t => {
      const title = t.title.toLowerCase();
      return (
        title.includes(`s${season}e${episode}`) ||
        title.includes(`${parseInt(season)}x${episode}`) ||
        title.includes(`season ${parseInt(season)}`)
      );
    });

    const streams = filtered.slice(0, 15).map(torrent => ({
      name: `TorrentStream\n${extractQuality(torrent.title)}`,
      title: `S${season}E${episode} · ${extractQuality(torrent.title)} · 🌱 ${torrent.seeds} seeds`,
      url: torrent.magnet_url,
      behaviorHints: { notWebReady: false, bingeGroup: `eztv-${imdbId}` }
    }));

    console.log(`EZTV: found ${streams.length} streams for S${season}E${episode}`);
    return { streams };
  } catch (err) {
    console.error('EZTV error:', err.message);
    return { streams: [] };
  }
}

// ─── Build Magnet Link ────────────────────────────────────
function buildMagnet(hash, name) {
  const trackers = [
    'udp://open.demonii.com:1337/announce',
    'udp://tracker.openbittorrent.com:80',
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://p4p.arenabg.com:1337',
    'udp://tracker.leechers-paradise.org:6969',
    'udp://tracker.coppersurfer.tk:6969',
  ].map(t => `&tr=${encodeURIComponent(t)}`).join('');

  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}${trackers}`;
}

// ─── Helpers ──────────────────────────────────────────────
function extractQuality(text) {
  const match = text.match(/\b(4K|2160p|1080p|720p|480p|360p)\b/i);
  return match ? match[1].toUpperCase() : 'HD';
}

function formatTitle(stream) {
  const title = stream.title || stream.name || '';
  const parts = [];

  const qualityMatch = title.match(/\b(4K|2160p|1080p|720p|480p|360p)\b/i);
  if (qualityMatch) parts.push(qualityMatch[1]);

  const seedMatch = title.match(/👥\s*(\d+)/);
  if (seedMatch) parts.push(`🌱 ${seedMatch[1]}`);

  const sizeMatch = title.match(/💾\s*([\d.]+ (?:GB|MB))/i);
  if (sizeMatch) parts.push(`💾 ${sizeMatch[1]}`);

  const srcMatch = title.match(/\[([^\]]+)\]$/);
  if (srcMatch) parts.push(srcMatch[1]);

  return parts.length ? parts.join(' · ') : title.split('\n')[0] || 'Stream';
}

module.exports = { getStreams };
