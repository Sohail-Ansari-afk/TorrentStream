const axios = require('axios');

// ─── Stream Sources (tried in order until one works) ─────
const STREAM_SOURCES = [
  {
    name: 'Knightcrawler',
    base: 'https://knightcrawler.elfhosted.com',
    getUrl: (type, id) => `/stream/${type}/${encodeURIComponent(id)}.json`
  },
  {
    name: 'Torrentio',
    base: 'https://torrentio.strem.fun',
    getUrl: (type, id) => `/stream/${type}/${encodeURIComponent(id)}.json`
  }
];

// Browser-like headers to avoid 403 blocks
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Origin': 'https://web.stremio.com',
  'Referer': 'https://web.stremio.com/'
};

// ─── Main Stream Fetcher ──────────────────────────────────
async function getStreams(type, id) {
  try {
    // For movies, also try YTS (never blocks, great quality)
    let allStreams = [];

    if (type === 'movie') {
      const ytsStreams = await fetchFromYTS(id);
      allStreams.push(...ytsStreams);
      console.log(`YTS: found ${ytsStreams.length} streams`);
    }

    // Try each Stremio-compatible source
    for (const source of STREAM_SOURCES) {
      try {
        const streams = await fetchFromSource(source, type, id);
        if (streams.length > 0) {
          console.log(`${source.name}: found ${streams.length} streams`);
          allStreams.push(...streams);
          break; // Got results, stop trying more sources
        }
      } catch (err) {
        console.log(`${source.name}: failed — ${err.message}`);
      }
    }

    if (!allStreams.length) {
      console.log(`No streams found for ${type}/${id}`);
      return { streams: [] };
    }

    // Deduplicate by infoHash
    const seen = new Set();
    const unique = allStreams.filter(s => {
      const key = s.infoHash || s.url;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`Returning ${unique.length} unique streams for ${type}/${id}`);
    return { streams: unique };

  } catch (err) {
    console.error('getStreams error:', err.message);
    return { streams: [] };
  }
}

// ─── Fetch from Stremio-compatible source ─────────────────
async function fetchFromSource(source, type, id) {
  const url = `${source.base}${source.getUrl(type, id)}`;
  console.log(`Fetching ${source.name}: ${url}`);

  const response = await axios.get(url, {
    timeout: 15000,
    headers: HEADERS
  });

  const raw = response.data.streams || [];

  return raw.map(stream => {
    if (!stream.infoHash && !stream.url) return null;

    return {
      name: `🎬 ${source.name}\n${extractQuality(stream.name || stream.title || '')}`,
      title: formatTitle(stream),
      ...(stream.url && { url: stream.url }),
      ...(stream.infoHash && {
        infoHash: stream.infoHash,
        fileIdx: stream.fileIdx ?? 0
      }),
      behaviorHints: {
        notWebReady: false,
        bingeGroup: `ts-${stream.infoHash || id}`
      }
    };
  }).filter(Boolean);
}

// ─── YTS API (movies only, provides infoHash directly) ────
async function fetchFromYTS(imdbId) {
  try {
    // Strip our "tt" prefix if raw TMDB id was passed
    const cleanId = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;

    const url = `https://yts.mx/api/v2/list_movies.json?query_term=${cleanId}&limit=5`;
    console.log(`Fetching YTS: ${url}`);

    const response = await axios.get(url, {
      timeout: 10000,
      headers: HEADERS
    });

    const movies = response.data?.data?.movies;
    if (!movies || !movies.length) return [];

    const streams = [];
    for (const movie of movies) {
      for (const torrent of (movie.torrents || [])) {
        if (!torrent.hash) continue;
        streams.push({
          name: `🍿 YTS\n${torrent.quality}`,
          title: `${torrent.quality} · ${torrent.type} · 🌱 ${torrent.seeds} seeds · 💾 ${torrent.size}`,
          infoHash: torrent.hash.toLowerCase(),
          fileIdx: 0,
          behaviorHints: {
            notWebReady: false,
            bingeGroup: `yts-${torrent.hash}`
          }
        });
      }
    }
    return streams;
  } catch (err) {
    console.log(`YTS error: ${err.message}`);
    return [];
  }
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
