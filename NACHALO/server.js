// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mediasoupLib = require('mediasoup');
const mediasoupConfig = require('./mediasoup-config');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

let worker, router;

// Инициализация MediaSoup worker и router
async function initMediasoup() {
  await mediasoupConfig.createWorker();
  worker = mediasoupConfig.worker;
  router = mediasoupConfig.router;
}

initMediasoup().catch(err => {
  console.error('Failed to initialize mediasoup:', err);
  process.exit(1);
});

io.on('connection', socket => {
  console.log('New client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });

  // Сюда будет логика для создания transport, produce, consume и прочего
  socket.on('joinRoom', async (roomId, callback) => {
    // В минимальном примере просто подтверждаем подключение
    callback({ ok: true, routerRtpCapabilities: router.rtpCapabilities });
  });
});

server.listen(3000, () => {
  console.log('Server is running on port 3000');
});