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
//******************************************************************************/
// ...старый код инициализации express, socket.io и mediasoup

let peers = new Map();

io.on('connection', socket => {
  let userData = { transports: [], producers: [], consumers: [] };
  peers.set(socket.id, userData);

  socket.on('disconnect', () => {
    // Очистить связанные ресурсы
    userData.producers.forEach(p => p.close());
    userData.consumers.forEach(c => c.close());
    userData.transports.forEach(t => t.close());
    peers.delete(socket.id);
  });

  socket.on('getRtpCapabilities', (data, callback) => {
    callback(router.rtpCapabilities);
  });

  socket.on('createWebRtcTransport', async ({ direction }, callback) => {
    try {
      const transport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });
      userData.transports.push(transport);

      transport.on('dtlsstatechange', dtlsState => {
        if (dtlsState === 'closed') transport.close();
      });
      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (err) {
      callback({ error: err.message });
    }
  });

  socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
    const transport = userData.transports.find(t => t.id === transportId);
    await transport.connect({ dtlsParameters });
    callback();
  });

  socket.on('produce', async ({ transportId, kind, rtpParameters }, callback) => {
    const transport = userData.transports.find(t => t.id === transportId);
    const producer = await transport.produce({ kind, rtpParameters });
    userData.producers.push(producer);
    callback({ id: producer.id });

    // Broadcast this new producer to all other peers for consume
    socket.broadcast.emit('newProducer', { producerId: producer.id });
  });

  socket.on('consume', async ({ producerId, transportId, rtpCapabilities }, callback) => {
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      return callback({ error: 'Cannot consume' });
    }
    const transport = userData.transports.find(t => t.id === transportId);
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: false
    });
    userData.consumers.push(consumer);

    callback({
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    });
  });
});
