import { type PrismaClient, recomputeRatings } from '@product-finder/server/client';
import type { ImportSummary } from '../domain/types.js';
// A JSON module: webpack bundles it, so the seed needs no path to it at run time.
import demoReviews from './demo-reviews.json';
import { type ImportOptions, importCatalog } from './import-catalog.js';

interface DemoReview {
  id: string;
  sku: string;
  rating: number;
  title: string | null;
  body: string;
  authorName: string;
  createdAt: string;
}

const DEMO_REVIEWS: readonly DemoReview[] = demoReviews;

/** Fixed ids and skipDuplicates make it safe to run again. Unknown SKUs are skipped. Only their rating aggregates are rebuilt. */
export async function seedDemoReviews(prisma: PrismaClient): Promise<{ inserted: number; skipped: number }> {
  const skus = [...new Set(DEMO_REVIEWS.map((review) => review.sku))];
  const products = await prisma.product.findMany({
    where: { sku: { in: skus } },
    select: { id: true, sku: true },
  });
  const idBySku = new Map(products.map((product) => [product.sku, product.id]));

  const data = DEMO_REVIEWS.filter((review) => idBySku.has(review.sku)).map((review) => ({
    id: review.id,
    productId: idBySku.get(review.sku) as string,
    rating: review.rating,
    title: review.title,
    body: review.body,
    authorName: review.authorName,
    createdAt: new Date(review.createdAt),
  }));

  const inserted = await prisma.$transaction(async (tx) => {
    const result = await tx.review.createMany({ data, skipDuplicates: true });
    await recomputeRatings(tx, [...idBySku.keys()]);
    return result.count;
  });
  return { inserted, skipped: DEMO_REVIEWS.length - inserted };
}

export interface SeedOptions extends ImportOptions {
  /** Add the demo reviews after a successful import. */
  demoReviews: boolean;
}

export interface SeedResult {
  summary: ImportSummary;
  /** Null when demo reviews are off or the import did not succeed. */
  demoReviews: { inserted: number; skipped: number } | null;
}

/** Import the catalogue, then add the demo reviews. They are opt-in, so real data never gets fake reviews. */
export async function runSeed(
  prisma: PrismaClient,
  { demoReviews: withDemoReviews, ...options }: SeedOptions,
): Promise<SeedResult> {
  const summary = await importCatalog(prisma, options);
  if (summary.status !== 'SUCCEEDED' || !withDemoReviews) {
    return { summary, demoReviews: null };
  }
  return { summary, demoReviews: await seedDemoReviews(prisma) };
}
