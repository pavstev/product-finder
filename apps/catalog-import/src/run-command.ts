import { ConfigError, EXIT_CODES } from '@product-finder/import';
import type { AppConfig } from '@product-finder/server/client';

/** One sub-command. Gets the arguments after its name and the validated config. Returns the exit code. */
export type Command = (args: readonly string[], config: AppConfig) => Promise<number>;

const COMMAND_USAGE =
  'Usage: main.js <migrate|import|seed|status>. import takes [--file <path>] [--force] [--dry-run]. status takes [--json].';

/** The config loads first, for every sub-command, so a bad config exits with 4 for all of them. */
export async function runCommand(
  argv: readonly string[],
  commands: Record<string, Command>,
  loadConfig: () => AppConfig,
): Promise<number> {
  if (argv.length === 0) {
    console.error(`Missing command. ${COMMAND_USAGE}`);
    return EXIT_CODES.badArguments;
  }
  const [name, ...args] = argv;
  // Own keys only, so a name like "constructor" is unknown too.
  if (!Object.hasOwn(commands, name)) {
    console.error(`Unknown command '${name}'. ${COMMAND_USAGE}`);
    return EXIT_CODES.badArguments;
  }
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`${name} failed: ${(error as Error).message}`);
    return error instanceof ConfigError ? EXIT_CODES.badArguments : EXIT_CODES.failed;
  }
  try {
    return await commands[name](args, config);
  } catch (error) {
    console.error(`${name} failed: ${(error as Error).message}`);
    return EXIT_CODES.failed;
  }
}
