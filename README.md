# @gabbe/pg-migrate

A SQL-first PostgreSQL migration tool with a cli and TypeScript API.

## Install

```sh
npm install @gabbe/pg-migrate
```

This installs the `pg-migrate` command and the package API.

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

Then apply and validate it:

```sh
npx pg-migrate up --url postgres://localhost/app
npx pg-migrate validate --url postgres://localhost/app
```

## CLI

```text
pg-migrate <command> [arguments] [options]
pg-migrate help [command]
pg-migrate <command> --help
```

| Command         | Action                                             |
| --------------- | -------------------------------------------------- |
| `create <name>` | Create a timestamped migration file.               |
| `status`        | Show applied and pending migrations.               |
| `validate`      | Validate all migration files and database history. |
| `up`            | Apply all pending migrations in order.             |
| `down`          | Revert the latest applied migration.               |

Use `--target <version-or-filename>` with `up` to apply through a migration.
Use it with `down` to revert all migrations after it. A `down` target remains
applied. A version contains 14 digits, for example `20260811120000`.

| Option                   | Use                                               |
| ------------------------ | ------------------------------------------------- |
| `-c, --config <path>`    | Environment file.                                 |
| `-d, --directory <path>` | Migration directory.                              |
| `-t, --table <name>`     | History table; database commands only.            |
| `-u, --url <url>`        | PostgreSQL URL; database commands only.           |
| `--target <target>`      | Target version or filename; `up` and `down` only. |
| `--no-color`             | Disable color.                                    |
| `-q, --quiet`            | Show only errors and requested help.              |
| `-v, --verbose`          | Show detailed progress.                           |
| `-h, --help`             | Show help.                                        |

Final results and help go to stdout. Progress and errors go to stderr. An
empty `up` or `down` plan leaves stdout empty. A failure sets exit code `1`.
Quiet mode takes precedence over verbose mode.

## Configuration

Settings use this precedence: command option, process environment,
environment file, then default.

| Variable        | Use                 | Default             |
| --------------- | ------------------- | ------------------- |
| `PGM_CONFIG`    | Environment file    | `.env`              |
| `PGM_DIRECTORY` | Migration directory | `migrations`        |
| `PGM_TABLE`     | History table       | `schema_migrations` |
| `PGM_URL`       | PostgreSQL URL      | None                |

The default `.env` file is optional. A file selected with `--config` or
`PGM_CONFIG` must exist. For example:

```dotenv
PGM_DIRECTORY=db/migrations
PGM_TABLE=app.schema_migrations
PGM_URL=postgres://localhost/app
```

Database commands require `--url` or `PGM_URL`. A history table can include a
schema. Each table or schema identifier must start with a lowercase letter or
underscore and contain only lowercase letters, numbers, and underscores.

## Migration files

`create` makes the directory if necessary and creates this UTC filename:

```text
<YYYYMMDDHHMMSS>_<name>.sql
```

Names must match `[a-z0-9][a-z0-9_]*`. Versions must be unique. Each file must
be valid UTF-8 and have this structure:

```sql
-- migrate:up

-- migrate:down
```

Only white space can occur before the first marker. Each marker must occur
exactly once, `migrate:up` must come first, and its section must not be empty.
The down section can be empty. An exact marker line is reserved, including in
SQL comments and strings. Every `.sql` entry in the directory must be a regular
file with a valid migration filename. The tool does not scan subdirectories.

The tool sends each section to PostgreSQL without parsing SQL statements. An
empty down section removes the history record but does not undo schema changes.

## Safety and history

Applied migrations must be a continuous sequence of the files on disk. The
tool stops for a missing version, duplicate version, or history gap.

The history table stores the filename and SHA-256 checksum of each applied
migration. Database commands stop if an applied file is edited or renamed.
Checksums use the exact file bytes. File metadata and paths do not affect them.
Use this Git rule to keep SQL line endings stable on all systems:

```gitattributes
*.sql text eol=lf
```

`up`, `down`, and `validate` wait for an advisory lock for the selected history
table. Each migration runs in its own transaction with its history change. If
a migration fails, its transaction rolls back, but earlier migrations from the
same command stay complete.

`status` checks filenames, checksums, and history without decoding or
validating SQL, creating the history table, or taking the lock. `validate`
checks SQL in all files and does not change migration data. `up` and `down`
check SQL only in their execution plan.

## Limitations

- Each migration runs in a transaction. Migration SQL must not contain
  transaction-control commands or statements that cannot run in a transaction.
  The tool does not detect transaction-control commands.
- `psql` meta-commands, variable substitution, and `COPY FROM STDIN` are not
  supported.
- `validate` checks file structure and history, not PostgreSQL SQL syntax.
- The tool does not create schemas or set `search_path`. Create the history
  table schema first. Set the required `search_path` or use schema-qualified
  names in migration SQL.

## TypeScript API

```ts
import {
  migrate,
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
```

All options are explicit. The API does not read CLI options or environment
variables, and file creation is available through the CLI only. `status`
returns ordered migration state and counts. `validate` returns counts.
`migrate` and `rollback` return executed filenames. The optional `log` callback
receives typed progress events. Failures throw an `Error`.

## License

MIT
