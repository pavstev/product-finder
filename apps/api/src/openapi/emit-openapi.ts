import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { buildOpenApiDocument, configureApp, toStableJson } from '@product-finder/api';
import { InvalidConfigError, loadConfig } from '@product-finder/server';
import { AppModule } from '../app.module.js';

/**
 * Writes the OpenAPI document to the file in the first argument, in preview mode (no database is reached).
 * The app is never closed: close() would run shutdown hooks on providers that were never built.
 */
async function emit(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    throw new Error('Usage: node emit-openapi.js <output file>');
  }
  const app = await NestFactory.create(AppModule, { preview: true, logger: false, abortOnError: false });
  // The same setup as main.ts, so the file matches /api/docs.
  configureApp(app, loadConfig());
  const target = resolve(file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, toStableJson(buildOpenApiDocument(app)), 'utf8');
}

emit().catch((error: unknown) => {
  // The message of a config error names each bad key and never a value, so it is safe to print.
  console.error(error instanceof InvalidConfigError ? error.message : error);
  process.exitCode = 1;
});
