const axios = require('axios');

const TORRENTIO_BASE = 'https://torrentio.strem.fun';

async function getStreams(type, id) {
  try {
    const url = `${TORRENTIO_BASE}/stream/${type}/${encodeURIComponent(id)}.json`;
    console.log(`Fetching: ${url}`);

    const response = await axios.get(url, { timeout: 15000 });
    const torrentioStreams = response.data.streams || [];

    console.log(`Got ${torrentioStreams.length} streams from Torrentio`);

    if (!torrentioStreams.length) return { streams: [] };

    // Prefer direct HTTP URL streams; fall back to infoHash-based ones
    const streams = torrentioStreams.map(stream => {
      // Torrentio provides either a direct url OR an infoHash
      const streamUrl = stream.url || null;
      const infoHash = stream.infoHash || null;
      const fileIdx = stream.fileIdx !== undefined ? stream.fileIdx : 0;

      if (!streamUrl && !infoHash) return null;

      const result = {
        name: `TorrentStream\n${extractQuality(stream.name || '')}`,
        title: formatTitle(stream),
        behaviorHints: {
          notWebReady: false,
          bingeGroup: `ts-${id}`
        }
      };

      // Direct HTTP URL (best — works in any player including Aniyomi)
      if (streamUrl) {
        result.url = streamUrl;
      }

      // infoHash for Stremio native torrent support
      if (infoHash) {
        result.infoHash = infoHash;
        result.fileIdx = fileIdx;
      }

      return result;
    }).filter(Boolean);

    return { streams };

  } catch (err) {
    console.error('Stream error:', err.message);
    return { streams: [] };
  }
}

function extractQuality(name) {
  const match = name.match(/\b(4K|2160p|1080p|720p|480p|360p)\b/i);
  return match ? match[1].toUpperCase() : 'HD';
}

function formatTitle(stream) {
  const title = stream.title || stream.name || '';
  const parts = [];

  const seedMatch = title.match(/👥\s*(\d+)/);
  if (seedMatch) parts.push(`🌱 ${seedMatch[1]} seeds`);

  const sizeMatch = title.match(/💾\s*([\d.]+ (?:GB|MB))/i);
  if (sizeMatch) parts.push(`💾 ${sizeMatch[1]}`);

  const sourceMatch = title.match(/\[([^\]]+)\]$/);
  if (sourceMatch) parts.push(sourceMatch[1]);

  return parts.length ? parts.join(' · ') : title.split('\n')[0] || 'Stream';
}

module.exports = { getStreams };
