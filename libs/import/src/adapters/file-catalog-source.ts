import { readFile } from 'node:fs/promises';
import type { CatalogSource } from '../domain/ports.js';

export class FileCatalogSource implements CatalogSource {
  constructor(private readonly file: string) {}

  describe(): string {
    return `file:${this.file}`;
  }

  read(): Promise<Uint8Array> {
    return readFile(this.file);
  }
}
