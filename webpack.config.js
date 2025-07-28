const path = require('path');

module.exports = {
  mode: 'production', // или 'development' для отладки
  entry: './client.js', // ваш входной клиентский скрипт
  output: {
    filename: 'app-bundle.js', // имя выходного файла, как в browserify
    path: path.resolve(__dirname, 'public'), // папка для сборки, можно 'dist' или 'public'
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader', // для транспиляции современного JS
          options: {
            presets: ['@babel/preset-env'],
          },
        },
      },
    ],
  },
  resolve: {
    fallback: {
      // по необходимости добавляйте сюда модули, если нужны полифилы (зависит от кода)
      "crypto": require.resolve("crypto-browserify"),
      "stream": require.resolve("stream-browserify"),
      "buffer": require.resolve("buffer/"),
      "assert": require.resolve("assert/"),
      "http": require.resolve("stream-http"),
      "https": require.resolve("https-browserify"),
      "os": require.resolve("os-browserify/browser"),
      "url": require.resolve("url/")
    }
  },
  plugins: [
    // Для полифилов (установите npm install buffer process) если нужно
    new (require('webpack')).ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer'],
    }),
  ],
  devtool: 'source-map', // для удобства отладки
};