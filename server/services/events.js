const clients = new Set();

function subscribe(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

function emit(type, data = {}) {
  const msg = `event: ${type}\ndata: ${JSON.stringify({ ...data, ts: Date.now() })}\n\n`;
  for (const res of clients) res.write(msg);
}

setInterval(() => {
  for (const res of clients) res.write(':keepalive\n\n');
}, 25000).unref();

module.exports = { subscribe, emit };
