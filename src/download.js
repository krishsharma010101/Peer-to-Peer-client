'use strict';

const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const tracker = require('./tracker');
const message = require('./message');
const Pieces = require('./pieces');
const Queue = require('./queue');
const torrentParser = require('./torrent-parser');

// NEW: Global event emitter for progress updates (used by dashboard)
const downloadEvents = new EventEmitter();
downloadEvents.setMaxListeners(50);

// Global stats
const stats = {
  peers: [],
  connectedPeers: 0,
  downloadSpeed: 0,
  uploadSpeed: 0,
  progress: 0,
  piecesReceived: 0,
  totalPieces: 0,
  bytesDownloaded: 0,
  torrentName: '',
  status: 'idle', // idle | connecting | downloading | verifying | done | error
  errors: [],
  startTime: null,
  eta: null,
};

let _bytesLastSecond = 0;
let _speedInterval = null;

function download(torrent, outputFileName) {
  stats.torrentName = outputFileName || 'Unknown';
  stats.status = 'connecting';
  stats.startTime = Date.now();
  downloadEvents.emit('stats', { ...stats });

  // Speed tracking interval
  _speedInterval = setInterval(() => {
    stats.downloadSpeed = _bytesLastSecond;
    _bytesLastSecond = 0;
    if (stats.downloadSpeed > 0 && stats.bytesDownloaded < torrentParser.size(torrent)) {
      const remaining = torrentParser.size(torrent) - stats.bytesDownloaded;
      stats.eta = Math.round(remaining / stats.downloadSpeed);
    }
    downloadEvents.emit('stats', { ...stats });
  }, 1000);

  tracker.getPeers(torrent, (err, peers) => {
    if (err) {
      stats.status = 'error';
      stats.errors.push(err.message);
      downloadEvents.emit('stats', { ...stats });
      console.error('[Tracker Error]', err.message);
      return;
    }

    console.log(`[Tracker] Got ${peers.length} peers`);
    stats.peers = peers.map(p => ({ ...p, connected: false, speed: 0 }));
    stats.status = 'downloading';
    downloadEvents.emit('stats', { ...stats });

    const pieces = new Pieces(torrent);
    stats.totalPieces = pieces.totalPieces();

    // FIX: Determine output path correctly for multi-file torrents
    const outputDir = outputFileName;
    if (torrent.info.files) {
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    }

    downloadEvents.emit('peers', peers);
    onWholeFile(torrent, outputFileName, pieces, peers);
  });
}

function onWholeFile(torrent, outputFileName, pieces, peers) {
  // FIX: Create correct file handle(s) — multi vs single file
  const files = torrent.info.files
    ? torrent.info.files.map(f => {
        const filePath = path.join(outputFileName, ...f.path.map(p => p.toString('utf8')));
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        return {
          fd: fs.openSync(filePath, 'w'),
          length: f.length,
          name: filePath,
        };
      })
    : [{
        fd: fs.openSync(outputFileName, 'w'),
        length: torrent.info.length,
        name: outputFileName,
      }];

  // Connect to up to 30 peers
  const maxPeers = Math.min(peers.length, 30);
  for (let i = 0; i < maxPeers; i++) {
    connectToPeer(torrent, peers[i], i, pieces, files);
  }
}

function connectToPeer(torrent, peer, peerIndex, pieces, files) {
  const socket = new net.Socket();
  socket.setTimeout(5000);

  socket.on('error', (err) => {
    updatePeerStatus(peerIndex, false);
  });

  socket.on('timeout', () => {
    socket.destroy();
    updatePeerStatus(peerIndex, false);
  });

  try {
    socket.connect(peer.port, peer.ip, () => {
      updatePeerStatus(peerIndex, true);
      socket.setTimeout(0); // disable timeout once connected
      socket.write(message.buildHandshake(torrent));
    });
  } catch (e) {
    updatePeerStatus(peerIndex, false);
    return;
  }

  const queue = new Queue(torrent);
  onWholeMsg(socket, (msg) => msgHandler(msg, socket, pieces, queue, torrent, files, peerIndex));

  socket.on('close', () => {
    updatePeerStatus(peerIndex, false);
  });
}

function updatePeerStatus(peerIndex, connected) {
  if (stats.peers[peerIndex]) {
    stats.peers[peerIndex].connected = connected;
  }
  stats.connectedPeers = stats.peers.filter(p => p.connected).length;
  downloadEvents.emit('stats', { ...stats });
}

