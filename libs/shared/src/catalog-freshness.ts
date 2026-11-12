// A nightly job that missed one night is not stale yet.
export const CATALOG_STALE_AFTER_HOURS = 36;

const HOUR_MS = 3_600_000;

// Staleness is a signal for people and alerts. It never takes the API out of the load balancer.
export function isCatalogStale(lastSuccessfulImportAt: Date | null, now: Date): boolean {
  if (lastSuccessfulImportAt === null) {
    return true;
  }
  return now.getTime() - lastSuccessfulImportAt.getTime() > CATALOG_STALE_AFTER_HOURS * HOUR_MS;
}
