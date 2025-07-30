// mediasoup-config.js
const mediasoup = require('mediasoup');

const workerSettings = {
  logLevel: 'warn',
  rtcMinPort: 10000,
  rtcMaxPort: 10100
};

const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
  }
];

let worker;
let router;

async function createWorker() {
  worker = await mediasoup.createWorker(workerSettings);
  worker.on('died', () => {
    console.error('mediasoup Worker died, exiting in 2 seconds...');
    setTimeout(() => process.exit(1), 2000);
  });

  router = await worker.createRouter({ mediaCodecs });
}

module.exports = { createWorker, worker, router };