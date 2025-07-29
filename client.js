const mediasoup = require('mediasoup-client'); // библиотека клиента mediasoup для WebRTC
const socketClient = require('socket.io-client'); // клиент Socket.IO для общения с сервером
//const SocketIoPromise = require('socket.io-promise'); // обёртка для Socket.IO с промисами
//const socketPromise = SocketIoPromise.promise; // создаём способ запросов с промисами
const socketPromise = require('socket.io-promise');
//То есть вы вызываете функцию, передавая ей сокет, и получаете «промис прокси».
// socket.request = socketPromise(socket);



const config = require('./config'); // конфигурация, например порт сервера

const hostname = window.location.hostname; // имя хоста страницы

// Объявление переменных для устройства mediasoup, соединения и продюсера

let device; // mediasoup.Device — представляет браузерное устройство
let socket; // Socket.IO клиент
let producer; // продюсер видео или экрана (MediaStreamTrack)

// Быстрая функция для получения DOM-элементов по селекторам
const $ = document.querySelector.bind(document);
// Получаем ссылки на элементы интерфейса
const $fsPublish = $('#fs_publish'); // поле публикации (fieldset)
const $fsSubscribe = $('#fs_subscribe'); // поле подписки (fieldset)
const $btnConnect = $('#btn_connect'); // кнопка подключения к серверу
const $btnWebcam = $('#btn_webcam'); // кнопка публикации с веб-камеры
const $btnScreen = $('#btn_screen'); // кнопка публикации экрана
const $btnSubscribe = $('#btn_subscribe'); // кнопка подписки на поток
const $chkSimulcast = $('#chk_simulcast'); // чекбокс для включения симулькаста (несколько потоков качества)
const $txtConnection = $('#connection_status'); // область статуса соединения
const $txtWebcam = $('#webcam_status'); // область статуса вебкамеры
const $txtScreen = $('#screen_status'); // область статуса экрана
const $txtSubscription = $('#sub_status'); // область статуса подписки
let $txtPublish; // переменная для текущего текстового поля публикации (вебкам или экран)

// Обработчики кликов по кнопкам
$btnConnect.addEventListener('click', connect); 
$btnWebcam.addEventListener('click', publish);
$btnScreen.addEventListener('click', publish);
$btnSubscribe.addEventListener('click', subscribe);

// Проверка, поддерживается ли демонстрация экрана в браузере
if (typeof navigator.mediaDevices.getDisplayMedia === 'undefined') {
  $txtScreen.innerHTML = 'Not supported';
  $btnScreen.disabled = true;
}

// Функция подключения к серверу через Socket.IO
async function connect() {
  $btnConnect.disabled = true; // блокируем кнопку подключения
  $txtConnection.innerHTML = 'Connecting...'; // обновляем статус

  const opts = {
    path: '/server', // путь подключения сокет клиента (от сервера)
    transports: ['websocket'], // тип транспорта 
  };

  // Формируем URL сервера по hostname и порту из конфига
  const serverUrl = `https://${hostname}:${config.listenPort}`;
  socket = socketClient(serverUrl, opts); // создаём клиент Socket.IO
  socket.request = socketPromise(socket); // добавляем обёртку для запросов с промисами

  // Обработчик успешного подключения к серверу
  socket.on('connect', async () => {
    $txtConnection.innerHTML = 'Connected'; // обновляем статус
    $fsPublish.disabled = false; // разблокируем публикацию
    $fsSubscribe.disabled = false; // разблокируем подписку

// Запрашиваем RTP capabilities роутера mediasoup у сервера    
    const data = await socket.request('getRouterRtpCapabilities');
    await loadDevice(data); // загружаем их в mediasoup.Device
  });

// Обработчик отключения от сервера  
  socket.on('disconnect', () => {
    $txtConnection.innerHTML = 'Disconnected'; // обновляем статус
    $btnConnect.disabled = false; // разблокируем кнопку подключения
    $fsPublish.disabled = true; // блокируем публикацию
    $fsSubscribe.disabled = true; // блокируем подписку
  });

  // Обработчик ошибки подключения
  socket.on('connect_error', (error) => {
    console.error('could not connect to %s%s (%s)', serverUrl, opts.path, error.message);
    $txtConnection.innerHTML = 'Connection failed'; // обновляем статус
    $btnConnect.disabled = false; // разблокируем кнопку подключения
  });

  // Обработчик уведомления о появлении нового продюсера от других клиентов
  socket.on('newProducer', () => {
    $fsSubscribe.disabled = false; // разблокировать кнопку подписки
  });
}

// Создаём и загружаем устройство mediasoup с полученными RTP capabilities
async function loadDevice(routerRtpCapabilities) {
  try {
    device = new mediasoup.Device(); // создаём Device
  } catch (error) {
    if (error.name === 'UnsupportedError') {
      console.error('browser not supported'); // браузер не поддерживает mediasoup клиент
    }
  }
  await device.load({ routerRtpCapabilities }); // загружаем capabilities роутера
}

