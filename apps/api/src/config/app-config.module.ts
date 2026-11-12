import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from '@product-finder/server';

// Provides the validated AppConfig under APP_CONFIG to every module. ConfigModule in AppModule validates earlier.
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
