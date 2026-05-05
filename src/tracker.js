'use strict';

const dgram = require('dgram');
const url = require('url');
const crypto = require('crypto');
const torrentParser = require('./torrent-parser');
const utils = require('./utils');

// FIX: Support both UDP and HTTP trackers with proper error handling
function getPeers(torrent, callback) {
  const announceList = getAnnounceList(torrent);
  let tried = 0;
  let found = false;

  if (announceList.length === 0) {
    return callback(new Error('No trackers found in torrent'), []);
  }

  for (const trackerUrl of announceList) {
    const parsed = url.parse(trackerUrl);

    if (parsed.protocol === 'udp:') {
      udpAnnounce(trackerUrl, torrent, (err, peers) => {
        tried++;
        if (!err && peers && peers.length > 0 && !found) {
          found = true;
          callback(null, peers);
        } else if (tried === announceList.length && !found) {
          callback(new Error('Could not connect to any tracker'), []);
        }
      });
    } else if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      httpAnnounce(trackerUrl, torrent, (err, peers) => {
        tried++;
        if (!err && peers && peers.length > 0 && !found) {
          found = true;
          callback(null, peers);
        } else if (tried === announceList.length && !found) {
          callback(new Error('Could not connect to any tracker'), []);
        }
      });
    } else {
      tried++;
      if (tried === announceList.length && !found) {
        callback(new Error('No supported tracker protocols found'), []);
      }
    }
  }
}

function getAnnounceList(torrent) {
  const list = [];
  if (torrent.announce) {
    list.push(torrent.announce.toString('utf8'));
  }
  if (torrent['announce-list']) {
    torrent['announce-list'].forEach(tier => {
      if (Array.isArray(tier)) {
        tier.forEach(t => list.push(t.toString('utf8')));
      } else {
        list.push(tier.toString('utf8'));
      }
    });
  }
  // Remove duplicates
  return [...new Set(list)];
}

function udpAnnounce(trackerUrl, torrent, callback) {
  const socket = dgram.createSocket('udp4');
  const parsed = url.parse(trackerUrl);
  const connReq = buildConnReq();
  let responded = false;

  // Timeout after 5 seconds
  const timeout = setTimeout(() => {
    if (!responded) {
      responded = true;
      socket.close();
      callback(new Error(`UDP tracker timeout: ${trackerUrl}`), []);
    }
  }, 5000);

  socket.on('error', (err) => {
    if (!responded) {
      responded = true;
      clearTimeout(timeout);
      socket.close();
      callback(err, []);
    }
  });

  udpSend(socket, connReq, trackerUrl, (err) => {
    if (err) {
      if (!responded) {
        responded = true;
        clearTimeout(timeout);
        socket.close();
        callback(err, []);
      }
      return;
    }

    socket.on('message', (resp) => {
      if (responded) return;
      try {
        if (respType(resp) === 'connect') {
          const connResp = parseConnResp(resp);
          const announceReq = buildAnnounceReq(connResp.connectionId, torrent);
          udpSend(socket, announceReq, trackerUrl, () => {});
        } else if (respType(resp) === 'announce') {
          const announceResp = parseAnnounceResp(resp);
          responded = true;
          clearTimeout(timeout);
          socket.close();
          callback(null, announceResp.peers);
        }
      } catch (e) {
        responded = true;
        clearTimeout(timeout);
        socket.close();
        callback(e, []);
      }
    });
  });
}

function httpAnnounce(trackerUrl, torrent, callback) {
  const http = trackerUrl.startsWith('https') ? require('https') : require('http');
  const params = {
    info_hash: torrentParser.infoHash(torrent).toString('binary'),
    peer_id: utils.genId().toString('binary'),
    port: 6881,
    uploaded: 0,
    downloaded: 0,
    left: torrentParser.size(torrent),
    compact: 1,
    event: 'started',
  };

  const query = Object.keys(params)
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const reqUrl = `${trackerUrl}?${query}`;
  const req = http.get(reqUrl, (res) => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => {
      try {
        const bencode = require('bencode');
        const data = bencode.decode(Buffer.concat(chunks));
        const peers = parseHttpPeers(data.peers);
        callback(null, peers);
      } catch (e) {
        callback(e, []);
      }
    });
  });
  req.on('error', err => callback(err, []));
  req.setTimeout(5000, () => { req.abort(); callback(new Error('HTTP tracker timeout'), []); });
}

function parseHttpPeers(peers) {
  const result = [];
  if (Buffer.isBuffer(peers)) {
    for (let i = 0; i < peers.length; i += 6) {
      result.push({
        ip: `${peers[i]}.${peers[i+1]}.${peers[i+2]}.${peers[i+3]}`,
        port: peers.readUInt16BE(i + 4),
      });
    }
  }
  return result;
}

function udpSend(socket, message, rawUrl, callback) {
  const parsed = url.parse(rawUrl);
  socket.send(message, 0, message.length, parsed.port, parsed.hostname, callback);
}

function respType(resp) {
  const action = resp.readUInt32BE(0);
  if (action === 0) return 'connect';
  if (action === 1) return 'announce';
}

function buildConnReq() {
  const buf = Buffer.alloc(16);
  buf.writeUInt32BE(0x417, 0);
  buf.writeUInt32BE(0x27101980, 4);
  buf.writeUInt32BE(0, 8);
  crypto.randomBytes(4).copy(buf, 12);
  return buf;
}

function parseConnResp(resp) {
  return {
    action: resp.readUInt32BE(0),
    transactionId: resp.readUInt32BE(4),
    connectionId: resp.slice(8),
  };
}

function buildAnnounceReq(connId, torrent, port = 6881) {
  const buf = Buffer.allocUnsafe(98);
  connId.copy(buf, 0);
  buf.writeUInt32BE(1, 8);
  crypto.randomBytes(4).copy(buf, 12);
  torrentParser.infoHash(torrent).copy(buf, 16);
  utils.genId().copy(buf, 36);
  Buffer.alloc(8).copy(buf, 56);
  Buffer.alloc(8).copy(buf, 64);
  // FIX: Use BigInt-safe size writing
  const size = torrentParser.size(torrent);
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeUInt32BE(Math.floor(size / 0x100000000), 0);
  sizeBuf.writeUInt32BE(size % 0x100000000, 4);
  sizeBuf.copy(buf, 72);
  buf.writeUInt32BE(0, 80);
  buf.writeUInt32BE(0, 84);
  crypto.randomBytes(4).copy(buf, 88);
  buf.writeInt32BE(-1, 92);
  buf.writeUInt16BE(port, 96);
  return buf;
}

function parseAnnounceResp(resp) {
  function group(iterable, groupSize) {
    let groups = [];
    for (let i = 0; i < iterable.length; i += groupSize) {
      groups.push(iterable.slice(i, i + groupSize));
    }
    return groups;
  }

  return {
    action: resp.readUInt32BE(0),
    transactionId: resp.readUInt32BE(4),
    leechers: resp.readUInt32BE(8),
    seeders: resp.readUInt32BE(12),
    peers: group(resp.slice(20), 6).map(address => {
      return {
        ip: address.slice(0, 4).join('.'),
        port: address.readUInt16BE(4),
      };
    }),
  };
}

module.exports = { getPeers };
