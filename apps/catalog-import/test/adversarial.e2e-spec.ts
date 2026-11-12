import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { importCatalog } from '@product-finder/import';
import { createPrismaClient, type PrismaClient } from '@product-finder/server/client';
import { writeRawCsv } from './helpers.js';
import { resetDatabase } from './test-db.js';

// Hostile or unusual export files. The import must reject them cleanly and keep the old data.

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createPrismaClient();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('import edge cases', () => {
  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const header =
    'sku,name,chemical_name,function,application_area,region,certifications,status,launch_year,description';

  it('reports the first line of a record that spans several lines', async () => {
    const file = writeRawCsv(
      `${header}\nP-1,One,,Surfactant,Home Care,EMEA,,Active,2010,"multi\nline"\nP-2,,,Surfactant,Home Care,EMEA,,Active,2010,"a\nb"\n`,
    );
    const summary = await importCatalog(prisma, { file });
    expect(summary).toMatchObject({ created: 1, rejected: 1 });
    // P-2 starts on line 4 (header 1, P-1 on lines 2 and 3) and ends on line 5.
    expect(summary.issues).toEqual([expect.objectContaining({ sku: 'P-2', line: 4, level: 'error' })]);
    const product = await prisma.product.findUniqueOrThrow({ where: { sku: 'P-1' } });
    expect(product.description).toBe('multi line');
  });

  it('keeps the product when a later export has the same SKU in other casing', async () => {
    await importCatalog(prisma, {
      file: writeRawCsv(`${header}\np-1,One,,Surfactant,Home Care,EMEA,,Active,2010,x\n`),
    });
    const second = await importCatalog(prisma, {
      file: writeRawCsv(`${header}\nP-1,One,,Surfactant,Home Care,EMEA,,Active,2010,x\n`),
    });
    expect(second).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(await prisma.product.count()).toBe(1);
  });

  it('rejects a row with too many fields and keeps the old data', async () => {
    await importCatalog(prisma, {
      file: writeRawCsv(`${header}\nP-1,One,,Surfactant,Home Care,EMEA,,Active,2010,x\n`),
    });
    const summary = await importCatalog(prisma, {
      file: writeRawCsv(`${header}\nP-1,Changed,,Surfactant,Home Care,EMEA,,Active,2010,x,extra\n`),
      force: true,
    });
    expect(summary).toMatchObject({ rejected: 1, updated: 0, markedMissing: 0 });
    expect(await prisma.product.findUniqueOrThrow({ where: { sku: 'P-1' } })).toMatchObject({
      name: 'One',
      inLatestExport: true,
    });
  });

  it('fails cleanly on a file that is not valid CSV', async () => {
    const file = writeRawCsv(`${header}\nP-1,"unclosed,,Surfactant,Home Care,EMEA,,Active,2010,x\n`);
    await expect(importCatalog(prisma, { file })).rejects.toThrow(/not valid CSV/);
    expect(await prisma.product.count()).toBe(0);
    expect((await prisma.importRun.findFirstOrThrow()).status).toBe('FAILED');
  });
});
