import { spawn as spawnProcess } from 'node:child_process';
import path from 'node:path';
import { EXIT_CODES } from '@product-finder/import';
import { PRISMA_CONFIG, prismaCliEntry } from '@product-finder/server/client';

export interface MigrateOptions {
  /** Test seam. */
  spawn?: typeof spawnProcess;
  /** The prisma CLI script. Defaults to the one installed next to the running script. */
  prismaCli?: string;
}

/** Runs `prisma migrate deploy` in a child process. Its exit code passes through. */
export function migrateCommand(options: MigrateOptions = {}): Promise<number> {
  const spawn = options.spawn ?? spawnProcess;
  const prismaCli = options.prismaCli ?? prismaCliEntry();
  const args = [prismaCli, 'migrate', 'deploy', '--config', path.resolve(process.cwd(), PRISMA_CONFIG)];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.on('error', (error) => {
      console.error(`Migrate failed: ${error.message}`);
      resolve(EXIT_CODES.failed);
    });
    child.on('exit', (code) => {
      resolve(code ?? EXIT_CODES.failed);
    });
  });
}
