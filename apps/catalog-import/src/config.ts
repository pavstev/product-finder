import { ConfigError } from '@product-finder/import';
import { type AppConfig, loadConfig } from '@product-finder/server/client';

/** A bad or missing variable is a ConfigError, which every sub-command turns into exit code 4. */
export function loadImportConfig(env?: Readonly<Record<string, string | undefined>>): AppConfig {
  try {
    return loadConfig(env);
  } catch (error) {
    throw new ConfigError((error as Error).message, { cause: error });
  }
}
