import {
  CERTIFICATIONS_MAX,
  codePointLength,
  displaySku,
  FACET_BYTES_MAX,
  FACET_VALUE_MAX,
  MAX_SKU_LENGTH,
  normalizeSku,
  PRODUCT_NAME_MAX,
  skuProblem,
} from '@product-finder/shared';
import type { ImportIssue, NormalizeResult, ProductStatusValue, RawRow } from './types.js';

/** Trim and collapse inner runs of whitespace to one space. */
function cleanText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

const STATUS_BY_KEY: Record<string, ProductStatusValue> = {
  active: 'ACTIVE',
  phaseout: 'PHASE_OUT',
  discontinued: 'DISCONTINUED',
};

/** `Active`, `ACTIVE`, `Phase out`, `Phase-out`, `phase_out` are all accepted. Unknown values give null. */
export function parseStatus(value: string): ProductStatusValue | null {
  const key = value.toLowerCase().replace(/[\s_-]+/g, '');
  return STATUS_BY_KEY[key] ?? null;
}

/** A 4-digit year between 1900 and next year, else null. */
export function parseLaunchYear(value: string, currentYear: number): number | null {
  if (!/^\d{4}$/.test(value)) {
    return null;
  }
  const year = Number(value);
  return year >= 1900 && year <= currentYear + 1 ? year : null;
}

/** Split on `|`, trim, drop empty, de-duplicate, sort alphabetically. */
export function parseCertifications(value: string): string[] {
  const items = value
    .split('|')
    .map(cleanText)
    .filter((item) => item.length > 0);
  return [...new Set(items)].sort((a, b) => a.localeCompare(b, 'en'));
}

const REQUIRED = [
  ['sku', 'sku'],
  ['name', 'name'],
  ['function', 'function'],
  ['application_area', 'application area'],
  ['region', 'region'],
  ['status', 'status'],
] as const;

const FACET_LABELS = [
  ['function', 'function'],
  ['applicationArea', 'application area'],
  ['region', 'region'],
] as const;

interface Facets {
  function: string;
  applicationArea: string;
  region: string;
  certifications: string[];
}

/** Why the facet values cannot be stored, or null. An oversized product_facets_idx entry would fail the import. */
function facetProblem(facets: Facets): string | null {
  for (const [field, label] of FACET_LABELS) {
    if (codePointLength(facets[field]) > FACET_VALUE_MAX) {
      return `the ${label} must be at most ${FACET_VALUE_MAX} characters long.`;
    }
  }
  const { certifications } = facets;
  if (certifications.some((item) => codePointLength(item) > FACET_VALUE_MAX)) {
    return `each certification must be at most ${FACET_VALUE_MAX} characters long.`;
  }
  if (certifications.length > CERTIFICATIONS_MAX) {
    return `a product can have at most ${CERTIFICATIONS_MAX} certifications, this row has ${certifications.length}.`;
  }
  const values = [facets.function, facets.applicationArea, facets.region, ...certifications];
  const bytes = values.reduce((sum, value) => sum + utf8Length(value), 0);
  if (bytes > FACET_BYTES_MAX) {
    return (
      'function, application area, region and certifications together must be at most ' +
      `${FACET_BYTES_MAX} bytes, this row has ${bytes}.`
    );
  }
  return null;
}

const UTF8 = new TextEncoder();

/** UTF-8 bytes of the text. TextEncoder, not Buffer, so the domain stays free of Node APIs. */
function utf8Length(text: string): number {
  return UTF8.encode(text).length;
}

/** The first reason the row cannot be used, from the checks that need no cleaned facets. */
function basicProblem(raw: RawRow, sku: string | undefined, name: string): string | null {
  const { fields } = raw;
  if (raw.problem) {
    return `Row rejected: ${raw.problem}`;
  }
  const missing = REQUIRED.filter(([column]) => cleanText(fields[column]) === '').map(([, label]) => label);
  if (missing.length > 0) {
    return `Row rejected: missing ${missing.join(', ')}.`;
  }
  // The API refuses such SKUs with 400, so a product with one could be listed but never opened.
  const problem = skuProblem(sku as string);
  if (problem === 'length') {
    return `Row rejected: the SKU must be 1 to ${MAX_SKU_LENGTH} characters long.`;
  }
  if (problem === 'characters') {
    return 'Row rejected: the SKU must not contain control or format characters.';
  }
  // A longer name would give a name-sorted search cursor that the API cannot take back.
  if (codePointLength(name) > PRODUCT_NAME_MAX) {
    return `Row rejected: the name must be at most ${PRODUCT_NAME_MAX} characters long.`;
  }
  return null;
}

function launchYearIssue(line: number, sku: string | undefined, rawYear: string): ImportIssue {
  const message =
    rawYear === ''
      ? 'Launch year is empty. Stored as unknown.'
      : `Invalid launch year "${rawYear}". Stored as unknown.`;
  return { line, sku, level: 'warning', message };
}

function rejection(line: number, sku: string | undefined, message: string): NormalizeResult {
  return {
    ok: false,
    line,
    sku,
    issues: [{ line, sku: sku === undefined ? undefined : displaySku(sku), level: 'error', message }],
  };
}

function readFacets(fields: RawRow['fields']): Facets {
  return {
    function: cleanText(fields.function),
    applicationArea: cleanText(fields.application_area),
    region: cleanText(fields.region),
    certifications: parseCertifications(fields.certifications),
  };
}

/** Clean one CSV row. A rejected SKU still counts as seen, so a bad row never hides a product. */
export function normalizeRow(raw: RawRow, currentYear = new Date().getFullYear()): NormalizeResult {
  const { line, fields } = raw;
  const sku = normalizeSku(cleanText(fields.sku)) || undefined;
  const name = cleanText(fields.name);
  const basic = basicProblem(raw, sku, name);
  if (basic) {
    return rejection(line, sku, basic);
  }

  const facets = readFacets(fields);
  const facetError = facetProblem(facets);
  if (facetError) {
    return rejection(line, sku, `Row rejected: ${facetError}`);
  }

  const rawStatus = cleanText(fields.status);
  const status = parseStatus(rawStatus);
  if (!status) {
    return rejection(line, sku, `Row rejected: unknown status "${rawStatus}".`);
  }

  // A bad launch year is stored as null with a warning.
  const rawYear = cleanText(fields.launch_year);
  const launchYear = parseLaunchYear(rawYear, currentYear);
  return {
    ok: true,
    line,
    issues: launchYear === null ? [launchYearIssue(line, sku, rawYear)] : [],
    record: {
      sku: sku as string,
      name,
      chemicalName: cleanText(fields.chemical_name) || null,
      ...facets,
      status,
      launchYear,
      description: cleanText(fields.description) || null,
    },
  };
}
