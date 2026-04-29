<h1 align="center">🦖 MIGRATOROSAURUS 🦖</h1>
<br />

An exotically simple database migration tool for node [pg](https://www.npmjs.com/package/pg).

## 🌋 Features

- Dead simple, zero config!
- Write up and down migrations in the same .sql file!
- Lightweight and easy to integrate into workflows!

## 🌍 Install

```sh
npm install --save migratorosaurus
```

Your environment should have a [PostgreSQL](https://www.postgresql.org/) database setup.
This package is ESM-only and requires Node.js `>=22`.

## 🧬 Quick Start

Use it from your app or migration runner:

```javascript
import { down, up, validate } from "migratorosaurus";

await validate("postgres://localhost:5432/database", {
  directory: `sql/migrations`,
  table: "my_migration_history",
});

await up("postgres://localhost:5432/database", {
  directory: `sql/migrations`,
  table: "my_migration_history",
});

await down("postgres://localhost:5432/database", {
  directory: `sql/migrations`,
  table: "my_migration_history",
});
```

## 📁 Migration Files

Migration filenames are enforced and must match:
`<YYYYMMDDHHMMSS>_<slug>.sql` (for example `20260414153000_create_person.sql`).
Files are applied in ascending version order.

- `<slug>` must use lowercase letters, numbers, and underscores only
- Non-`.sql` files in the directory are ignored
- Invalid `.sql` migration filenames cause startup validation to fail

Each file must contain exactly one `up` marker and at most one `down` marker:

```sql
-- migrate:up
CREATE TABLE person (
  id SERIAL PRIMARY KEY,
  name varchar(100) NOT NULL
);

-- migrate:down
DROP TABLE person;
```

The `up` section must contain SQL. The `down` marker is optional. If present, its SQL may be empty for irreversible migrations. During rollback, migrations without down SQL execute no SQL but are still removed from the history table, so their `up()` must be idempotent.

## 🛠️ CLI

```sh
migratorosaurus --help
```

The built-in CLI supports:

- `create` creates a new migration file
- `up` applies pending migrations
- `down` rolls back applied migrations
- `validate` checks migration environment and state without applying SQL

The CLI creates filenames in `<YYYYMMDDHHMMSS>_<slug>.sql` format.

Useful commands:

```sh
migratorosaurus create --help
migratorosaurus create --directory sql/migrations --name add_users
migratorosaurus validate --url postgres://localhost:5432/app
migratorosaurus up --url postgres://localhost:5432/app
migratorosaurus down --url postgres://localhost:5432/app --target 20260416090100_add_users.sql
```

Global CLI flags:

- `--json` emit machine-readable result JSON to `stdout`
- `--quiet` suppress non-error logs
- `--verbose` / `-v` enable debug logs
- `--no-color` disable ANSI color in logs

`create` command rules:

- `--name` is required
- `--name` must be a lowercase slug (`[a-z0-9][a-z0-9_]*`)
- `--directory` defaults to `MIGRATION_DIRECTORY` or `"migrations"`
- `--help` and `-h` are boolean flags
- Unknown commands and unknown flags cause the CLI to fail

`up` / `down` / `validate` command rules:

- `--directory` defaults to `MIGRATION_DIRECTORY` or `"migrations"`
- `--directory` takes precedence over `MIGRATION_DIRECTORY`

`validate` command behavior:

- validates migration files, order, and applied history consistency
- validates database connectivity and migration table state
- does not create missing migration history tables
- uses the same advisory lock as `up`/`down` and fails fast if another run is active

CLI stream conventions:

- Command results are written to `stdout` only
- Logs (info/warn/error/debug) are written to `stderr`
- In `--json` mode, `stdout` contains only structured JSON output (including help and failures)
- ANSI color in human-friendly CLI logs is enabled only when `stderr` is a TTY

## 👩‍🔬 Configuration

The first argument is a required PostgreSQL connection string or `pg` client configuration.
The second argument is an optional configuration object:

- **directory** The directory that contains your migration `.sql` files. Defaults to `"migrations"`.
- **quiet** Suppress non-error logs.
- **verbose** Enable debug logs.
- **logger** Optional custom `Logger` implementation.
- **table** The name of the database table that stores migration history. Defaults to `"migration_history"`.
  Valid values must use conventional PostgreSQL-style names only: `table_name` or `schema_name.table_name`. Table names may only use lowercase letters, numbers, and `_`, and must start with a letter or `_`. If you use a schema-qualified name, the schema must already exist.
- **target** An exact migration filename.

By default, `up()` and `down()` emit newline-delimited JSON logs to `stderr` unless you pass a custom `logger`.
`validate()` uses the same default logging behavior and performs checks only (no migration SQL execution).
The CLI configures a custom log writer that renders structured log objects as human-friendly terminal output.

Use `up(config, { target })` to migrate forward until that migration has been applied.
Use `down(config)` to roll back exactly one migration.
Use `down(config, { target })` to roll back newer migrations while leaving the target migration applied.

`up()` is append-only by version order. If a migration file is added with a version earlier than the latest applied migration after that later migration has already been applied, `up()` fails instead of silently applying it out of order.

## 🧫 Transactions

Each migration file runs in its own transaction. If one migration fails, earlier successful migrations stay committed and the failing migration is rolled back. Concurrent runners are serialized with a PostgreSQL advisory lock keyed on the unqualified history table name — `migration_history` and `public.migration_history` share the same lock, so runners against same-named tables in different schemas will also serialize. Use distinct table names if that matters.

## 🚁 Development

Clone the repository and install dependencies:

```sh
git clone https://github.com/gabts/migratorosaurus
cd migratorosaurus
npm install
npm run build:watch
```

### 🦟 Testing

Ensure a [PostgreSQL](https://www.postgresql.org/) database is running, then run the tests with a `DATABASE_URL`:

```sh
DATABASE_URL="postgres://localhost:5432/database" npm run test
```

## ☄️ License

[MIT](./LICENSE)
