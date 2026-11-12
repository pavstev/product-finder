import path from 'node:path';

/** `--file` wins (empty counts as unset). Relative paths start at the working directory: the code runs from a bundle. */
export function resolveCatalogFile(file: string | undefined, fallback: string): string {
  return path.resolve(process.cwd(), file || fallback);
}