// FIX: onWholeMsg now correctly handles TCP stream fragmentation
function onWholeMsg(socket, callback) {
  let savedBuf = Buffer.alloc(0);
  let handshake = true;

  socket.on('data', (recvBuf) => {
    const msgLen = () => {
      if (handshake) {
        return savedBuf.length > 0 ? savedBuf.readUInt8(0) + 49 : 0;
      }
      return savedBuf.length >= 4 ? savedBuf.readInt32BE(0) + 4 : 0;
    };

    savedBuf = Buffer.concat([savedBuf, recvBuf]);

    while (savedBuf.length >= 4 && savedBuf.length >= msgLen()) {
      callback(savedBuf.slice(0, msgLen()));
      savedBuf = savedBuf.slice(msgLen());
      handshake = false;
    }
  });
}

function msgHandler(msg, socket, pieces, queue, torrent, files, peerIndex) {
  if (isHandshake(msg)) {
    socket.write(message.buildInterested());
    return;
  }

  const m = message.parse(msg);

  if (m.id === 0) chokeHandler(socket, queue);
  if (m.id === 1) unchokeHandler(socket, queue, torrent, pieces);
  if (m.id === 4) haveHandler(socket, queue, torrent, pieces, m.payload);
  if (m.id === 5) bitfieldHandler(socket, queue, torrent, pieces, m.payload);
  if (m.id === 7) pieceHandler(socket, queue, torrent, pieces, files, m.payload, peerIndex);
}

function isHandshake(msg) {
  return msg.length === msg.readUInt8(0) + 49 &&
    msg.toString('utf8', 1, 20) === 'BitTorrent protocol';
}

function chokeHandler(socket, queue) {
  queue.choked = true;
}

function unchokeHandler(socket, queue, torrent, pieces) {
  queue.choked = false;
  requestPiece(socket, queue, pieces);
}

function haveHandler(socket, queue, torrent, pieces, payload) {
  const pieceIndex = payload && payload.length >= 4 ? payload.readUInt32BE(0) : null;
  if (pieceIndex === null) return;
  const queueEmpty = queue.isEmpty();
  queue.queue(pieceIndex);
  if (queueEmpty) requestPiece(socket, queue, pieces);
}

function bitfieldHandler(socket, queue, torrent, pieces, payload) {
  const queueEmpty = queue.isEmpty();
  payload.forEach((byte, i) => {
    for (let j = 0; j < 8; j++) {
      if (byte % 2) queue.queue(i * 8 + 7 - j);
      byte = Math.floor(byte / 2);
    }
  });
  if (queueEmpty) requestPiece(socket, queue, pieces);
}

function pieceHandler(socket, queue, torrent, pieces, files, pieceResp, peerIndex) {
  // Track download speed
  const blockSize = pieceResp.block.length;
  _bytesLastSecond += blockSize;
  stats.bytesDownloaded += blockSize;

  pieces.addReceived(pieceResp);

  // Update global progress
  stats.progress = pieces.percentDone();
  stats.piecesReceived = pieces.piecesReceived();
  downloadEvents.emit('progress', {
    progress: stats.progress,
    piecesReceived: stats.piecesReceived,
    totalPieces: stats.totalPieces,
    bytesDownloaded: stats.bytesDownloaded,
  });

  // FIX: Write block to correct file offset
  const offset = pieceResp.index * torrent.info['piece length'] + pieceResp.begin;
  writeToFiles(files, offset, pieceResp.block);

  if (pieces.isDone()) {
    console.log('\n[Download] Complete!');
    stats.status = 'done';
    stats.progress = 100;
    if (_speedInterval) clearInterval(_speedInterval);
    downloadEvents.emit('done');
    downloadEvents.emit('stats', { ...stats });
    socket.end();
  } else {
    requestPiece(socket, queue, pieces);
  }
}

function writeToFiles(files, offset, block) {
  // Calculate which file(s) this block belongs to and write accordingly
  let fileOffset = 0;
  let blockOffset = 0;

  for (const file of files) {
    const fileEnd = fileOffset + file.length;

    if (offset + block.length > fileOffset && offset < fileEnd) {
      const start = Math.max(0, offset - fileOffset);
      const blockStart = Math.max(0, fileOffset - offset);
      const length = Math.min(file.length - start, block.length - blockStart);

      if (length > 0) {
        try {
          fs.writeSync(file.fd, block, blockStart, length, start);
        } catch (e) {
          // ignore write errors on completion
        }
      }
    }

    fileOffset += file.length;
    if (fileOffset >= offset + block.length) break;
  }
}

function requestPiece(socket, queue, pieces) {
  if (queue.choked) return;

  while (queue.peek()) {
    const pieceBlock = queue.deque();
    if (pieces.needed(pieceBlock)) {
      socket.write(message.buildRequest(pieceBlock));
      pieces.addRequested(pieceBlock);
      break;
    }
  }
}

module.exports = download;
module.exports.events = downloadEvents;
module.exports.stats = stats;
