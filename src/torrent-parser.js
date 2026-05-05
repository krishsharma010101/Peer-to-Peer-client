'use strict';

const fs = require('fs');
const bencode = require('bencode');
const crypto = require('crypto');


// FIX: Wrap open() in try/catch with descriptive error
function open(filepath) {
  if (!filepath) {
    throw new Error('No torrent file specified. Usage: node index.js <path-to-torrent>');
  }
  if (!fs.existsSync(filepath)) {
    throw new Error(`Torrent file not found: ${filepath}`);
  }
  try {
    const data = fs.readFileSync(filepath);
    const torrent = bencode.decode(data);
    // Ensure name is a string (bencode returns Buffer)
    if (torrent.info && torrent.info.name instanceof Buffer) {
      torrent.info.name = torrent.info.name.toString('utf8');
    }
    return torrent;
  } catch (err) {
    throw new Error(`Failed to parse torrent file: ${err.message}`);
  }
}

// FIX: infoHash must hash only the 'info' dict, re-encoded
function infoHash(torrent) {
  const info = bencode.encode(torrent.info);
  return crypto.createHash('sha1').update(info).digest();
}

function size(torrent) {
  // Multi-file torrent
  if (torrent.info.files) {
    return torrent.info.files
      .map(f => f.length)
      .reduce((a, b) => a + b, 0);
  }
  // Single-file torrent
  return torrent.info.length;
}

// FIX: pieceLen handles the last piece being shorter
function pieceLen(torrent, pieceIndex) {
  const totalLength = size(torrent);
  const standardLen = torrent.info['piece length'];
  const lastPieceLen = totalLength % standardLen;
  const lastPieceIndex = Math.floor(totalLength / standardLen);

  return pieceIndex === lastPieceIndex ? lastPieceLen : standardLen;
}

function blocksPerPiece(torrent, pieceIndex) {
  const pieceSize = pieceLen(torrent, pieceIndex);
  return Math.ceil(pieceSize / BLOCK_LEN);
}

function blockLen(torrent, pieceIndex, blockIndex) {
  const pieceSize = pieceLen(torrent, pieceIndex);
  const lastBlockLen = pieceSize % BLOCK_LEN;
  const lastBlockIndex = Math.floor(pieceSize / BLOCK_LEN);
  return blockIndex === lastBlockIndex ? lastBlockLen : BLOCK_LEN;
}

const BLOCK_LEN = Math.pow(2, 14); // 16 KB standard block size

function pieceHashes(torrent) {
  const hashBuf = torrent.info.pieces;
  const hashes = [];
  for (let i = 0; i < hashBuf.length; i += 20) {
    hashes.push(hashBuf.slice(i, i + 20));
  }
  return hashes;
}

module.exports = {
  open,
  infoHash,
  size,
  pieceLen,
  blocksPerPiece,
  blockLen,
  BLOCK_LEN,
  pieceHashes,
};
