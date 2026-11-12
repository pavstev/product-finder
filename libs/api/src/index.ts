export { CatalogModule } from './catalog/catalog.module.js';
export { ReviewsModule } from './reviews/reviews.module.js';
// The e2e tests use its beforeAggregateUpdate seam.
export { ReviewsService } from './reviews/reviews.service.js';
export { configureApp } from './http/configure-app.js';
export { ApiProblemResponse, buildOpenApiDocument, setupSwagger, toStableJson } from './http/openapi.js';
export { ProbeUnavailableException } from './http/problem-details.filter.js';
export { RateLimitGuard, rateLimitOptions } from './http/rate-limit.guard.js';
