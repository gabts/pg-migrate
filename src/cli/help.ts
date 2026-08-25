import type { Command } from "./model.js";

const generalHelpText = `Usage:
  pg-migrate <command> [arguments] [options]
  pg-migrate help [command]
  pg-migrate <command> --help

Commands:
  create <name>  Create a timestamped migration file
  status         Show applied and pending migration state
  validate       Validate file structure and database history
  up             Apply pending migrations
  down           Revert applied migrations

Global options:
  -c, --config <path>    Environment file, defaults to PGM_CONFIG or .env
  -d, --directory <path> Migrations directory, defaults to PGM_DIRECTORY or migrations
  --no-color             Disable color in progress and error output
  -q, --quiet            Suppress output except errors and explicit help
  -v, --verbose          Show progress logs
  -h, --help             Show help

Configuration precedence:
  Command options, process environment, environment file, CLI defaults.

Output:
  Command output, when present, goes to stdout.
  The command header, completion messages, and errors go to stderr.
  --verbose also shows phase progress on stderr.
  --quiet suppresses normal command output; errors remain visible.

Run 'pg-migrate <command> --help' for command-specific help.`;

const createHelpText = `Usage:
  pg-migrate create <name> [options]

Creates a timestamped migration file.

Options:
  -c, --config <path>    Environment file, defaults to PGM_CONFIG or .env
  -d, --directory <path> Output directory, defaults to PGM_DIRECTORY or migrations
  --no-color             Disable color in progress and error output
  -q, --quiet            Suppress output except errors and explicit help
  -v, --verbose          Show progress logs
  -h, --help             Show this help

Behavior:
  <name> must contain lowercase letters, numbers, and underscores.
  The first character must be a letter or number.
  The file name is <YYYYMMDDHHMMSS>_<name>.sql.
  The file contains migrate:up and migrate:down sections.
  The command creates the output directory when it does not exist.

Output:
  The created file path goes to stdout.
  The command header and completion message go to stderr.
  --verbose also shows phase progress on stderr.
  --quiet suppresses normal command output; errors remain visible.

Examples:
  pg-migrate create add_users
  pg-migrate create add_users --directory db/migrations`;

const statusHelpText = `Usage:
  pg-migrate status [options]

Shows migration file and database history state.

Options:
  -c, --config <path>    Environment file, defaults to PGM_CONFIG or .env
  -d, --directory <path> Migrations directory, defaults to PGM_DIRECTORY or migrations
  -t, --table <name>     History table, defaults to PGM_TABLE or schema_migrations
  -u, --url <url>        PostgreSQL URL, or use PGM_URL
  --no-color             Disable color in progress and error output
  -q, --quiet            Suppress output except errors and explicit help
  -v, --verbose          Show progress logs
  -h, --help             Show this help

Behavior:
  The command validates all migration file names, checksums, and applied history.
  It does not decode or validate migration file contents.
  It does not create a missing history table.
  A missing history table is reported as uninitialized.
  The command does not acquire the migration advisory lock.

Output:
  Migration states and counts go to stdout.
  The command header and errors go to stderr.
  --verbose also shows phase progress on stderr.
  --quiet suppresses normal command output; errors remain visible.

Example:
  pg-migrate status --url postgres://localhost/app`;

const validateHelpText = `Usage:
  pg-migrate validate [options]

Validates migration file structure and database history.

Options:
  -c, --config <path>    Environment file, defaults to PGM_CONFIG or .env
  -d, --directory <path> Migrations directory, defaults to PGM_DIRECTORY or migrations
  -t, --table <name>     History table, defaults to PGM_TABLE or schema_migrations
  -u, --url <url>        PostgreSQL URL, or use PGM_URL
  --no-color             Disable color in progress and error output
  -q, --quiet            Suppress output except errors and explicit help
  -v, --verbose          Show progress logs
  -h, --help             Show this help

Behavior:
  The command checks UTF-8 encoding and marker structure in all migration files.
  It does not ask PostgreSQL to parse or execute migration SQL.
  A missing history table is treated as empty history and is not created.
  Applied migrations must exist on disk and form a continuous sequence.
  Applied filenames and checksums must match the database history.
  The command waits for the migration advisory lock.
  The command does not change migration data.

Output:
  Validation confirmation and migration counts go to stdout.
  The command header and errors go to stderr.
  --verbose also shows phase progress on stderr.
  --quiet suppresses normal command output; errors remain visible.

Example:
  pg-migrate validate --url postgres://localhost/app`;

