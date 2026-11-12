// The preload of the API (`node --require ./otel.js main.js`), so the instrumentations hook Express, pg and Nest.
// Without OTEL_EXPORTER_OTLP_ENDPOINT it does nothing.
import { startOtel } from '@product-finder/server/otel';

startOtel({ serviceName: 'api' });
