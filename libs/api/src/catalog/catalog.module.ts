import { Module } from '@nestjs/common';
import { CatalogVersion } from './catalog-version.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

@Module({
  controllers: [ProductsController, CatalogController],
  providers: [ProductsService, CatalogService, CatalogVersion],
})
export class CatalogModule {}
