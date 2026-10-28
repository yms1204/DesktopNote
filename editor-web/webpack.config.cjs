const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/editor.js',
  output: {
    filename: 'editor.bundle.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
  optimization: {
    // A WKWebView loading from file:// cannot fetch extra chunks, so the whole
    // editor -- fonts included -- has to land in one file.
    splitChunks: false,
    runtimeChunk: false,
    minimize: true,
  },
  module: {
    rules: [
      { test: /\.css$/i, use: ['style-loader', 'css-loader'] },
      { test: /\.(woff2?|ttf|eot)$/i, type: 'asset/inline' },
    ],
  },
  performance: {
    maxAssetSize: 6_000_000,
    maxEntrypointSize: 6_000_000,
  },
  devtool: false,
};
