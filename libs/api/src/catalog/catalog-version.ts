import { createHash } from 'node:crypto';
import { applyDecorators, Injectable } from '@nestjs/common';
import { ApiHeader, ApiResponse, type HeaderObject } from '@nestjs/swagger';
import { PrismaService } from '@product-finder/server';
import type { Request, Response } from 'express';
import { API_CONTRACT_VERSION } from '../http/openapi.js';

// The catalog version before the first successful import.
export const NO_CATALOG_VERSION = 'none';

// Shared caches and the browser may keep an answer for 60 s. After that they ask again with the ETag.
export const CATALOG_CACHE_CONTROL = 'public, max-age=60';

/** The newest SUCCEEDED import run: its id as the catalog version, and when it ended. */
interface LatestImport {
  version: string;
  /** Null before the first successful import. */
  finishedAt: Date | null;
}

/** The id of the newest SUCCEEDED import run. It commits with the products, so caches keyed by it stay fresh. */
@Injectable()
export class CatalogVersion {
  constructor(private readonly prisma: PrismaService) {}

  // One cheap read of import_run_status_finished_at_idx.
  async current(): Promise<string> {
    return (await this.latest()).version;
  }

  // The same read, with the end of that run. The catalog status needs both for its ETag.
  async latest(): Promise<LatestImport> {
    const run = await this.prisma.importRun.findFirst({
      where: { status: 'SUCCEEDED' },
      orderBy: { finishedAt: 'desc' },
      select: { id: true, finishedAt: true },
    });
    return { version: run?.id ?? NO_CATALOG_VERSION, finishedAt: run?.finishedAt ?? null };
  }
}

/**
 * `W/"<catalogVersion>-<hash of contract version and query>"`, known before any work. Weak, because nginx may gzip.
 * The contract version is in the hash: a deploy can change an answer while the data stays the same.
 */
export function catalogEtag(version: string, query: string, contract = API_CONTRACT_VERSION): string {
  const hash = createHash('sha256').update(`${contract}\n${query}`).digest('base64url').slice(0, 16);
  return `W/"${version}-${hash}"`;
}

// `stale` turns true with time alone, so the hash covers it and the import end time, and an old ETag gets a 200.
export function catalogStatusEtag(
  version: string,
  lastSuccessfulImportAt: Date | null,
  stale: boolean,
  contract = API_CONTRACT_VERSION,
): string {
  return catalogEtag(
    version,
    JSON.stringify({ lastSuccessfulImportAt: lastSuccessfulImportAt?.toISOString() ?? null, stale }),
    contract,
  );
}

/** Sets ETag and Cache-Control. True when the client has this answer: the route sends no body (304). */
export function notModified(req: Request, res: Response, etag: string): boolean {
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', CATALOG_CACHE_CONTROL);
  return req.fresh;
}

const ETAG_HEADER: HeaderObject = {
  description:
    'W/"<catalog version>-<hash>". It changes after every successful import and with info.version. ' +
    'The hash is of info.version and the query for the facets, and of info.version, lastSuccessfulImportAt ' +
    'and stale for the catalog status, which turns stale with time alone.',
  schema: { type: 'string', example: 'W/"18bc8725-0af7-4ffd-94b8-12384e7b59e5-mVNPmYe4xvmGTmJb"' },
};

const CACHE_CONTROL_HEADER: HeaderObject = {
  description: 'Clients and shared caches may keep the answer for 60 s.',
  schema: { type: 'string', example: CATALOG_CACHE_CONTROL },
};

// The headers of a 200 or 304 from a route that uses notModified.
export const CATALOG_CACHE_HEADERS = { ETag: ETAG_HEADER, 'Cache-Control': CACHE_CONTROL_HEADER };

/** The If-None-Match header and the 304 answer of a route that uses notModified. */
export function ApiNotModified(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiHeader({
      name: 'If-None-Match',
      required: false,
      description:
        'The ETag of an earlier answer. If it is still current, the answer is 304 with no body. ' +
        'A comma list of ETags works too: one current tag gives 304. `*` gives 304 as well. ' +
        'A request with `Cache-Control: no-cache` always gets 200. Express `fresh` does the check.',
      schema: { type: 'string' },
    }),
    ApiResponse({
      status: 304,
      description: 'Not modified: the ETag in If-None-Match is current. No body.',
      headers: CATALOG_CACHE_HEADERS,
    }),
  );
}
