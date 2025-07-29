const mediasoup = require('mediasoup');
const fs = require('fs');
const http = require('http');
const express = require('express');
const socketIO = require('socket.io');
const config = require('./config');
const path = require('path');

// Global variables
// Глобальные переменные
let worker;
let webServer;
let socketServer;
let expressApp;
let producer;
let consumer;
let producerTransport;
let consumerTransport;
let mediasoupRouter;

// Асинхронная самовызывающаяся функция для инициализации всех компонентов сервера
(async () => {
  try {
    await runExpressApp(); // Запуск Express приложения
    await runWebServer(); // Запуск HTTP сервера
    await runSocketServer(); // Запуск Socket.IO сервера
    await runMediasoupWorker(); // Запуск mediasoup воркера
  } catch (err) { // Лог ошибок, если что-то пошло не так при запуске
    console.error(err);
  }
})();

// Инициализация Express приложения
async function runExpressApp() {
  expressApp = express();
  expressApp.use(express.json()); // Парсер JSON в теле запросов
  // Статическая раздача файлов из папки public
  //expressApp.use(express.static(__dirname));
  expressApp.use(express.static(path.join(__dirname, 'public')));
  // Обработка ошибок Express, централизованный middleware
  expressApp.use((error, req, res, next) => {
    if (error) {
      console.warn('Express app error,', error.message);

      error.status = error.status || (error.name === 'TypeError' ? 400 : 500);

      res.statusMessage = error.message;
      res.status(error.status).send(String(error));
    } else {
      next();
    }
  });
}
//*********************************************************************** */
// Запуск и настройка HTTP сервера на основе Express
async function runWebServer() {
 
  webServer = http.createServer(expressApp);
// Обработка ошибок запуска сервера
  webServer.on('error', (err) => {
    console.error('starting web server failed:', err.message);
  });

  // Запуск сервера на IP и порте из конфига
  await new Promise((resolve) => {
    const { listenIp, listenPort } = config;
    webServer.listen(listenPort, listenIp, () => {
      const listenIps = config.mediasoup.webRtcTransport.listenIps[0];
      const ip = listenIps.announcedIp || listenIps.ip;
      console.log('server is running');
      console.log(`open http://${ip}:${listenPort} in your web browser`);
      resolve();
    });
  });
}
//******************************************************************** */

// Запуск Socket.IO сервера для обмена сигнализацией WebRTC
async function runSocketServer() {
  socketServer = socketIO(webServer, {
    serveClient: false,
    path: '/server',
    log: false,
  });
// Обработка подключения нового клиента
  socketServer.on('connection', (socket) => {
    console.log('client connected');

    // inform the client about existence of producer
    // Если уже есть продюсер, предупреждаем нового клиента
    if (producer) {
      socket.emit('newProducer');
    }
// Обработка отключения клиента
    socket.on('disconnect', () => {
      console.log('client disconnected');
    });
// Ошибки подключения клиента
    socket.on('connect_error', (err) => {
      console.error('client connection error', err);
    });
// Клиент запрашивает RTP capabilities роутера
    socket.on('getRouterRtpCapabilities', (data, callback) => {
      callback(mediasoupRouter.rtpCapabilities);
    });
// Клиент создаёт транспорт для продюсера (отправителя)
    socket.on('createProducerTransport', async (data, callback) => {
      try {
        const { transport, params } = await createWebRtcTransport();
        producerTransport = transport;
        callback(params);
      } catch (err) {
        console.error(err);
        callback({ error: err.message });
      }
    });
// Клиент создаёт транспорт для консюмера (приёмника)
    socket.on('createConsumerTransport', async (data, callback) => {
      try {
        const { transport, params } = await createWebRtcTransport();
        consumerTransport = transport;
        callback(params);
      } catch (err) {
        console.error(err);
        callback({ error: err.message });
      }
    });
// Клиент подключает продюсерский транспорт (передаёт DTLS параметры)
    socket.on('connectProducerTransport', async (data, callback) => {
      await producerTransport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
    });
 // Клиент подключает консюмерский транспорт (передаёт DTLS параметры)
    socket.on('connectConsumerTransport', async (data, callback) => {
      await consumerTransport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
    });
// Клиент создаёт продюсера с указанием типа и параметров RTP
    socket.on('produce', async (data, callback) => {
      const {kind, rtpParameters} = data;
      producer = await producerTransport.produce({ kind, rtpParameters });
      callback({ id: producer.id });

      // inform clients about new producer
      // Оповещаем других клиентов о новом продюсере
      socket.broadcast.emit('newProducer');
    });

// Клиент запрашивает создание консюмера для получения медиапотока    
    socket.on('consume', async (data, callback) => {
      callback(await createConsumer(producer, data.rtpCapabilities));
    });

// Запрос на возобновление приёма потока консюмером (resume)    
    socket.on('resume', async (data, callback) => {
      await consumer.resume();
      callback();
    });
  });
}
// Запуск mediasoup воркера – отдельного процесса для медиапотоков
async function runMediasoupWorker() {
  worker = await mediasoup.createWorker({
    logLevel: config.mediasoup.worker.logLevel,
    logTags: config.mediasoup.worker.logTags,
    rtcMinPort: config.mediasoup.worker.rtcMinPort,
    rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
  });

  // Обработка критического события "смерть" воркера
  worker.on('died', () => {
    console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
    setTimeout(() => process.exit(1), 2000);
  });
// Создаём роутер mediasoup с заданными кодеками из конфига
  const mediaCodecs = config.mediasoup.router.mediaCodecs;
  mediasoupRouter = await worker.createRouter({ mediaCodecs });
}
// Функция создания WebRTC транспорта с настройками из конфига
async function createWebRtcTransport() {
  const {
    maxIncomingBitrate,
    initialAvailableOutgoingBitrate
  } = config.mediasoup.webRtcTransport;
// Создаём WebRTC транспорт на роутере
  const transport = await mediasoupRouter.createWebRtcTransport({
    listenIps: config.mediasoup.webRtcTransport.listenIps,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate,
  });
// Если задан максимальный битрейт для входящих потоков – устанавливаем
  if (maxIncomingBitrate) {
    try {
      await transport.setMaxIncomingBitrate(maxIncomingBitrate);
    } catch (error) {
      // Игнорируем ошибки установки битрейта
    }
  }
  // Возвращаем транспорт и параметры для клиента
  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    },
  };
}
// Создание консюмера для приёма медиапотока от продюсера
async function createConsumer(producer, rtpCapabilities) {
// Проверяем, можем ли мы потреблять поток данного продюсера с RTP capabilities клиента
  if (!mediasoupRouter.canConsume(
    {
      producerId: producer.id,
      rtpCapabilities,
    })
  ) {
    console.error('can not consume');
    return;
  }
  try {
// Создаём консюмера на соответствующем транспорте    
    consumer = await consumerTransport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: producer.kind === 'video',
    });
  } catch (error) {
    console.error('consume failed', error);
    return;
  }
 // Если тип консюмера — simulcast, выбираем предпочтительные слои
  if (consumer.type === 'simulcast') {
    await consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
  }
// Возвращаем данные о консюмере клиенту
  return {
    producerId: producer.id,
    id: consumer.id,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
    type: consumer.type,
    producerPaused: consumer.producerPaused
  };
}
