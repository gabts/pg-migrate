# @gabbe/pg-migrate

A lightweight PostgreSQL schema migration tool. It runs timestamped SQL files in order, records what was applied, and fails when migration history is inconsistent.

## Requirements

- Node.js `>=22`
- PostgreSQL
- ESM projects only

## Installation

```sh
npm install --save @gabbe/pg-migrate
```

The package installs the `pg-migrate` CLI binary and exports a typed Node API.

## Table of Contents

- [Quick Start](#quick-start)
- [Migration Files](#migration-files)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [History Table](#history-table)
  - [Schema Scoping](#schema-scoping)
- [Commands](#commands)
  - [`pg-migrate create`](#pg-migrate-create)
  - [`pg-migrate up`](#pg-migrate-up)
  - [`pg-migrate down`](#pg-migrate-down)
  - [`pg-migrate status`](#pg-migrate-status)
  - [`pg-migrate validate`](#pg-migrate-validate)
- [History Rules](#history-rules)
- [Locking and Transactions](#locking-and-transactions)
- [Development](#development)
- [License](#license)

## Quick Start

Create a migration file:

```sh
pg-migrate create --name create_users
```

Edit the generated file:

```sql
-- migrate:up
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email text NOT NULL UNIQUE
);

-- migrate:down
DROP TABLE users;
```

Apply pending migrations:

```sh
pg-migrate up --url postgres://localhost:5432/app
```

Check migration state:

```sh
pg-migrate status --url postgres://localhost:5432/app
```

## Migration Files

Migration files must be UTF-8 `.sql` files in this format:

```text
<YYYYMMDDHHMMSS>_<slug>.sql
```

Example:

```text
20260414153000_create_users.sql
```

Rules:

- The timestamp/version is 14 digits.
- The slug must match `[a-z0-9][a-z0-9_]*`.
- Files are applied in ascending version order.
- Non-`.sql` files are ignored.
- Invalid `.sql` filenames fail validation.
- Duplicate versions fail validation.
- Commands that load migrations require the migration directory to exist.
- Commands that load migrations fail if the directory contains no migration `.sql` files.

Each migration file must contain exactly one `-- migrate:up` marker and at most one `-- migrate:down` marker:

```sql
-- migrate:up
ALTER TABLE users ADD COLUMN name text;

-- migrate:down
ALTER TABLE users DROP COLUMN name;
```

Rules:

- The `up` section is required and must contain SQL.
- The `down` marker is optional.
- Empty `down` SQL is allowed.
- During rollback, an empty or missing `down` section executes no SQL but still removes the migration from history.
- If that migration is applied again later, its `up` SQL runs again. Irreversible migrations should have idempotent `up` SQL or should not be rolled back.
- Content before the first marker may only be comments or whitespace.

## Configuration

Database commands accept a database URL in one of three ways:

```sh
pg-migrate up postgres://localhost:5432/app
pg-migrate up --url postgres://localhost:5432/app
DATABASE_URL=postgres://localhost:5432/app pg-migrate up
```

Use either positional `<database-url>` or `--url`, not both.

### Environment Variables

| Variable              | Used by                            | Default      |
| --------------------- | ---------------------------------- | ------------ |
| `DATABASE_URL`        | `up`, `down`, `status`, `validate` | none         |
| `MIGRATION_DIRECTORY` | all commands                       | `migrations` |

### History Table

The migration history table defaults to `migration_history`.

Use `--table <table-name>` for CLI database commands, or `table` in the Node API options.

Valid table names:

- `migration_history`
- `schema_name.migration_history`

Table names must be lowercase PostgreSQL-style identifiers. The schema must already exist when a schema-qualified name is used.

### Schema Scoping

A schema-qualified history table only changes where migration history is stored. `pg-migrate` does not set `search_path` for migration SQL.

If migrations should affect a non-`public` schema, either qualify object names in the SQL:

```sql
-- migrate:up
CREATE TABLE app.users (
  id SERIAL PRIMARY KEY
);
```

If you set `search_path` inside a migration, reset it before the migration ends or use a schema-qualified history table such as `--table public.migration_history`. History writes happen in the same transaction as the migration SQL.

```sql
-- migrate:up
SET LOCAL search_path TO app;
CREATE TABLE users (
  id SERIAL PRIMARY KEY
);
RESET search_path;
```

## Commands

```sh
pg-migrate <command> [options]
pg-migrate <command> --help
```

Programmatic examples use the exported Node API. API calls accept a PostgreSQL connection string or a `pg.ClientConfig` object.

By default, API functions emit newline-delimited structured JSON logs to `stderr`. Pass `logSink` to route structured log records elsewhere.

`correlationId` adds the same id to every log record for one run, so application logs can be tied back to a specific migration call.

CLI commands exit `0` on success and `1` on expected failures. In human-readable mode, errors are logged to `stderr`. With `--json`, failures write `{ "command": <command|null>, "error": "<message>", "ok": false }` to `stdout`; `stderr` still contains logs, rendered as JSON log records.

### `pg-migrate create`

Creates a timestamped migration file.

#### Usage

```sh
pg-migrate create --name <name> [options]
```

#### Flags

| Flag                            | Required | Description                                                             |
| ------------------------------- | -------- | ----------------------------------------------------------------------- |
| `--name <name>`, `-n <name>`    | yes      | Migration slug. Must match `[a-z0-9][a-z0-9_]*`.                        |
| `--directory <dir>`, `-d <dir>` | no       | Output directory. Defaults to `MIGRATION_DIRECTORY` or `migrations`.    |
| `--json`                        | no       | Emit a structured command result to `stdout` and JSON logs to `stderr`. |
| `--quiet`                       | no       | Suppress non-error logs.                                                |
| `--verbose`, `-v`               | no       | Enable debug logs.                                                      |
| `--no-color`                    | no       | Disable ANSI color in human-readable logs.                              |
| `--help`, `-h`                  | no       | Show command help.                                                      |

#### Behavior

- Creates `<YYYYMMDDHHMMSS>_<name>.sql`.
- The timestamp is generated from the current UTC time.
- The output directory is created if it does not exist.
- The file is created with `-- migrate:up` and `-- migrate:down` markers.
- Existing files are not overwritten.
- Human-readable mode writes the created file path to `stdout`.
- `--json` writes `{ "command": "create", "file": "<path>" }` to `stdout`.
- Logs are written to `stderr`.

#### Examples

```sh
pg-migrate create --name create_users
pg-migrate create --directory sql/migrations --name add_user_index
pg-migrate create -d sql/migrations -n add_deleted_at
```

#### Programmatic API

`create` is only exposed through the CLI. The package does not currently export a public function for creating migration files.

### `pg-migrate up`

Applies pending migrations.

#### Usage

```sh
pg-migrate up [options] [<database-url>]
```

#### Flags

| Flag                               | Required | Description                                                             |
| ---------------------------------- | -------- | ----------------------------------------------------------------------- |
| `--url <database-url>`             | no       | Database URL. Alternative to positional `<database-url>`.               |
| `--directory <dir>`, `-d <dir>`    | no       | Migration directory. Defaults to `MIGRATION_DIRECTORY` or `migrations`. |
| `--target <target>`, `-t <target>` | no       | Apply pending migrations up to and including this target.               |
| `--table <table-name>`             | no       | Migration history table. Defaults to `migration_history`.               |
| `--dry-run`                        | no       | Run planned SQL and history writes, then roll back.                     |
| `--json`                           | no       | Emit a structured command result to `stdout` and JSON logs to `stderr`. |
| `--quiet`                          | no       | Suppress non-error logs.                                                |
| `--verbose`, `-v`                  | no       | Enable debug logs.                                                      |
| `--no-color`                       | no       | Disable ANSI color in human-readable logs.                              |
| `--help`, `-h`                     | no       | Show command help.                                                      |

#### Target Format

`--target` accepts either:

```text
<YYYYMMDDHHMMSS>
<YYYYMMDDHHMMSS>_<slug>.sql
```

#### Behavior

- Without `--target`, applies all pending migrations.
- With `--target`, stops after the target migration has been applied.
- Creates the migration history table if it does not exist.
- Validates files and applied history before running migration SQL.
- Fails if applied history has gaps, duplicates, missing files, or version mismatches.
- Fails if the target is behind the latest applied migration.
- Runs each migration file in its own transaction.
- Stops at the first failed migration.
- Uses a PostgreSQL advisory lock for the full run.
- Human-readable mode writes no command result on success.
- `--json` writes `{ "command": "up", "dryRun": <boolean>, "ok": true, "target": <target|null> }` to `stdout`.
- Logs are written to `stderr`.

#### Examples

```sh
pg-migrate up postgres://localhost:5432/app
pg-migrate up --url postgres://localhost:5432/app
pg-migrate up --url postgres://localhost:5432/app --target 20260416090000
pg-migrate up --url postgres://localhost:5432/app --target 20260416090000_create_users.sql
pg-migrate up --dry-run
```

#### Programmatic API

```javascript
import { up } from "@gabbe/pg-migrate";

await up("postgres://localhost:5432/app", {
  directory: "migrations",
  table: "migration_history",
});
```

With `--target` behavior:

```javascript
await up("postgres://localhost:5432/app", {
  directory: "migrations",
  table: "migration_history",
  target: "20260416090000_create_users.sql",
});
```

With `--dry-run` behavior:

```javascript
await up("postgres://localhost:5432/app", {
  directory: "migrations",
  dryRun: true,
  table: "migration_history",
});
```

Programmatic options: `directory`, `table`, `target`, `dryRun`, `quiet`, `verbose`, `logSink`, and `correlationId`.

### `pg-migrate down`

Rolls back the latest applied migration, or multiple newer migrations when `--target` is given.

#### Usage

```sh
pg-migrate down [options] [<database-url>]
```

#### Flags

| Flag                               | Required | Description                                                             |
| ---------------------------------- | -------- | ----------------------------------------------------------------------- |
| `--url <database-url>`             | no       | Database URL. Alternative to positional `<database-url>`.               |
| `--directory <dir>`, `-d <dir>`    | no       | Migration directory. Defaults to `MIGRATION_DIRECTORY` or `migrations`. |
| `--target <target>`, `-t <target>` | no       | Roll back newer migrations while leaving this target applied.           |
| `--table <table-name>`             | no       | Migration history table. Defaults to `migration_history`.               |
| `--dry-run`                        | no       | Run planned SQL and history writes, then roll back.                     |
| `--json`                           | no       | Emit a structured command result to `stdout` and JSON logs to `stderr`. |
| `--quiet`                          | no       | Suppress non-error logs.                                                |
| `--verbose`, `-v`                  | no       | Enable debug logs.                                                      |
| `--no-color`                       | no       | Disable ANSI color in human-readable logs.                              |
| `--help`, `-h`                     | no       | Show command help.                                                      |

#### Target Format

`--target` accepts either:

```text
<YYYYMMDDHHMMSS>
<YYYYMMDDHHMMSS>_<slug>.sql
```

#### Behavior

- Without `--target`, rolls back exactly one migration: the latest applied migration.
- With `--target`, rolls back newer migrations and leaves the target migration applied.
- The target migration must already be applied.
- Creates the migration history table if it does not exist.
- Validates files and applied history before running rollback SQL.
- Runs each rollback in its own transaction when `down` SQL exists.
- If `down` SQL is empty or missing, no SQL is run and the migration is still removed from history.
- Uses a PostgreSQL advisory lock for the full run.
- Human-readable mode writes no command result on success.
- `--json` writes `{ "command": "down", "dryRun": <boolean>, "ok": true, "target": <target|null> }` to `stdout`.
- Logs are written to `stderr`.

#### Examples

```sh
pg-migrate down postgres://localhost:5432/app
pg-migrate down --url postgres://localhost:5432/app
pg-migrate down --url postgres://localhost:5432/app --target 20260416090000
pg-migrate down --url postgres://localhost:5432/app --target 20260416090000_create_users.sql
pg-migrate down --dry-run
```

#### Programmatic API

```javascript
import { down } from "@gabbe/pg-migrate";

await down("postgres://localhost:5432/app", {
  directory: "migrations",
  table: "migration_history",
});
```

With `--target` behavior:

```javascript
await down("postgres://localhost:5432/app", {
  directory: "migrations",
  table: "migration_history",
  target: "20260416090000_create_users.sql",
});
```

With `--dry-run` behavior:

```javascript
await down("postgres://localhost:5432/app", {
  directory: "migrations",
  dryRun: true,
  table: "migration_history",
});
```

Programmatic options: `directory`, `table`, `target`, `dryRun`, `quiet`, `verbose`, `logSink`, and `correlationId`.

### `pg-migrate status`

Shows applied and pending migration state.

#### Usage

```sh
pg-migrate status [options] [<database-url>]
```

#### Flags

| Flag                            | Required | Description                                                             |
| ------------------------------- | -------- | ----------------------------------------------------------------------- |
| `--url <database-url>`          | no       | Database URL. Alternative to positional `<database-url>`.               |
| `--directory <dir>`, `-d <dir>` | no       | Migration directory. Defaults to `MIGRATION_DIRECTORY` or `migrations`. |
| `--table <table-name>`          | no       | Migration history table. Defaults to `migration_history`.               |
| `--json`                        | no       | Emit a structured command result to `stdout` and JSON logs to `stderr`. |
| `--quiet`                       | no       | Suppress non-error logs.                                                |
| `--verbose`, `-v`               | no       | Enable debug logs.                                                      |
| `--no-color`                    | no       | Disable ANSI color in human-readable logs.                              |
| `--help`, `-h`                  | no       | Show command help.                                                      |

#### Behavior

- Validates migration files and applied history consistency.
- Shows the history table, migration directory, initialization state, current migration, next migration, applied count, pending count, total count, and per-file state.
- `current` is the latest applied migration by file order.
- `next` is the first pending migration by file order.
- Does not create a missing history table.
- Reports `initialized: false` when the history table does not exist.
- Uses a PostgreSQL advisory lock for the full run.
- Human-readable mode writes a status report to `stdout`.
- `--json` writes `{ "command": "status", "ok": true, ...status }` to `stdout`.
- Logs are written to `stderr`.

#### Human Output

```text
Table: migration_history
Directory: migrations
Initialized: true
Current: 20260414153000_create_users.sql
Next: (none)
Applied: 1
Pending: 0
Total: 1
```

#### Examples

```sh
pg-migrate status postgres://localhost:5432/app
pg-migrate status --url postgres://localhost:5432/app
pg-migrate status --url postgres://localhost:5432/app --table migration_history
pg-migrate status --json
```

#### Programmatic API

```javascript
import { status } from "@gabbe/pg-migrate";

const result = await status("postgres://localhost:5432/app", {
  directory: "migrations",
  table: "migration_history",
});
```

`result` contains `current`, `next`, `initialized`, `summary`, and the per-file `migrations` list.

Programmatic options: `directory`, `table`, `quiet`, `verbose`, `logSink`, and `correlationId`.

### `pg-migrate validate`

Checks migration files, database connectivity, and migration history without applying SQL.

#### Usage

```sh
pg-migrate validate [options] [<database-url>]
```

#### Flags

| Flag                            | Required | Description                                                             |
| ------------------------------- | -------- | ----------------------------------------------------------------------- |
| `--url <database-url>`          | no       | Database URL. Alternative to positional `<database-url>`.               |
| `--directory <dir>`, `-d <dir>` | no       | Migration directory. Defaults to `MIGRATION_DIRECTORY` or `migrations`. |
| `--table <table-name>`          | no       | Migration history table. Defaults to `migration_history`.               |
| `--json`                        | no       | Emit a structured command result to `stdout` and JSON logs to `stderr`. |
| `--quiet`                       | no       | Suppress non-error logs.                                                |
| `--verbose`, `-v`               | no       | Enable debug logs.                                                      |
| `--no-color`                    | no       | Disable ANSI color in human-readable logs.                              |
| `--help`, `-h`                  | no       | Show command help.                                                      |

#### Behavior

- Validates migration files, ordering, SQL markers, and applied history consistency.
- Checks database connectivity.
- Checks the migration history table shape.
- Does not create a missing history table.
- Fails if the migration history table does not exist.
- Uses a PostgreSQL advisory lock for the full run.
- Human-readable mode writes no command result on success.
- `--json` writes `{ "command": "validate", "ok": true }` to `stdout`.
- Logs are written to `stderr`.

#### Examples

```sh
pg-migrate validate postgres://localhost:5432/app
pg-migrate validate --url postgres://localhost:5432/app
pg-migrate validate --url postgres://localhost:5432/app --table migration_history
pg-migrate validate --json
```

#### Programmatic API

```javascript
import { validate } from "@gabbe/pg-migrate";

await validate("postgres://localhost:5432/app", {
  directory: "migrations",
  table: "migration_history",
});
```

Programmatic options: `directory`, `table`, `quiet`, `verbose`, `logSink`, and `correlationId`.

## History Rules

Before running migration SQL, `pg-migrate` validates that applied migrations still match disk migrations.

It fails when:

- An applied migration file is missing on disk.
- Applied history contains duplicate files or duplicate versions.
- A stored version does not match the version in the filename.
- Applied migrations do not form a contiguous prefix of the ordered migration files.
- A target migration cannot be found.
- An `up --target` migration is older than the latest applied migration.

`up` is append-only by version order. If you add an older migration after a newer migration has already been applied, `up` fails instead of applying it out of order.

## Locking and Transactions

Migration database commands use a PostgreSQL advisory lock for the full run. The lock key is based on the unqualified history table name.

Examples:

- `migration_history`
- `public.migration_history`

Both use the same lock key, so they serialize with each other. Use different table names if that matters.

Warning: separate services that share one PostgreSQL database and use the same unqualified history table name will block each other, even when their history tables are in different schemas.

Transaction behavior:

- `up` runs each migration file in its own transaction.
- `down` runs each rollback in its own transaction when `down` SQL exists.
- `--dry-run` wraps the planned run in a transaction and always rolls it back.
- Earlier successful migrations stay committed when a later migration fails.
- If one statement inside an `up` migration file fails, that file's transaction is rolled back and no history row is inserted.
- If one statement inside a `down` migration file fails, that file's transaction is rolled back and the existing history row remains.
- `pg-migrate` does not store failed or dirty migration rows.
- PostgreSQL commands that cannot run inside a transaction block, such as `CREATE INDEX CONCURRENTLY`, are not supported in normal migration files.

## Development

```sh
git clone https://github.com/gabts/pg-migrate
cd pg-migrate
npm install
npm run build:watch
```

Run tests with a PostgreSQL database:

```sh
DATABASE_URL="postgres://localhost:5432/database" npm run test
```

## License

[MIT](./LICENSE)
