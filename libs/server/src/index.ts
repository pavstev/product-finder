// Everything in client.ts plus the Nest module and service.
// The OpenTelemetry bootstrap is @product-finder/server/otel, so main.js never loads the SDK.
export * from './db/client.js';
export { PrismaModule } from './db/prisma.module.js';
export { PrismaService } from './db/prisma.service.js';
