import type { CommandName } from "./args.js";
import type { CliResultWriter } from "./output.js";

const helpText = `Usage: pg-migrate <command> [options]

Commands:
  up                Apply pending migrations
  down              Roll back applied migrations
  status            Show applied and pending migration state
  validate          Validate migration environment and state
  create            Create a new migration file

Global options:
  --json                    Emit structured command results and logs
  --quiet                   Suppress non-error logs
  --verbose, -v             Show debug logs
  --no-color                Disable ANSI color in logs

Run "pg-migrate <command> --help" for command-specific usage.
`;

const createHelpText = `Usage: pg-migrate create --name <name> [options]

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
  pg-migrate create --name create_users
  pg-migrate create --directory sql/migrations --name add_user_index
`;

const upHelpText = `Usage: pg-migrate up [options] [<database-url>]

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
  pg-migrate up postgres://localhost:5432/app
  pg-migrate up --url postgres://localhost:5432/app --target 20260416090000
  pg-migrate up --url postgres://localhost:5432/app --target 20260416090000_create.sql
  pg-migrate up --dry-run
`;

const downHelpText = `Usage: pg-migrate down [options] [<database-url>]

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
  pg-migrate down postgres://localhost:5432/app
  pg-migrate down --target 20260416090000_create.sql
  pg-migrate down --dry-run
`;

const validateHelpText = `Usage: pg-migrate validate [options] [<database-url>]

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
  - Uses the same advisory lock as up/down/status; fails fast if another pg-migrate process holds it.
  - Provide exactly one of positional <database-url> or --url; otherwise DATABASE_URL is used.
  - --directory takes precedence over MIGRATION_DIRECTORY.

Examples:
  pg-migrate validate postgres://localhost:5432/app
  pg-migrate validate --url postgres://localhost:5432/app --table migration_history
`;

const statusHelpText = `Usage: pg-migrate status [options] [<database-url>]

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
  - Shows current, next, applied, pending, and per-file migration state.
  - Current means the latest applied migration by file order.
  - Validates migration files and applied migration history consistency.
  - Does not create missing migration history tables; reports initialized=false instead.
  - Uses the same advisory lock as up/down/validate; fails fast if another pg-migrate process holds it.
  - Provide exactly one of positional <database-url> or --url; otherwise DATABASE_URL is used.
  - --directory takes precedence over MIGRATION_DIRECTORY.

Examples:
  pg-migrate status postgres://localhost:5432/app
  pg-migrate status --url postgres://localhost:5432/app --table migration_history
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
    case "status":
      return statusHelpText;
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
