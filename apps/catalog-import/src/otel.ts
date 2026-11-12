// The preload of the import job: `node --require ./otel.js main.js import`. Webpack builds it as its
// own bundle, so it loads only the OpenTelemetry packages, before main.js loads pg and Prisma.
// Without OTEL_EXPORTER_OTLP_ENDPOINT it does nothing. With it, the last spans and metrics are sent
// when the job is done, before the process exits.
import { startOtel } from '@product-finder/server/otel';

startOtel({ serviceName: 'catalog-import' });
