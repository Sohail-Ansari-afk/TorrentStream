/**
 * keepalive.js — External keep-alive pinger for Render free tier
 *
 * Run this locally: node keepalive.js
 * Or deploy it on any free service (Railway, Glitch, etc.)
 *
 * Even better: use https://cron-job.org (free) to ping SERVER_URL/health
 * every 5 minutes — no code needed at all.
 */

require('dotenv').config();
const https = require('https');
const http = require('http');

const TARGET_URL = process.env.SERVER_URL || process.argv[2];

if (!TARGET_URL) {
  console.error('❌ No URL provided. Set SERVER_URL in .env or pass as argument:');
  console.error('   node keepalive.js https://torrentstream-2du1.onrender.com');
  process.exit(1);
}

const PING_INTERVAL_MS = 5 * 60 * 1000; // Every 5 minutes
const HEALTH_URL = `${TARGET_URL}/health`;

let pingCount = 0;
let successCount = 0;
let failCount = 0;

function ping() {
  pingCount++;
  const client = HEALTH_URL.startsWith('https') ? https : http;
  const startTime = Date.now();

  const req = client.get(HEALTH_URL, (res) => {
    const ms = Date.now() - startTime;
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode === 200) {
        successCount++;
        console.log(`✅ [${new Date().toLocaleTimeString()}] Ping #${pingCount} OK — ${ms}ms | Status: ${res.statusCode} | Successes: ${successCount}/${pingCount}`);
      } else {
        failCount++;
        console.log(`⚠️  [${new Date().toLocaleTimeString()}] Ping #${pingCount} got status ${res.statusCode} — ${ms}ms`);
      }
    });
  });

  req.on('error', (err) => {
    failCount++;
    console.log(`❌ [${new Date().toLocaleTimeString()}] Ping #${pingCount} FAILED — ${err.message} | Failures: ${failCount}/${pingCount}`);
  });

  req.setTimeout(15000, () => {
    failCount++;
    req.destroy();
    console.log(`⏱️  [${new Date().toLocaleTimeString()}] Ping #${pingCount} TIMEOUT (15s)`);
  });
}

console.log(`🚀 Keep-alive pinger started`);
console.log(`🎯 Target: ${HEALTH_URL}`);
console.log(`⏰ Interval: every ${PING_INTERVAL_MS / 60000} minutes`);
console.log(`─────────────────────────────────────────`);

// Ping immediately on start, then on interval
ping();
setInterval(ping, PING_INTERVAL_MS);
