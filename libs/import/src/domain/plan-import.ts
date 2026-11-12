import type { ExistingProduct, PreparedProduct } from './types.js';

export interface ImportPlan {
  toCreate: PreparedProduct[];
  toUpdate: PreparedProduct[];
  unchanged: number;
  /** SKUs that are listed today but are not in the file. They get inLatestExport = false. */
  missingSkus: string[];
}

/** Diff the database against the file. `rejectedSkus` count as seen: a bad row must not hide a product. */
export function planImport(
  existing: ExistingProduct[],
  incoming: PreparedProduct[],
  rejectedSkus: Iterable<string> = [],
): ImportPlan {
  const known = new Map(existing.map((product) => [product.sku, product]));
  const seen = new Set<string>(rejectedSkus);
  const plan: ImportPlan = { toCreate: [], toUpdate: [], unchanged: 0, missingSkus: [] };

  for (const product of incoming) {
    seen.add(product.sku);
    const current = known.get(product.sku);
    if (!current) {
      plan.toCreate.push(product);
    } else if (current.sourceHash !== product.sourceHash || !current.inLatestExport) {
      plan.toUpdate.push(product);
    } else {
      plan.unchanged += 1;
    }
  }

  for (const product of existing) {
    if (product.inLatestExport && !seen.has(product.sku)) {
      plan.missingSkus.push(product.sku);
    }
  }

  return plan;
}

/** Share of the current catalogue a file must contain. Below it the run aborts (unless forced). */
const GUARD_RATIO = 0.5;

/** True when the file looks truncated: the database lists N > 0 products, the file has fewer than N / 2 records. */
export function guardTrips(listedInDb: number, validInFile: number): boolean {
  return listedInDb > 0 && validInFile < listedInDb * GUARD_RATIO;
}
