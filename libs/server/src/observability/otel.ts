// The OpenTelemetry bootstrap. Each app has a small entry (src/otel.ts) that calls startOtel.
// Webpack builds it as its own bundle and node preloads it, so the instrumentations hook `require`
// before Express, pg and Nest load. It runs before the config, so it reads process.env itself.
// This file imports no OpenTelemetry package: otel-sdk.ts loads only when the endpoint is set.

import { type OtelFlushHandle, registerOtelHandle } from './otel-handle.js';

type Env = Readonly<Record<string, string | undefined>>;

interface OtelSdk {
  start(): void;
  shutdown(): Promise<void>;
}

interface StartOtelOptions {
  /** The service.name when OTEL_SERVICE_NAME is not set. */
  serviceName: string;
  /** The environment to read. The default is process.env. */
  env?: Env;
  /** Test seam: builds the SDK. */
  createSdk?: (serviceName: string) => OtelSdk;
}

// A blank value counts as unset. A value that is not a URL turns tracing off, and loadConfig then stops the start.
function otelEnabled(env: Env): boolean {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return endpoint !== undefined && endpoint !== '' && URL.canParse(endpoint);
}

function loadNodeSdk(serviceName: string): OtelSdk {
  // A synchronous require on purpose: the instrumentations must hook `require` before main.js
  // loads, and an `import()` would come too late.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay a sync require in the preload
  const sdk = require('./otel-sdk.js') as typeof import('./otel-sdk.js');
  return sdk.createNodeSdk(serviceName);
}

/** Starts tracing and metrics when OTEL_EXPORTER_OTLP_ENDPOINT is set. It shuts down on `beforeExit`. */
export function startOtel({
  serviceName,
  env = process.env,
  createSdk = loadNodeSdk,
}: StartOtelOptions): OtelFlushHandle | undefined {
  if (!otelEnabled(env)) {
    return undefined;
  }
  const sdk = createSdk(env.OTEL_SERVICE_NAME?.trim() || serviceName);
  sdk.start();
  let stopping: Promise<void> | undefined;
  const handle: OtelFlushHandle = {
    // A collector that is down is not an error of the job. OTEL_LOG_LEVEL=debug shows the details.
    shutdown: () => {
      stopping ??= sdk.shutdown().catch(() => undefined);
      return stopping;
    },
  };
  // The API stops by signal and never reaches `beforeExit`, so it flushes from a Nest shutdown hook.
  registerOtelHandle(handle);
  process.once('beforeExit', () => {
    void handle.shutdown();
  });
  return handle;
}
