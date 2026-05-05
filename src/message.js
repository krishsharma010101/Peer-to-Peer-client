'use strict';

const torrentParser = require('./torrent-parser');
const utils = require('./utils');

// FIX: All message builders return proper Buffers with correct lengths

function buildHandshake(torrent) {
  const buf = Buffer.alloc(68);
  buf.writeUInt8(19, 0);
  buf.write('BitTorrent protocol', 1);
  buf.writeUInt32BE(0, 20);
  buf.writeUInt32BE(0, 24);
  torrentParser.infoHash(torrent).copy(buf, 28);
  utils.genId().copy(buf, 48);
  return buf;
}

function buildKeepAlive() {
  return Buffer.alloc(4);
}

function buildChoke() {
  const buf = Buffer.alloc(5);
  buf.writeUInt32BE(1, 0);
  buf.writeUInt8(0, 4);
  return buf;
}

function buildUnchoke() {
  const buf = Buffer.alloc(5);
  buf.writeUInt32BE(1, 0);
  buf.writeUInt8(1, 4);
  return buf;
}

function buildInterested() {
  const buf = Buffer.alloc(5);
  buf.writeUInt32BE(1, 0);
  buf.writeUInt8(2, 4);
  return buf;
}

function buildNotInterested() {
  const buf = Buffer.alloc(5);
  buf.writeUInt32BE(1, 0);
  buf.writeUInt8(3, 4);
  return buf;
}

function buildHave(payload) {
  const buf = Buffer.alloc(9);
  buf.writeUInt32BE(5, 0);
  buf.writeUInt8(4, 4);
  buf.writeUInt32BE(payload, 5);
  return buf;
}

function buildBitfield(bitfield) {
  const buf = Buffer.alloc(14);
  buf.writeUInt32BE(1 + bitfield.length, 0);
  buf.writeUInt8(5, 4);
  bitfield.copy(buf, 5);
  return buf;
}

function buildRequest(payload) {
  const buf = Buffer.alloc(17);
  buf.writeUInt32BE(13, 0);
  buf.writeUInt8(6, 4);
  buf.writeUInt32BE(payload.index, 5);
  buf.writeUInt32BE(payload.begin, 9);
  buf.writeUInt32BE(payload.length, 13);
  return buf;
}

function buildPiece(payload) {
  const buf = Buffer.alloc(payload.block.length + 13);
  buf.writeUInt32BE(9 + payload.block.length, 0);
  buf.writeUInt8(7, 4);
  buf.writeUInt32BE(payload.index, 5);
  buf.writeUInt32BE(payload.begin, 9);
  payload.block.copy(buf, 13);
  return buf;
}

function buildCancel(payload) {
  const buf = Buffer.alloc(17);
  buf.writeUInt32BE(13, 0);
  buf.writeUInt8(8, 4);
  buf.writeUInt32BE(payload.index, 5);
  buf.writeUInt32BE(payload.begin, 9);
  buf.writeUInt32BE(payload.length, 13);
  return buf;
}

function buildPort(payload) {
  const buf = Buffer.alloc(7);
  buf.writeUInt32BE(3, 0);
  buf.writeUInt8(9, 4);
  buf.writeUInt16BE(payload, 5);
  return buf;
}

// FIX: parse() handles all message types including bitfield (id=5) and have (id=4)
function parse(msg) {
  const id = msg.length > 4 ? msg.readInt8(4) : null;
  let payload = null;
  if (id === 4) {
    // have: 4-byte piece index
    payload = msg.slice(5);
  } else if (id === 5) {
    // bitfield: raw bytes
    payload = msg.slice(5);
  } else if (id === 6 || id === 7 || id === 8) {
    const rest = msg.slice(5);
    payload = {
      index: rest.readInt32BE(0),
      begin: rest.readInt32BE(4),
    };
    payload[id === 7 ? 'block' : 'length'] = id === 7 ? rest.slice(8) : rest.readInt32BE(8);
  }
  return {
    size: msg.readInt32BE(0),
    id: id,
    payload: payload,
  };
}

module.exports = {
  buildHandshake,
  buildKeepAlive,
  buildChoke,
  buildUnchoke,
  buildInterested,
  buildNotInterested,
  buildHave,
  buildBitfield,
  buildRequest,
  buildPiece,
  buildCancel,
  buildPort,
  parse,
};