const upHelpText = `Usage:
  pg-migrate up [options]

Applies pending migrations in version order.

Options:
  -c, --config <path>    Environment file, defaults to PGM_CONFIG or .env
  -d, --directory <path> Migrations directory, defaults to PGM_DIRECTORY or migrations
  -t, --table <name>     History table, defaults to PGM_TABLE or schema_migrations
  -u, --url <url>        PostgreSQL URL, or use PGM_URL
  --target <target>      Apply through this version or file, including the target
  --no-color             Disable color in progress and error output
  -q, --quiet            Suppress output except errors and explicit help
  -v, --verbose          Show progress logs
  -h, --help             Show this help

Behavior:
  Without --target, the command applies all pending migrations.
  A target can be a 14-digit version or a complete migration file name.
  Applied filenames and checksums must match the database history.
  The command checks UTF-8 encoding and marker structure only in migrations
  that it will apply.
  The command creates a missing history table before the first migration.
  Each migration uses its own transaction.
  The command waits for the migration advisory lock.

Output:
  The command header, completion messages, and errors go to stderr.
  --verbose also shows phase progress on stderr.
  --quiet suppresses normal command output; errors remain visible.
  The migration count goes to stdout when the plan runs.
  An empty plan leaves stdout empty.

Examples:
  pg-migrate up --url postgres://localhost/app
  pg-migrate up --target 20260811120000`;

const downHelpText = `Usage:
  pg-migrate down [options]

Reverts applied migrations in reverse version order.

Options:
  -c, --config <path>    Environment file, defaults to PGM_CONFIG or .env
  -d, --directory <path> Migrations directory, defaults to PGM_DIRECTORY or migrations
  -t, --table <name>     History table, defaults to PGM_TABLE or schema_migrations
  -u, --url <url>        PostgreSQL URL, or use PGM_URL
  --target <target>      Revert migrations after this version or file
  --no-color             Disable color in progress and error output
  -q, --quiet            Suppress output except errors and explicit help
  -v, --verbose          Show progress logs
  -h, --help             Show this help

Behavior:
  Without --target, the command reverts the latest applied migration.
  With --target, the target remains applied.
  A target can be a 14-digit version or a complete migration file name.
  Applied filenames and checksums must match the database history.
  The command checks UTF-8 encoding and marker structure only in migrations
  that it will revert.
  An empty migrate:down section removes only the migration history row.
  It does not reverse database changes, and a later up runs the up section again.
  Each migration uses its own transaction.
  The command waits for the migration advisory lock.

Output:
  The command header, completion messages, and errors go to stderr.
  --verbose also shows phase progress on stderr.
  --quiet suppresses normal command output; errors remain visible.
  The migration count goes to stdout when the plan runs.
  An empty plan leaves stdout empty.

Examples:
  pg-migrate down --url postgres://localhost/app
  pg-migrate down --target 20260811120000_add_users.sql`;

/** Returns general or command-specific CLI help text. */
export function getHelpText(command: Command | "help"): string {
  switch (command) {
    case "create":
      return createHelpText;
    case "status":
      return statusHelpText;
    case "validate":
      return validateHelpText;
    case "up":
      return upHelpText;
    case "down":
      return downHelpText;
    case "help":
      return generalHelpText;
  }
}
