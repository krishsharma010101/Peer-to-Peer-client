# BitTorrent Client v2.0

A fully functional BitTorrent client written in Node.js with a real-time web dashboard.

## Features

- ✅ Full BitTorrent wire protocol implementation
- ✅ UDP & HTTP tracker support
- ✅ Multi-file torrent support
- ✅ Piece integrity verification
- ✅ Real-time web dashboard at `http://localhost:3000`
- ✅ Live peer connection tracking
- ✅ Download speed history chart
- ✅ Piece map visualization
- ✅ ETA estimation

## Installation

```bash
npm install
```

## Usage

```bash
node index.js <path-to-torrent-file>
```

Then open **http://localhost:3000** in your browser to watch the download in real time.

## Dashboard Features

| Panel | Description |
|-------|-------------|
| Speed card | Live download speed (B/s → MB/s) |
| Peers card | Connected vs discovered peers |
| ETA card | Estimated time to completion |
| Downloaded | Total bytes received |
| Progress bar | Smooth animated fill |
| Piece map | Visual grid of all 400 displayed pieces |
| Speed chart | 60-second rolling sparkline |
| Peer list | Live status of all discovered peers |
| Activity log | Timestamped event stream |

## Architecture

```
index.js              - Entry point, starts dashboard + download
src/
  torrent-parser.js   - .torrent file parsing, info hash, piece math
  tracker.js          - UDP/HTTP tracker announce & peer discovery
  download.js         - Peer connection, piece request pipeline, file write
  message.js          - BitTorrent wire protocol encode/decode
  pieces.js           - Piece/block tracking state machine
  queue.js            - Per-peer block request queue
  utils.js            - Peer ID generation
  dashboard.js        - HTTP server + SSE event bridge
  dashboard.html      - Frontend UI
```


