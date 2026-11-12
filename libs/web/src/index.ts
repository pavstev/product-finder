// Public API of the web lib, for the app shell. It starts with the app, so it exports no page.
// The three pages are lazy routes with their own entries (@product-finder/web/search, /product, /not-found).
export { CatalogApi } from './data-access/catalog-api.service';
export { NavigationHistory } from './data-access/navigation-history.service';
export { PageTitle } from './ui/page-title.service';
