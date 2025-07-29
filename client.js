//import mediasoupClient from 'mediasoup-client';
import { Device } from 'mediasoup-client';
import { io } from 'socket.io-client';
import config from './config';

const hostname = window.location.hostname;

let device;
let socket;
let producer;

const $ = document.querySelector.bind(document);
const $fsPublish = $('#fs_publish');
const $fsSubscribe = $('#fs_subscribe');
const $btnConnect = $('#btn_connect');
const $btnWebcam = $('#btn_webcam');
const $btnScreen = $('#btn_screen');
const $btnSubscribe = $('#btn_subscribe');
const $chkSimulcast = $('#chk_simulcast');
const $txtConnection = $('#connection_status');
const $txtWebcam = $('#webcam_status');
const $txtScreen = $('#screen_status');
const $txtSubscription = $('#sub_status');
let $txtPublish;

$btnConnect.addEventListener('click', connect);
$btnWebcam.addEventListener('click', publish);
$btnScreen.addEventListener('click', publish);
$btnSubscribe.addEventListener('click', subscribe);

if (typeof navigator.mediaDevices.getDisplayMedia === 'undefined') {
  $txtScreen.innerHTML = 'Not supported';
  $btnScreen.disabled = true;
}

async function connect() {
  $btnConnect.disabled = true;
  $txtConnection.textContent = 'Connecting...';

  const opts = {
    path: '/server',
    transports: ['websocket'],
  };

  const serverUrl = `https://${hostname}:${config.listenPort}`;
  socket = io(serverUrl, opts);

  // Обёртка для вызовов с callback -> Promise
  socket.request = (eventName, data) => {
    return new Promise((resolve, reject) => {
      socket.timeout(5000).emit(eventName, data, (response) => {
        if (!response) {
          reject(new Error('No response from server'));
        } else if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  };

  socket.on('connect', async () => {
    $txtConnection.textContent = 'Connected';
    $fsPublish.disabled = false;
    $fsSubscribe.disabled = false;

    try {
      const rtpCapabilities = await socket.request('getRouterRtpCapabilities');
      await loadDevice(rtpCapabilities);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('disconnect', () => {
    $txtConnection.textContent = 'Disconnected';
    $btnConnect.disabled = false;
    $fsPublish.disabled = true;
    $fsSubscribe.disabled = true;
  });

  socket.on('connect_error', (error) => {
    console.error(`could not connect to ${serverUrl}${opts.path} (${error.message})`);
    $txtConnection.textContent = 'Connection failed';
    $btnConnect.disabled = false;
  });

  socket.on('newProducer', () => {
    $fsSubscribe.disabled = false;
  });
}

async function loadDevice(routerRtpCapabilities) {
  try {
    //device = new mediasoupClient.Device();
    device = new Device();
  } catch (error) {
    if (error.name === 'UnsupportedError') {
      console.error('browser not supported');
      return;
    }
  }
  await device.load({ routerRtpCapabilities });
}

async function publish(e) {
  const isWebcam = e.target.id === 'btn_webcam';
  $txtPublish = isWebcam ? $txtWebcam : $txtScreen;

  try {
    const data = await socket.request('createProducerTransport', {
      forceTcp: false,
      rtpCapabilities: device.rtpCapabilities,
    });

    const transport = device.createSendTransport(data);

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      socket.request('connectProducerTransport', { dtlsParameters })
        .then(callback)
        .catch(errback);
    });

    transport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
      try {
        const { id } = await socket.request('produce', {
          transportId: transport.id,
          kind,
          rtpParameters,
        });
        callback({ id });
      } catch (err) {
        errback(err);
      }
    });

    transport.on('connectionstatechange', (state) => {
      switch (state) {
        case 'connecting':
          $txtPublish.textContent = 'publishing...';
          $fsPublish.disabled = true;
          $fsSubscribe.disabled = true;
          break;
        case 'connected':
          document.querySelector('#local_video').srcObject = stream;
          $txtPublish.textContent = 'published';
          $fsPublish.disabled = true;
          $fsSubscribe.disabled = false;
          break;
        case 'failed':
          transport.close();
          $txtPublish.textContent = 'failed';
          $fsPublish.disabled = false;
          $fsSubscribe.disabled = true;
          break;
      }
    });

    let stream;
    stream = await getUserMedia(isWebcam);
    const track = stream.getVideoTracks()[0];
    const params = { track };

    if ($chkSimulcast.checked) {
      params.encodings = [
        { maxBitrate: 100000 },
        { maxBitrate: 300000 },
        { maxBitrate: 900000 },
      ];
      params.codecOptions = {
        videoGoogleStartBitrate: 1000,
      };
    }

    producer = await transport.produce(params);
  } catch (err) {
    console.error(err);
    $txtPublish.textContent = 'failed';
  }
}

async function getUserMedia(isWebcam) {
  if (!device.canProduce('video')) {
    throw new Error('Cannot produce video');
  }

  try {
    if (isWebcam) {
      return await navigator.mediaDevices.getUserMedia({ video: true });
    } else {
      return await navigator.mediaDevices.getDisplayMedia({ video: true });
    }
  } catch (err) {
    throw err;
  }
}

async function subscribe() {
  try {
    const data = await socket.request('createConsumerTransport', { forceTcp: false });
    if (data.error) {
      console.error(data.error);
      return;
    }

    const transport = device.createRecvTransport(data);

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      socket.request('connectConsumerTransport', {
        transportId: transport.id,
        dtlsParameters,
      }).then(callback).catch(errback);
    });

    transport.on('connectionstatechange', async (state) => {
      switch (state) {
        case 'connecting':
          $txtSubscription.textContent = 'subscribing...';
          $fsSubscribe.disabled = true;
          break;
        case 'connected':
          const stream = await consume(transport);
          document.querySelector('#remote_video').srcObject = stream;
          await socket.request('resume');
          $txtSubscription.textContent = 'subscribed';
          $fsSubscribe.disabled = true;
          break;
        case 'failed':
          transport.close();
          $txtSubscription.textContent = 'failed';
          $fsSubscribe.disabled = false;
          break;
      }
    });

  } catch (err) {
    console.error(err);
  }
}

async function consume(transport) {
  const { rtpCapabilities } = device;
  const data = await socket.request('consume', { rtpCapabilities });

  const {
    producerId,
    id,
    kind,
    rtpParameters,
  } = data;

  const codecOptions = {};
  const consumer = await transport.consume({
    id,
    producerId,
    kind,
    rtpParameters,
    codecOptions,
  });

  const stream = new MediaStream();
  stream.addTrack(consumer.track);
  return stream;
}