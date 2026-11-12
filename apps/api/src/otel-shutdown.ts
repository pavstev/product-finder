import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { flushOtel } from '@product-finder/server';

// Sends the last batched spans and metrics when the API stops. SIGTERM never reaches `beforeExit`, so Nest runs this hook.
@Injectable()
export class OtelShutdown implements OnApplicationShutdown {
  onApplicationShutdown(): Promise<void> {
    return flushOtel();
  }
}
