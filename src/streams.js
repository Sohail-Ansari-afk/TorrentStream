const axios = require('axios');

const TORRENTIO_BASE = 'https://torrentio.strem.fun';

// Quality order for sorting
const QUALITY_ORDER = ['4K', '2160p', '1080p', '720p', '480p', '360p'];

// ─── Main Stream Fetcher ──────────────────────────────────
async function getStreams(type, id) {
  try {
    const torrentioStreams = await fetchFromTorrentio(type, id);

    if (!torrentioStreams.length) {
      console.log(`No streams found for ${type}/${id}`);
      return { streams: [] };
    }

    // Pass streams directly — Stremio handles infoHash natively
    // Also build proxy URLs as fallback for non-Stremio clients
    const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';

    const streams = torrentioStreams
      .map(stream => {
        if (!stream.infoHash) return null;

        const fileIdx = stream.fileIdx !== undefined ? stream.fileIdx : 0;

        return {
          // Stremio native torrent support (infoHash + fileIdx)
          infoHash: stream.infoHash,
          fileIdx: fileIdx,

          // Fallback HTTP proxy URL for apps that need a direct URL
          url: `${serverUrl}/torrentstream/${stream.infoHash}/${fileIdx}`,

          name: formatName(stream),
          title: formatTitle(stream),
          behaviorHints: {
            bingeGroup: `torrentstream-${stream.infoHash}`,
            notWebReady: false
          }
        };
      })
      .filter(Boolean);

    console.log(`Found ${streams.length} streams for ${type}/${id}`);
    return { streams };

  } catch (err) {
    console.error('Stream fetch error:', err.message);
    return { streams: [] };
  }
}

// ─── Fetch from Torrentio API ─────────────────────────────
async function fetchFromTorrentio(type, id) {
  try {
    const url = `${TORRENTIO_BASE}/stream/${type}/${encodeURIComponent(id)}.json`;
    console.log(`Fetching from Torrentio: ${url}`);

    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TorrentStream/1.0)'
      }
    });

    const streams = response.data.streams || [];
    console.log(`Torrentio returned ${streams.length} streams`);
    return streams;

  } catch (err) {
    console.error('Torrentio fetch error:', err.message);
    return [];
  }
}

// ─── Format Stream Name (shown as addon label in Stremio) ─
function formatName(stream) {
  const name = stream.name || 'TorrentStream';
  // Extract quality from title if present
  const title = stream.title || '';
  const qualityMatch = title.match(/\b(4K|2160p|1080p|720p|480p|360p)\b/i);
  const quality = qualityMatch ? qualityMatch[1].toUpperCase() : '';
  return quality ? `TorrentStream\n${quality}` : `TorrentStream`;
}

// ─── Format Stream Title (shown as subtitle/detail line) ──
function formatTitle(stream) {
  const parts = [];
  const title = stream.title || stream.name || '';

  // Source (e.g. "YTS", "RARBG", "1337x")
  const sourceMatch = title.match(/\[([^\]]+)\]$/);
  if (sourceMatch) parts.push(sourceMatch[1]);

  // Quality
  const qualityMatch = title.match(/\b(4K|2160p|1080p|720p|480p|360p)\b/i);
  if (qualityMatch) parts.push(qualityMatch[1]);

  // Seeds
  const seedMatch = title.match(/👥\s*(\d+)/);
  if (seedMatch) parts.push(`🌱 ${seedMatch[1]} seeds`);

  // Size
  const sizeMatch = title.match(/💾\s*([\d.]+ (?:GB|MB))/i);
  if (sizeMatch) parts.push(`💾 ${sizeMatch[1]}`);

  return parts.length ? parts.join(' · ') : (title.split('\n')[0] || 'Stream');
}

module.exports = { getStreams };
