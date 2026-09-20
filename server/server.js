'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const { registerSocketHandlers, roomManager } = require('./socket');
const { validateDecks } = require('./game/decks');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

// Данные проверяем до старта: лучше упасть сразу, чем отдавать битые карточки.
try {
  validateDecks();
  console.log('[data] колоды прошли проверку');
} catch (err) {
  console.error('[data] ОШИБКА:', err.message);
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.get('/health', (req, res) => {
  res.json({ ok: true, rooms: roomManager.size, uptime: Math.round(process.uptime()) });
});

/** Предпросмотр комнаты по коду — чтобы игрок видел, куда заходит. */
app.get('/api/room/:code', (req, res) => {
  const room = roomManager.get(req.params.code);
  if (!room) return res.status(404).json({ ok: false, error: 'Комната не найдена' });
  res.json({ ok: true, room: roomManager.summary(room) });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  pingTimeout: 25000,
});

registerSocketHandlers(io);

server.listen(PORT, HOST, () => {
  console.log(`\n  Bunker Live запущен`);
  console.log(`  Локально:  http://localhost:${PORT}`);
  console.log(`  В сети:    http://<ваш-IP>:${PORT}  (раздайте ссылку с кодом комнаты)\n`);
});

function shutdown(signal) {
  console.log(`\n[${signal}] останавливаю сервер...`);
  io.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server, io };
