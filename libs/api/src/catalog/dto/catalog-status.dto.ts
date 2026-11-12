import { ApiProperty } from '@nestjs/swagger';
import { CATALOG_STALE_AFTER_HOURS } from '@product-finder/shared';

export class CatalogStatusDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-11-12T02:00:00.000Z',
    description: 'End of the last successful import. Null before the first one.',
  })
  lastImportAt: Date | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-11-12T02:00:00.000Z',
    description:
      'Same time as lastImportAt: the end of the last SUCCEEDED import run. Null before the first one.',
  })
  lastSuccessfulImportAt: Date | null;
  @ApiProperty({
    type: 'boolean',
    example: false,
    description:
      `True when the last successful import is older than ${CATALOG_STALE_AFTER_HOURS} hours, ` +
      'or when there was none. The API stays ready: a stale catalogue never fails the readiness probe.',
  })
  stale: boolean;
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 412,
    description: 'Products shown in a default search (active and phase-out).',
  })
  listedProducts: number;
}
