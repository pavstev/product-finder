import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { MAX_SKU_LENGTH, skuProblem } from '@product-finder/shared';

// Checks the `:sku` path parameter before it reaches the database. The rule lives in shared, as in the import.
// It does not force the "P-" prefix, because other business units may use other formats.
// Upper-casing stays in the services (normalizeSku).
@Injectable()
export class ParseSkuPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('The SKU must be text.');
    }
    const sku = value.trim();
    const problem = skuProblem(sku);
    if (problem === 'length') {
      throw new BadRequestException(`The SKU must be 1 to ${MAX_SKU_LENGTH} characters long.`);
    }
    if (problem === 'characters') {
      throw new BadRequestException('The SKU must not contain control or format characters.');
    }
    return sku;
  }
}
