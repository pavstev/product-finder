// Keeps the started SDK so the API can flush it when it stops.
// The preload (otel.js) and the app (main.js) are separate bundles that share only the global object,
// so the handle lives there under a Symbol.for key. This file imports no package.

export interface OtelFlushHandle {
  /** Exports what is left and stops. Safe to call twice. Never rejects. */
  shutdown(): Promise<void>;
}

const OTEL_HANDLE_KEY = Symbol.for('product-finder.otel');

type HandleHolder = { [OTEL_HANDLE_KEY]?: OtelFlushHandle };

export function registerOtelHandle(handle: OtelFlushHandle): void {
  (globalThis as HandleHolder)[OTEL_HANDLE_KEY] = handle;
}

/** Exports the queued spans and metrics, then stops the SDK. Does nothing when tracing is off. */
export function flushOtel(): Promise<void> {
  return (globalThis as HandleHolder)[OTEL_HANDLE_KEY]?.shutdown() ?? Promise.resolve();
}
