'use strict';

const download = require('./src/download');
const torrentParser = require('./src/torrent-parser');
const dashboard = require('./src/dashboard');

// Start the web dashboard on port 3000
dashboard.start(3000);

// Parse and start download
let torrent;
try {
  torrent = torrentParser.open(process.argv[2]);
} catch (err) {
  console.error('[Error]', err.message);
  process.exit(1);
}

console.log(`[Starting] ${torrent.info.name}`);
console.log(`[Dashboard] Open http://localhost:3000 to view progress`);

download(torrent, torrent.info.name);