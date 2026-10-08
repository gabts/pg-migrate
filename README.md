# @gabbe/pg-migrate

A SQL-first PostgreSQL migration tool with a CLI and TypeScript API.

## Install

```sh
npm install @gabbe/pg-migrate
```

Requires Node.js 22+ and PostgreSQL 14+. The package is ESM only.

## Quick start

```sh
npx pg-migrate create add_users
```

Edit the new file in `migrations`:

```sql
-- migrate:up
CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE
);

-- migrate:down
DROP TABLE users;
```

Then apply it:

```sh
npx pg-migrate up --url postgres://localhost/app
```

## CLI

```text
pg-migrate <command> [arguments] [options]
pg-migrate help [command]
pg-migrate --version
```

| Command           | Action                                                   |
| ----------------- | -------------------------------------------------------- |
| `create <name>`   | Create a timestamped migration file.                     |
| `status`          | Show applied and pending migrations.                     |
| `validate`        | Check files and history, not SQL syntax.                 |
| `up`              | Apply all pending migrations in order.                   |
| `down`            | Revert the latest applied migration.                     |
| `repair <target>` | Record an applied migration's current file and checksum. |

| Option                   | Use                                               |
| ------------------------ | ------------------------------------------------- |
| `-d, --directory <path>` | Migration directory.                              |
| `--env-file <path>`      | Environment file.                                 |
| `-t, --table <name>`     | History table; database commands only.            |
| `-u, --url <url>`        | PostgreSQL URL; database commands only.           |
| `--target <target>`      | Target version or filename; `up` and `down` only. |
| `--fail-on-pending`      | `status` exits `2` when migrations are pending.   |
| `--no-color`             | Disable color.                                    |
| `-q, --quiet`            | Show only errors and requested help.              |
| `-v, --verbose`          | Show detailed progress.                           |
| `-h, --help`             | Show help.                                        |
| `--version`              | Show the version; without a command only.         |

A target is a 14-digit version, such as `20260811120000`, or a filename. `up`
applies through the target. `down` reverts every migration after it, so the
target stays applied.

Results and help go to stdout. Progress and errors go to stderr. A failure
exits with code `1`, and `status --fail-on-pending` exits with `2` when
migrations are pending. Colors follow `NO_COLOR` and `FORCE_COLOR` from the
shell, not from the environment file.

## Configuration

Settings use this precedence: command option, process environment,
environment file, then default.

| Variable        | Use                 | Default             |
| --------------- | ------------------- | ------------------- |
| `PGM_DIRECTORY` | Migration directory | `migrations`        |
| `PGM_ENV_FILE`  | Environment file    | `.env`              |
| `PGM_TABLE`     | History table       | `schema_migrations` |
| `PGM_URL`       | PostgreSQL URL      | None                |

```dotenv
PGM_DIRECTORY=db/migrations
PGM_TABLE=app.schema_migrations
PGM_URL=postgres://localhost/app
```

The environment file is loaded with Node's `process.loadEnvFile`, which
parses it like `node --env-file`. Every variable in it is loaded, so `PG*`
variables reach the driver, and variables that are already set keep their
values. The default `.env` is optional. A file set with `--env-file` or
`PGM_ENV_FILE` must exist. Node itself checks a file given with `--env-file`
before pg-migrate starts, so for a missing or unreadable file Node prints its
own error and exits with code `9`. Relative paths resolve from the current
directory, even when they are set in a file. Table and schema names must
match `[a-z_][a-z0-9_]*`.

Connecting times out after 10 seconds. Lock and statement waits have no
timeout, so for deployments set them in the URL, in milliseconds:

```text
postgres://localhost/app?lock_timeout=5000&statement_timeout=60000
```

The driver, node-postgres, fills settings that the URL leaves out from `PG*`
variables such as `PGPASSWORD` and `PGSSLMODE`, and from `~/.pgpass`. Its SSL
handling differs from `psql`'s: without `sslmode`, SSL is off, and
`sslmode=require` verifies the certificate. See the
[node-postgres SSL docs](https://node-postgres.com/features/ssl). Put every
setting that a deployment depends on in the URL.

## Migration files

`create` writes `<YYYYMMDDHHMMSS>_<name>.sql` with a UTC timestamp. It creates
the directory if needed. Names must match `[a-z0-9][a-z0-9_]*`, and versions
must be unique. Subdirectories are not scanned, and every `.sql` file must have
a valid migration filename.

A file has an `-- migrate:up` section followed by a `-- migrate:down` section,
as in the quick start. Only white space can come before the first marker, and
the up section must not be empty. A line that holds only a marker counts as
one, even inside a SQL comment or string. `validate` checks markers in every
file, but `up`, `down`, and `repair` check only the files they use.

Each section is sent to PostgreSQL as is. If the down section is empty, `down`
only records the revert and leaves the schema unchanged. A later `up`
runs the up section again.

## How migrations run

The history table logs every apply, revert, and repair with the filename and a
SHA-256 checksum of the migration. `status`, `validate`, `up`, and `down` stop
if an applied file was edited, renamed, or removed. They also stop if a pending
file sorts before an applied one.
Checksums use the exact bytes of the file, so keep line endings stable:

```gitattributes
*.sql text eol=lf
```

After you edit an applied file on purpose, or rename it but keep its version,
run `repair <target>` to record its current filename and checksum. It repairs
one migration at a time and fails if the history already matches the file. It
runs no migration SQL, so first make sure the schema matches the edited file.

`up`, `down`, `validate`, and `repair` hold an advisory lock for the history
table. Each migration runs in its own transaction together with its history
change. If a migration fails, only that migration rolls back.

After each migration, session settings such as `search_path` and `SET ROLE`
reset to the connection defaults. Set shared defaults in the URL, such as
`?options=-c%20search_path%3Dapp`, or with `ALTER ROLE ... SET`. Temporary
tables, prepared statements, and session advisory locks are not reset.

## Limitations

- Do not use `BEGIN`, `COMMIT`, `ROLLBACK`, `END`, or `ABORT` in migration SQL.
  They break the migration transaction, and the history can then disagree with
  the schema. Savepoints are safe.
- Statements that cannot run in a transaction, such as
  `CREATE INDEX CONCURRENTLY`, fail.
- `psql` meta-commands, variables, and `COPY FROM STDIN` are not supported.
- The tool does not create schemas. Create the history table's schema first.
- Do not edit the history table by hand. The tool checks the table's columns
  but trusts the rows it wrote.
- A command needs one server session from start to finish. Use a direct
  connection, not a pool that assigns connections per transaction or statement.

## TypeScript API

```ts
import {
  migrate,
  repair,
  rollback,
  status,
  validate,
  type DatabaseOptions,
  type LogEvent,
} from "@gabbe/pg-migrate";

const options = {
  directory: "migrations",
  table: "schema_migrations",
  url: "postgres://localhost/app",
  log(event: LogEvent): void {
    process.stderr.write(`${event.type}\n`);
  },
} satisfies DatabaseOptions;

const migrationStatus = await status(options);
const validation = await validate(options);
const applied = await migrate(options);
const reverted = await rollback({ ...options, target: "20260811120000" });
const repaired = await repair({ ...options, target: "20260811120000" });
```

All options are explicit. The API does not read `PGM_*` variables, but the
driver still reads `PG*` variables. `create` is CLI-only.

- `status` returns the state of each migration and the counts.
- `validate` returns counts.
- `migrate` and `rollback` return the filenames they ran.
- `repair` returns the filename it repaired.

`log` receives typed progress events. It is not awaited, and its errors are
ignored. Failures throw an `Error`, and database errors are kept as `cause`.

## License

MIT
