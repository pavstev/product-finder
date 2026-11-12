// Prisma CLI config (migrations and `prisma db seed`).
// Local env is apps/api/.env, by explicit path. Real env vars win. A missing file is fine.
import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

dotenv.config({ path: path.resolve(__dirname, '../../apps/api/.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'nx run catalog-import:seed',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
