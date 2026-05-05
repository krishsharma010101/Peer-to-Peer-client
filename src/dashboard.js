'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const downloadModule = require('./download');

const clients = new Set();

function start(port = 3000) {
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      // Serve the HTML dashboard
      const htmlPath = path.join(__dirname, 'dashboard.html');
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(htmlPath));
      } else {
        res.writeHead(404);
        res.end('Dashboard not found');
      }
    } else if (req.url === '/events') {
      // Server-Sent Events endpoint
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write('retry: 1000\n\n');

      // Send current stats immediately on connect
      const currentStats = downloadModule.stats;
      res.write(`data: ${JSON.stringify({ type: 'stats', payload: currentStats })}\n\n`);

      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else if (req.url === '/stats') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(downloadModule.stats));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  // Forward download events to all SSE clients
  downloadModule.events.on('stats', (stats) => {
    broadcast({ type: 'stats', payload: stats });
  });
  downloadModule.events.on('progress', (progress) => {
    broadcast({ type: 'progress', payload: progress });
  });
  downloadModule.events.on('peers', (peers) => {
    broadcast({ type: 'peers', payload: peers });
  });
  downloadModule.events.on('done', () => {
    broadcast({ type: 'done', payload: {} });
  });

  server.listen(port, () => {
    console.log(`[Dashboard] Running at http://localhost:${port}`);
  });

  return server;
}

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(msg);
    } catch (e) {
      clients.delete(client);
    }
  }
}

module.exports = { start };
