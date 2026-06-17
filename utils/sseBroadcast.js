// utils/sseBroadcast.js
const clients = new Set();

function register(router) {
  router.get('/sse', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients.add(res);
    req.on('close', () => clients.delete(res));
  });
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => {
    try { client.write(payload); } catch (e) { clients.delete(client); }
  });
}

module.exports = { register, broadcast };
