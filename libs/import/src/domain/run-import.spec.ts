import { beforeEach, describe, expect, it } from '@jest/globals';
import { parseCatalog } from './parse-catalog.js';
import type { CatalogSource } from './ports.js';
import { type RunImportOptions, runImport, WINDOWS_1252_ISSUE } from './run-import.js';
import {
  catalogCsv,
  csvLine,
  fixedClock,
  InMemoryImportStore,
  memorySource,
  recordingLogger,
} from './testing/in-memory-import.js';
import { CsvFileError } from './types.js';

// The import flow against in-memory fakes of the ports. These are the cases of the v1 import
// e2e suite at unit speed. apps/catalog-import/test still runs them against PostgreSQL.

const clock = fixedClock();
let store: InMemoryImportStore;
let logger: ReturnType<typeof recordingLogger>;

beforeEach(() => {
  store = new InMemoryImportStore(clock);
  logger = recordingLogger();
});

function run(source: CatalogSource, options: RunImportOptions = {}) {
  return runImport({ source, uow: store, options, clock, logger });
}

const skus = (count: number) => Array.from({ length: count }, (_, i) => `P-${1001 + i}`);
const exportOf = (list: string[]) => memorySource(catalogCsv(list.map((sku) => csvLine(sku))));

/** Store the products of a file as a previous import would have left them. */
function seedFrom(list: string[]): void {
  store.seed(parseCatalog(catalogCsv(list.map((sku) => csvLine(sku)))).products);
}

