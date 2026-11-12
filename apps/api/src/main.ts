import '@product-finder/server'; // Side effect: loads .env before anything reads the config.
import { NestFactory } from '@nestjs/core';
import { configureApp, setupSwagger } from '@product-finder/api';
import { APP_CONFIG, type AppConfig } from '@product-finder/server';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // Nest holds its start-up lines until the pino logger is ready, so they come out as JSON too.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config);
  setupSwagger(app);
  await app.listen(config.PORT);
}
void bootstrap();
