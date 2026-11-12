import type { Routes } from '@angular/router';

// The search and product pages set their own tab title through PageTitle.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'products' },
  {
    path: 'products',
    loadComponent: () => import('@product-finder/web/search').then((m) => m.ProductSearchPage),
  },
  {
    path: 'products/:sku',
    // Shown while the product loads.
    title: 'Product details | Product Finder',
    loadComponent: () => import('@product-finder/web/product').then((m) => m.ProductDetailPage),
  },
  {
    path: '**',
    title: 'Page not found | Product Finder',
    // Its own entry, so this stays a lazy chunk.
    loadComponent: () => import('@product-finder/web/not-found').then((m) => m.NotFoundPage),
  },
];
