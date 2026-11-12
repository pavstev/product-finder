import { Injectable } from '@nestjs/common';
import { PrismaService } from '@product-finder/server';
import { isCatalogStale } from '@product-finder/shared';
import { CatalogVersion } from './catalog-version.js';
import type { CatalogStatusDto } from './dto/catalog-status.dto.js';
import { listedWhere } from './products.query.js';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogVersion: CatalogVersion,
  ) {}

  async status(): Promise<CatalogStatusDto> {
    const [latest, listedProducts] = await Promise.all([
      this.catalogVersion.latest(),
      this.prisma.product.count({ where: listedWhere() }),
    ]);
    const lastSuccessfulImportAt = latest.finishedAt;
    return {
      lastImportAt: lastSuccessfulImportAt,
      lastSuccessfulImportAt,
      listedProducts,
      stale: isCatalogStale(lastSuccessfulImportAt, new Date()),
    };
  }
}
