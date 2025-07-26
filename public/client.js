//import * as mediasoupClient from 'mediasoup-client'; // убрать, т.к. используете CDN и глобальный объект

const device = new mediasoupClient.Device();

let  sendTransport, recvTransport, producer, consumer;

async function join() {

  socket.emit('getRtpCapabilities', {}, async (rtpCapabilities) => {
    device = new mediasoupClient.Device();
    await device.load({ routerRtpCapabilities: rtpCapabilities });
    createSendTransport();
  });
}

// Опционально сделать device глобальным для отладки:
//window.device = device;

function createSendTransport() {
  socket.emit('createWebRtcTransport', { direction: 'send' }, data => {
    sendTransport = device.createSendTransport(data);

    sendTransport.on('connect', ({ dtlsParameters }, callback) => {
      socket.emit('connectTransport', { transportId: sendTransport.id, dtlsParameters }, callback);
    });

    sendTransport.on('produce', async ({ kind, rtpParameters }, callback) => {
      socket.emit('produce', { transportId: sendTransport.id, kind, rtpParameters }, ({ id }) => {
        callback({ id });
      });
    });

    produce();
  });
}

async function produce() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  producer = await sendTransport.produce({ track: stream.getVideoTracks()[0] });

  // слушать другие producers от сервера
  socket.on('newProducer', ({ producerId }) => consume(producerId));
}

function consume(producerId) {
  if (!recvTransport) {
    socket.emit('createWebRtcTransport', { direction: 'recv' }, data => {
      recvTransport = device.createRecvTransport(data);

      recvTransport.on('connect', ({ dtlsParameters }, callback) => {
        socket.emit('connectTransport', { transportId: recvTransport.id, dtlsParameters }, callback);
      });

      completeConsume(producerId);
    });
  } else {
    completeConsume(producerId);
  }
}

function completeConsume(producerId) {
  socket.emit('consume', {
    producerId,
    transportId: recvTransport.id,
    rtpCapabilities: device.rtpCapabilities,
  }, ({ kind, rtpParameters }) => {
    recvTransport.consume({
      id: producerId,
      producerId,
      kind,
      rtpParameters,
    }).then(consumer => {
      const stream = new MediaStream([consumer.track]);
      // Вставить stream в video элемент
    });
  });
}

// Инициализация: socket.io, вызов join() по кнопке и пр.