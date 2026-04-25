const axios = require('axios');

const TORRENTIO_BASE = 'https://torrentio.strem.fun';

// ─── Main Stream Fetcher ──────────────────────────────────
async function getStreams(type, id) {
  try {
    // Get our server's public URL (set in .env for production)
    const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';

    // Fetch streams from Torrentio
    const torrentioStreams = await fetchFromTorrentio(type, id);

    if (!torrentioStreams.length) {
      return { streams: [] };
    }

    // Convert magnet links to our HTTP proxy URLs
    const streams = torrentioStreams.map(stream => {
      const infoHash = extractInfoHash(stream.infoHash || stream.url);
      const fileIndex = stream.fileIdx || 0;

      if (!infoHash) return null;

      return {
        name: `TorrentStream\n${stream.name || 'Unknown'}`,
        title: formatTitle(stream),
        url: `${serverUrl}/torrentstream/${infoHash}/${fileIndex}`,
        behaviorHints: {
          notWebReady: false,
          bingeGroup: `torrentstream-${infoHash}`
        }
      };
    }).filter(Boolean);

    return { streams };
  } catch (err) {
    console.error('Stream fetch error:', err.message);
    return { streams: [] };
  }
}

// ─── Fetch from Torrentio API ─────────────────────────────
async function fetchFromTorrentio(type, id) {
  try {
    // Handle episode IDs like "tt1234:1:1"
    const encodedId = encodeURIComponent(id);
    const url = `${TORRENTIO_BASE}/stream/${type}/${encodedId}.json`;

    console.log(`Fetching streams: ${url}`);

    const response = await axios.get(url, { timeout: 10000 });
    return response.data.streams || [];
  } catch (err) {
    console.error('Torrentio fetch error:', err.message);
    return [];
  }
}

// ─── Extract InfoHash from magnet or direct ───────────────
function extractInfoHash(input) {
  if (!input) return null;

  // Already an infoHash
  if (/^[a-f0-9]{40}$/i.test(input)) return input;

  // Extract from magnet link
  const match = input.match(/xt=urn:btih:([a-f0-9]{40})/i);
  return match ? match[1].toLowerCase() : null;
}

// ─── Format Stream Title ──────────────────────────────────
function formatTitle(stream) {
  const parts = [];
  if (stream.name) parts.push(stream.name);

  const info = stream.title || '';
  if (info.includes('👥')) {
    const seedMatch = info.match(/👥 (\d+)/);
    if (seedMatch) parts.push(`Seeds: ${seedMatch[1]}`);
  }

  return parts.join(' | ') || 'Stream';
}

module.exports = { getStreams };