describe('runImport', () => {
  it('imports a file into an empty catalogue and closes the run as SUCCEEDED', async () => {
    const summary = await run(exportOf(skus(3)));

    expect(summary).toMatchObject({
      status: 'SUCCEEDED',
      file: 'memory:products.csv',
      rowsRead: 3,
      valid: 3,
      created: 3,
      updated: 0,
      unchanged: 0,
      markedMissing: 0,
    });
    expect(store.listedSkus()).toEqual(skus(3));
    const run1 = store.runs.get(summary.runId as string);
    expect(run1).toMatchObject({ source: 'memory:products.csv', status: 'SUCCEEDED', error: null });
    expect(run1?.summary).toMatchObject({ created: 3 });
  });

  it('changes nothing on a second run of the same file', async () => {
    await run(exportOf(skus(3)));
    const before = structuredClone([...store.products.values()]);

    const summary = await run(exportOf(skus(3)));

    expect(summary).toMatchObject({
      status: 'SUCCEEDED',
      created: 0,
      updated: 0,
      unchanged: 3,
      markedMissing: 0,
    });
    expect([...store.products.values()]).toEqual(before);
  });

  it('updates a changed product and keeps its rating columns', async () => {
    await run(exportOf(skus(3)));
    (store.products.get('P-1001') as { reviewCount: number }).reviewCount = 2;

    const summary = await run(
      memorySource(catalogCsv([csvLine('P-1001', 'New name'), csvLine('P-1002'), csvLine('P-1003')])),
    );

    expect(summary).toMatchObject({ created: 0, updated: 1, unchanged: 2 });
    expect(store.products.get('P-1001')).toMatchObject({ name: 'New name', reviewCount: 2, writes: 2 });
  });

  it('aborts when the file has fewer than half of the listed products, and --force imports it', async () => {
    seedFrom(skus(10));
    // One changed row and one new SKU, so a write placed before the guard would show.
    const truncated = memorySource(
      catalogCsv([csvLine('P-1001', 'Changed'), csvLine('P-1002'), csvLine('P-1003'), csvLine('P-2001')]),
    );

    const aborted = await run(truncated);
    expect(aborted).toMatchObject({ status: 'ABORTED', created: 0, updated: 0, markedMissing: 0 });
    expect(aborted.message).toMatch(/4 valid products but the catalogue lists 10/);
    expect(store.upsertCalls).toEqual([]);
    expect(store.markMissingCalls).toEqual([]);
    expect(store.products.size).toBe(10);
    expect(store.products.get('P-1001')).toMatchObject({ name: 'Product P-1001', writes: 0 });
    expect(store.listedSkus()).toHaveLength(10);
    expect(store.runs.get(aborted.runId as string)).toMatchObject({
      status: 'ABORTED',
      error: aborted.message,
    });

    const forced = await run(truncated, { force: true });
    expect(forced).toMatchObject({
      status: 'SUCCEEDED',
      created: 1,
      updated: 1,
      unchanged: 2,
      markedMissing: 7,
    });
    expect(store.listedSkus()).toEqual(['P-1001', 'P-1002', 'P-1003', 'P-2001']);
    expect(store.products.size).toBe(11);
  });

  it('ends as LOCKED and writes no product when another import holds the lock', async () => {
    store.lockHeldElsewhere = true;
    let afterLockCalled = false;

    const summary = await run(exportOf(skus(3)), {
      afterLock: () => {
        afterLockCalled = true;
        return Promise.resolve();
      },
    });

    expect(summary).toMatchObject({
      status: 'LOCKED',
      created: 0,
      updated: 0,
      unchanged: 0,
      markedMissing: 0,
    });
    expect(summary.message).toMatch(/Another import is running/);
    expect(afterLockCalled).toBe(false);
    expect(store.products.size).toBe(0);
    // The run status enum has no LOCKED, so the run log closes it as ABORTED with the message.
    expect(store.runs.get(summary.runId as string)).toMatchObject({
      status: 'ABORTED',
      error: summary.message,
    });
  });

  it('rolls back every product write when a write fails, and marks the run FAILED', async () => {
    seedFrom(skus(2));
    store.failing.add('markMissing');
    const before = structuredClone([...store.products.values()]);

    await expect(run(exportOf(skus(4)))).rejects.toThrow('markMissing failed');

    // upsert wrote P-1003 and P-1004 into the transaction before markMissing threw.
    expect([...store.products.values()]).toEqual(before);
    const [failed] = [...store.runs.values()];
    expect(failed).toMatchObject({ status: 'FAILED', error: 'markMissing failed' });
    expect(logger.errors).toEqual([]);
  });

  it('rolls back the products when the run log cannot be finished', async () => {
    store.failing.add('finish');

    await expect(run(exportOf(skus(3)))).rejects.toThrow('finish failed');

    expect(store.products.size).toBe(0);
    expect([...store.runs.values()][0]).toMatchObject({ status: 'FAILED', error: 'finish failed' });
  });

  it('does not mark a product missing when its row is rejected', async () => {
    seedFrom(skus(3));
    // P-1001 has no name, so its row is rejected. It still counts as seen.
    const file = memorySource(catalogCsv([csvLine('P-1001', ''), csvLine('P-1002'), csvLine('P-1003')]));

    const summary = await run(file);

    expect(summary).toMatchObject({ status: 'SUCCEEDED', rejected: 1, markedMissing: 0, unchanged: 2 });
    expect(store.products.get('P-1001')).toMatchObject({ name: 'Product P-1001', inLatestExport: true });
  });

  it('rejects only the row whose facet values are too long for the facet index, and imports the rest', async () => {
    // 20 certifications of 100 characters, mostly umlauts: about 3,950 bytes, over the B-tree limit of 2,704.
    const many = Array.from({ length: 20 }, (_, i) => `${i}`.padStart(100, 'ü')).join('|');
    const long = csvLine('P-1002').replace(',Vegan,', `,${many},`);
    const file = memorySource(catalogCsv([csvLine('P-1001'), long, csvLine('P-1003')]));

    const summary = await run(file);

    expect(summary).toMatchObject({ status: 'SUCCEEDED', created: 2, rejected: 1 });
    expect(summary.issues).toEqual([expect.objectContaining({ line: 3, sku: 'P-1002', level: 'error' })]);
    expect(summary.issues[0]?.message).toMatch(/^Row rejected: function, application area, region and/);
    expect(store.listedSkus()).toEqual(['P-1001', 'P-1003']);
  });

  it('passes markMissing only the rejected SKUs the catalogue knows, so a NUL never reaches the database', async () => {
    seedFrom(skus(2));
    // Both rows break the SKU rule. PostgreSQL text cannot hold the NUL of the second one.
    const file = memorySource(
      catalogCsv([csvLine('P-1001'), csvLine('P-1002'), csvLine('P-1\u{200B}3'), csvLine('P-1\u00004')]),
    );

    const summary = await run(file);

    expect(summary).toMatchObject({ status: 'SUCCEEDED', rejected: 2, markedMissing: 0 });
    expect(store.markMissingCalls).toEqual([['P-1001', 'P-1002']]);
  });

  it('hides a product that left the export and lists it again when it comes back', async () => {
    await run(exportOf(skus(3)));

    const hidden = await run(exportOf(['P-1002', 'P-1003']));
    expect(hidden).toMatchObject({ markedMissing: 1, unchanged: 2 });
    expect(store.products.get('P-1001')?.inLatestExport).toBe(false);

    const back = await run(exportOf(skus(3)));
    expect(back).toMatchObject({ created: 0, updated: 1, unchanged: 2, markedMissing: 0 });
    expect(store.products.get('P-1001')?.inLatestExport).toBe(true);
  });

  it('marks the run FAILED and writes no product when the file is broken', async () => {
    await expect(run(memorySource('sku,name\nP-1,Name\n'))).rejects.toThrow(/Missing column/);

    expect(store.products.size).toBe(0);
    expect([...store.runs.values()][0]).toMatchObject({
      status: 'FAILED',
      error: expect.stringMatching(/chemical_name/),
    });
  });

  it('writes nothing in a dry run, not even a run, and still reports the plan', async () => {
    seedFrom(skus(2));

    const summary = await run(exportOf(['P-1002', 'P-1003']), { dryRun: true });

    expect(summary).toMatchObject({
      status: 'DRY_RUN',
      runId: null,
      created: 1,
      unchanged: 1,
      markedMissing: 1,
    });
    expect(store.listedSkus()).toEqual(['P-1001', 'P-1002']);
    expect(store.runs.size).toBe(0);
    expect(store.sweeps).toEqual([]);
  });

  it('reads a Windows-1252 export and logs a warning with the source name', async () => {
    const text = catalogCsv([csvLine('P-1001', 'Kräuterbasis für Hautpflege')]);
    // latin1 writes one byte per character. For "ä" (0xE4) and "ü" (0xFC) that is the Windows-1252 byte too.
    const bytes = new Uint8Array(Buffer.from(text, 'latin1'));

    const summary = await run(memorySource(bytes, 'file:/exports/pim.csv'));

    expect(summary).toMatchObject({ status: 'SUCCEEDED', created: 1 });
    expect(store.products.get('P-1001')?.name).toBe('Kräuterbasis für Hautpflege');
    expect(logger.warnings).toEqual([
      'file:/exports/pim.csv is not valid UTF-8, so it was read as Windows-1252.',
    ]);
    // The fallback also shows in the summary and in the run record.
    const issue = { line: 1, level: 'warning', message: WINDOWS_1252_ISSUE };
    expect(summary.issues).toEqual([issue]);
    expect(store.runs.get(summary.runId as string)?.summary?.issues).toEqual([issue]);
  });

  it('fails the run and writes nothing when a UTF-8 export has one broken byte', async () => {
    seedFrom(skus(1));
    const before = structuredClone([...store.products.values()]);
    // "ä" and "ü" as C3 A4 and C3 BC in the first row, a stray Windows-1252 0xE4 in the second.
    const head = new TextEncoder().encode(catalogCsv([csvLine('P-1001', 'Kräuterbasis für Hautpflege')]));
    const bytes = new Uint8Array([...head, ...new TextEncoder().encode('P-1002,Kr'), 0xe4, 0x0a]);

    await expect(run(memorySource(bytes, 'file:/exports/pim.csv'))).rejects.toThrow(CsvFileError);

    expect([...store.products.values()]).toEqual(before);
    const [failed] = [...store.runs.values()];
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toMatch(
      /^file:\/exports\/pim\.csv is broken UTF-8: it holds more valid UTF-8 characters \(2\) than bad bytes \(1\)/,
    );
    expect(logger.warnings).toEqual([]);
  });
});