// Функция публикации — инициируется нажатием кнопок вебкам или экрана
async function publish(e) {
  const isWebcam = (e.target.id === 'btn_webcam'); // определяем источник - вебкам или экран
  $txtPublish = isWebcam ? $txtWebcam : $txtScreen; // выбираем соответствующее поле статуса публикации

// Запрашиваем у сервера создание транспорта для продюсера  
  const data = await socket.request('createProducerTransport', {
    forceTcp: false, // флаг для TCP (не используется)
    rtpCapabilities: device.rtpCapabilities, // отправляем RTP capabilities
  });
  if (data.error) {
    console.error(data.error);
    return;
  }

 // Создаём отправляющий WebRTC транспорт в mediasoup-client  
  const transport = device.createSendTransport(data);
// Обработчик события подключения транспорта - client -> сервер отправляет DTLS параметры  
  transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
    socket.request('connectProducerTransport', { dtlsParameters })
      .then(callback)
      .catch(errback);
  });

// Обработчик события "produce" — когда начинается отправка медиапотока  
  transport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
    try {
      const { id } = await socket.request('produce', {
        transportId: transport.id,
        kind,
        rtpParameters,
      });
      callback({ id }); // подтверждаем серверу id продюсера
    } catch (err) {
      errback(err); // отправляем ошибку при неудаче
    }
  });

  // Обработчик изменения состояния соединения транспорта
  transport.on('connectionstatechange', (state) => {
    switch (state) {
      case 'connecting':
        $txtPublish.innerHTML = 'publishing...';
        $fsPublish.disabled = true;
        $fsSubscribe.disabled = true;
      break;

      case 'connected':
        document.querySelector('#local_video').srcObject = stream; // показываем локальный поток
        $txtPublish.innerHTML = 'published';
        $fsPublish.disabled = true;
        $fsSubscribe.disabled = false;
      break;

      case 'failed':
        transport.close(); // закрываем транспорт при ошибке
        $txtPublish.innerHTML = 'failed';
        $fsPublish.disabled = false;
        $fsSubscribe.disabled = true;
      break;

      default: break;
    }
  });

  let stream;
  try {
    stream = await getUserMedia(transport, isWebcam); // получаем медиапоток (вебкам или экран)
    const track = stream.getVideoTracks()[0]; // берём первый видеотрек
    const params = { track }; // параметры для продюсера
    // Если включён симулькаст, добавляем кодеки и параметры по битрейту
    if ($chkSimulcast.checked) {
      params.encodings = [
        { maxBitrate: 100000 },
        { maxBitrate: 300000 },
        { maxBitrate: 900000 },
      ];
      params.codecOptions = {
        videoGoogleStartBitrate : 1000
      };
    }
    // Создаём продюсера с параметрами для отправки трека
    producer = await transport.produce(params);
  } catch (err) {
    $txtPublish.innerHTML = 'failed'; // статус неудачи публикации
  }
}

// Функция получения медиа потока (вебкам или демонстрация экрана)
async function getUserMedia(transport, isWebcam) {
  if (!device.canProduce('video')) {
    console.error('cannot produce video'); // если устройство не может отправлять видео
    return;
  }

  let stream;
  try {
    // Получаем соответствующий медиа поток
    stream = isWebcam ?
      await navigator.mediaDevices.getUserMedia({ video: true }) :
      await navigator.mediaDevices.getDisplayMedia({ video: true });
  } catch (err) {
    console.error('getUserMedia() failed:', err.message);
    throw err; // проброс ошибки дальше
  }
  return stream;
}

// Функция подписки на медиа-поток (консьюмер)
async function subscribe() {
    // Запрашиваем у сервера создание транспорта для консьюмера
  const data = await socket.request('createConsumerTransport', {
    forceTcp: false,
  });
  if (data.error) {
    console.error(data.error);
    return;
  }
 // Создаём принимающий WebRTC транспорт
  const transport = device.createRecvTransport(data);
  // При подключении транспорта отправляем DTLS параметры на сервер
  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    socket.request('connectConsumerTransport', {
      transportId: transport.id,
      dtlsParameters
    })
      .then(callback)
      .catch(errback);
  });

  // Обработка изменения состояния соединения транспорта
  transport.on('connectionstatechange', async (state) => {
    switch (state) {
      case 'connecting':
        $txtSubscription.innerHTML = 'subscribing...';
        $fsSubscribe.disabled = true;
        break;

      case 'connected': 
        document.querySelector('#remote_video').srcObject = await stream; // показываем удалённый поток
        await socket.request('resume'); // запрашиваем возобновление потока у сервера
        $txtSubscription.innerHTML = 'subscribed';
        $fsSubscribe.disabled = true;
        break;

      case 'failed':
        transport.close(); // закрываем транспорт при ошибке
        $txtSubscription.innerHTML = 'failed';
        $fsSubscribe.disabled = false;
        break;

      default: break;
    }
  });

  const stream = consume(transport); // начинаем приём медиа (консьюминг)
}
// Функция создания консьюмера и получения медиапотока для подписки
async function consume(transport) {
  const { rtpCapabilities } = device; // возможности приемника
  const data = await socket.request('consume', { rtpCapabilities });
  const {
    producerId,
    id,
    kind,
    rtpParameters,
  } = data;

  let codecOptions = {}; // настройки кодеков (оставим пустыми)
  // Создаём консьюмера на клиенте с параметрами, полученными с сервера
  const consumer = await transport.consume({
    id,
    producerId,
    kind,
    rtpParameters,
    codecOptions,
  });
  // Создаём новый MediaStream и добавляем к нему трек от консьюмера
  const stream = new MediaStream();
  stream.addTrack(consumer.track);
  return stream; // возвращаем MediaStream для воспроизведения
}