// Types, Angular HttpClient client, SDK and HttpRequest builders, made from the API contract.
// Paths are relative to the workspace root, where Nx runs the generator.
import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: 'dist/contracts/openapi.json',
  output: 'libs/web/src/data-access/generated',
  plugins: [
    '@hey-api/typescript',
    '@hey-api/client-angular',
    '@hey-api/sdk',
    // Typed HttpRequest builders. The CatalogApi facade sends them with HttpClient.request,
    // so unsubscribing cancels the request. The SDK functions return Promises and cannot cancel.
    { name: '@angular/common', httpRequests: true, httpResources: false },
  ],
});
