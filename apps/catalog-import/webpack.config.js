// catalog-import build. NxAppWebpackPlugin bundles src/main.ts into dist/apps/catalog-import/main.js.
// The libs are bundled, demo-reviews.json included. Packages from node_modules stay external, as in
// the api build, so the Prisma runtime and the prisma CLI (for `migrate`) load from node_modules.
// No bundled code uses __dirname. Paths start at the working directory (catalog-file.ts, migrate.ts).
// otel.js is the OpenTelemetry preload (src/otel.ts): `node --require ./otel.js main.js import`. It is
// its own small bundle, so it can run before main.js loads pg and Prisma.
const { join } = require('node:path');
const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/catalog-import'),
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
      additionalEntryPoints: [{ entryName: 'otel', entryPath: './src/otel.ts' }],
      tsConfig: './tsconfig.app.json',
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      // The generated client imports @prisma/client (see the api build). `migrate` runs the prisma CLI.
      runtimeDependencies: ['@prisma/client', 'prisma'],
      sourceMap: true,
    }),
  ],
};
