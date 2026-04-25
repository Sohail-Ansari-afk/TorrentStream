const WebTorrent = require('webtorrent');

const client = new WebTorrent();
const activeTorrents = new Map();

async function streamTorrent(infoHash, fileIndex, req, res) {
  const magnetUri = `magnet:?xt=urn:btih:${infoHash}`;

  return new Promise((resolve, reject) => {
    // Reuse existing torrent if already added
    let torrent = activeTorrents.get(infoHash);

    if (torrent) {
      serveFile(torrent, fileIndex, req, res);
      resolve();
      return;
    }

    console.log(`Adding torrent: ${infoHash}`);

    client.add(magnetUri, { path: './downloads' }, (torrent) => {
      activeTorrents.set(infoHash, torrent);
      console.log(`Torrent ready: ${torrent.name}`);

      torrent.on('error', (err) => {
        activeTorrents.delete(infoHash);
        reject(err);
      });

      serveFile(torrent, fileIndex, req, res);
      resolve();
    });

    // Timeout if torrent doesn't load in 30s
    setTimeout(() => {
      if (!activeTorrents.has(infoHash)) {
        reject(new Error('Torrent timeout'));
      }
    }, 30000);
  });
}

function serveFile(torrent, fileIndex, req, res) {
  const file = torrent.files[fileIndex] || torrent.files[0];

  if (!file) {
    res.status(404).send('File not found in torrent');
    return;
  }

  const fileSize = file.length;
  const range = req.headers.range;

  // Support range requests (needed for seeking in video)
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    });

    const stream = file.createReadStream({ start, end });
    stream.pipe(res);

    stream.on('error', (err) => {
      console.error('Stream error:', err.message);
    });
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    });

    const stream = file.createReadStream();
    stream.pipe(res);
  }
}

// Cleanup old torrents every 30 minutes
setInterval(() => {
  console.log(`Active torrents: ${activeTorrents.size}`);
}, 1800000);

module.exports = { streamTorrent };
