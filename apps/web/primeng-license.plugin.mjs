// esbuild plugin for the web build and dev server (project.json `plugins`).
// It passes the PrimeNG key to the bundle as one compile-time constant, and nothing else.
// The key lives in apps/web/.env.local (git ignores it), as NG_PRIMENG_LICENSE=<key>. It is never
// in the tree. A variable that is already set in the environment wins over the file.
// With no key the value is '', so the app uses '' and PrimeNG shows its licence badge.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'NG_PRIMENG_LICENSE';

function readLocalFile() {
  try {
    const file = join(dirname(fileURLToPath(import.meta.url)), '.env.local');
    const line = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${NAME}=`));
    return (line?.slice(NAME.length + 1) ?? '').replace(/^["']|["']$/g, '');
  } catch {
    return '';
  }
}

export default {
  name: 'primeng-license',
  setup(build) {
    build.initialOptions.define ??= {};
    build.initialOptions.define[NAME] = JSON.stringify((process.env[NAME] ?? readLocalFile()).trim());
  },
};
