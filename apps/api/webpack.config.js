// API build. NxAppWebpackPlugin bundles src/main.ts into dist/apps/api/main.js.
// It also bundles the OpenAPI emitter into emit-openapi.js for the api:openapi target.
// The image copies only main.js and otel.js, so the emitter never ships.
// otel.js is the OpenTelemetry preload (src/otel.ts): `node --require ./otel.js main.js`. It is its
// own small bundle, so it can run before main.js loads Express, pg and Nest.
// Packages from node_modules stay external (the plugin default for target node), so the
// Prisma runtime and its query compiler (wasm) load from node_modules at run time.
// Only the generated client in server/db (git ignores it) imports @prisma/client,
// and the project graph skips ignored files. So runtimeDependencies adds it to the generated package.json.
const { join } = require('node:path');
const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/api'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      additionalEntryPoints: [
        { entryName: 'emit-openapi', entryPath: './src/openapi/emit-openapi.ts' },
        { entryName: 'otel', entryPath: './src/otel.ts' },
      ],
      tsConfig: './tsconfig.app.json',
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      runtimeDependencies: ['@prisma/client'],
      sourceMap: true,
    }),
  ],
};
