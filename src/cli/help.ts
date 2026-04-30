import type { CommandName } from "./args.js";
import type { CliResultWriter } from "./output.js";

const helpText = `Usage: migratorosaurus <command> [options]

Commands:
  up                Apply pending migrations
  down              Roll back applied migrations
  validate          Validate migration environment and state
  create            Create a new migration file

Global options:
  --json                    Emit structured command results and logs
  --quiet                   Suppress non-error logs
  --verbose, -v             Show debug logs
  --no-color                Disable ANSI color in logs

Run "migratorosaurus <command> --help" for command-specific usage.
`;

const createHelpText = `Usage: migratorosaurus create --name <name> [options]

Options:
  -n, --name <name>         Migration name slug
  -d, --directory <dir>     Output directory, defaults to MIGRATION_DIRECTORY or migrations
  --json                    Emit structured command result and logs
  --quiet                   Suppress non-error logs
  --verbose, -v             Show debug logs
  --no-color                Disable ANSI color in logs
  -h, --help                Show this help text

Notes:
  - Creates <YYYYMMDDHHMMSS>_<name>.sql
  - File template includes:
      -- migrate:up
      -- migrate:down

Examples:
  migratorosaurus create --name create_users
  migratorosaurus create --directory sql/migrations --name add_user_index
`;

const upHelpText = `Usage: migratorosaurus up [options] [<database-url>]

Options:
  --url <database-url>      Database URL (alternative to positional URL)
  -d, --directory <dir>     Migrations directory, defaults to MIGRATION_DIRECTORY or migrations
  -t, --target <target>     Apply pending migrations up to and including target
  --table <table-name>      Migration history table, defaults to migration_history
  --dry-run                 Run planned SQL and history writes, then roll back
  --json                    Emit structured command result and logs
  --quiet                   Suppress non-error logs
  --verbose, -v             Show debug logs
  --no-color                Disable ANSI color in logs
  -h, --help                Show this help text

Behavior:
  - Without --target, applies all pending migrations.
  - --target accepts <YYYYMMDDHHMMSS> or <YYYYMMDDHHMMSS>_<slug>.sql.
  - Provide exactly one of positional <database-url> or --url; otherwise DATABASE_URL is used.
  - --directory takes precedence over MIGRATION_DIRECTORY.

Examples:
  migratorosaurus up postgres://localhost:5432/app
  migratorosaurus up --url postgres://localhost:5432/app --target 20260416090000
  migratorosaurus up --url postgres://localhost:5432/app --target 20260416090000_create.sql
  migratorosaurus up --dry-run
`;

const downHelpText = `Usage: migratorosaurus down [options] [<database-url>]

Options:
  --url <database-url>      Database URL (alternative to positional URL)
  -d, --directory <dir>     Migrations directory, defaults to MIGRATION_DIRECTORY or migrations
  -t, --target <target>     Roll back newer migrations; target remains applied
  --table <table-name>      Migration history table, defaults to migration_history
  --dry-run                 Run planned SQL and history writes, then roll back
  --json                    Emit structured command result and logs
  --quiet                   Suppress non-error logs
  --verbose, -v             Show debug logs
  --no-color                Disable ANSI color in logs
  -h, --help                Show this help text

Behavior:
  - Without --target, rolls back exactly one migration (latest applied).
  - With --target, target migration is excluded from rollback and stays applied.
  - --target accepts <YYYYMMDDHHMMSS> or <YYYYMMDDHHMMSS>_<slug>.sql.
  - Provide exactly one of positional <database-url> or --url; otherwise DATABASE_URL is used.
  - --directory takes precedence over MIGRATION_DIRECTORY.

Examples:
  migratorosaurus down postgres://localhost:5432/app
  migratorosaurus down --target 20260416090000_create.sql
  migratorosaurus down --dry-run
`;

const validateHelpText = `Usage: migratorosaurus validate [options] [<database-url>]

Options:
  --url <database-url>      Database URL (alternative to positional URL)
  -d, --directory <dir>     Migrations directory, defaults to MIGRATION_DIRECTORY or migrations
  --table <table-name>      Migration history table, defaults to migration_history
  --json                    Emit structured command result and logs
  --quiet                   Suppress non-error logs
  --verbose, -v             Show debug logs
  --no-color                Disable ANSI color in logs
  -h, --help                Show this help text

Behavior:
  - Validates migration files, order, and applied migration history consistency.
  - Checks database connectivity and migration history table state.
  - Does not create missing migration history tables.
  - Uses the same advisory lock as up/down; fails fast if another migratorosaurus process holds it.
  - Provide exactly one of positional <database-url> or --url; otherwise DATABASE_URL is used.
  - --directory takes precedence over MIGRATION_DIRECTORY.

Examples:
  migratorosaurus validate postgres://localhost:5432/app
  migratorosaurus validate --url postgres://localhost:5432/app --table migration_history
`;

function helpTextFor(command: CommandName | undefined): string {
  switch (command) {
    case "create":
      return createHelpText;
    case "up":
      return upHelpText;
    case "down":
      return downHelpText;
    case "validate":
      return validateHelpText;
    case undefined:
      return helpText;
  }
}

/**
 * Writes human or JSON help output for a command.
 */
export function writeHelp(
  resultWriter: CliResultWriter,
  command: CommandName | undefined,
  json: boolean,
): void {
  const help = helpTextFor(command);

  if (json) {
    resultWriter.writeJson({
      command: command ?? null,
      help,
      ok: true,
    });
    return;
  }

  resultWriter.writeText(help);
}
