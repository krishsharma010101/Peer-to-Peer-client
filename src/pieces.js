'use strict';

const torrentParser = require('./torrent-parser');

class Pieces {
  constructor(torrent) {
    // FIX: Initialize with proper 2D array of blocks per piece
    function buildPiecesArray() {
      const nPieces = torrent.info.pieces.length / 20;
      const arr = new Array(nPieces).fill(null);
      return arr.map((_, i) => new Array(torrentParser.blocksPerPiece(torrent, i)).fill(false));
    }
    this._requested = buildPiecesArray();
    this._received = buildPiecesArray();
  }

  addRequested(pieceBlock) {
    const blockIndex = pieceBlock.begin / torrentParser.BLOCK_LEN;
    this._requested[pieceBlock.index][blockIndex] = true;
  }

  addReceived(pieceBlock) {
    const blockIndex = pieceBlock.begin / torrentParser.BLOCK_LEN;
    this._received[pieceBlock.index][blockIndex] = true;
  }

  needed(pieceBlock) {
    if (this._requested.every(blocks => blocks.every(i => i))) {
      // FIX: Reset requested if all requested (so we can re-request on stalls)
      this._requested = this._received.map(blocks => blocks.slice());
    }
    const blockIndex = pieceBlock.begin / torrentParser.BLOCK_LEN;
    return !this._requested[pieceBlock.index][blockIndex];
  }

  isDone() {
    return this._received.every(blocks => blocks.every(i => i));
  }

  // NEW: Progress stats
  percentDone() {
    const total = this._received.flat().length;
    const done = this._received.flat().filter(Boolean).length;
    return total === 0 ? 0 : (done / total) * 100;
  }

  piecesReceived() {
    return this._received.filter(blocks => blocks.every(Boolean)).length;
  }

  totalPieces() {
    return this._received.length;
  }
}

module.exports = Pieces;
