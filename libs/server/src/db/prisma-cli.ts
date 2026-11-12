import { createRequire } from 'node:module';
import path from 'node:path';

// Relative to the working directory: the workspace root for Nx, /app in the catalog-import image.
export const PRISMA_CONFIG = 'libs/server/prisma.config.ts';

// Resolved at run time, so webpack leaves it alone.
export function prismaCliEntry(from = process.argv[1] ?? path.join(process.cwd(), 'main.js')): string {
  return createRequire(from).resolve('prisma/build/index.js');
}
