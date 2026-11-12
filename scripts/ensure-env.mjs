// Copies apps/api/.env.example to apps/api/.env when .env is missing. Never overwrites an existing .env.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api');
const target = join(apiDir, '.env');
const example = join(apiDir, '.env.example');

if (existsSync(target)) {
  console.log('apps/api/.env exists, left as it is.');
} else if (!existsSync(example)) {
  console.error('apps/api/.env.example is missing, cannot create apps/api/.env.');
  process.exit(1);
} else {
  copyFileSync(example, target);
  console.log('Created apps/api/.env from apps/api/.env.example.');
}
