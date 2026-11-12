const HEALTH_PATH = /^\/api\/health(?:[/?#]|$)/;

/** True for /api/health and below. Probes call it every few seconds, so it gets no request log line and no trace. */
export function isHealthCheck(url: string | undefined): boolean {
  return HEALTH_PATH.test(url ?? '');
}
