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
This package requires Node.js `>=22`.

## 🧬 Quick Start

Use it from your app or migration runner:

```javascript
import { down, up } from "migratorosaurus";

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

Migration files must use the pattern `<index>-<name>.sql`, for example `1-create.sql` or `001-create-person.sql`.

- `<index>` must be a whole number and may include leading zeros, for example `1` or `001`
- `<name>` may use letters, numbers, `_`, `-`, and `.`
- Any `.sql` file in the directory that does not match this pattern will cause migration to fail
- Duplicate resolved indices such as `1-create.sql` and `001-create-again.sql` will cause migration to fail

Each file must contain exactly one `up` marker and one `down` marker, in this order:

```sql
-- % up-migration % --
CREATE TABLE person (
  id SERIAL PRIMARY KEY,
  name varchar(100) NOT NULL
);

-- % down-migration % --
DROP TABLE person;
```

The `up` section must contain SQL. The `down` section may be left empty for irreversible migrations. During rollback, empty `down` migrations execute no SQL but are still removed from the history table, so their `up()` must be idempotent.

## 🛠️ CLI

```sh
migratorosaurus --help
```

The built-in CLI currently supports one command:

- `create` creates a new migration file

The CLI creates the next available whole-number index starting at `1` and zero-pads it to 3 digits by default.

Useful commands:

```sh
migratorosaurus create --help
migratorosaurus create --directory sql/migrations --name add-users
migratorosaurus create --directory sql/migrations --pad-width 5 --name add-users
migratorosaurus create --directory sql/migrations --pad-width 0 --name add-users
```

`create` command rules:

- `--name` is required
- CLI-generated migration names may only use letters, numbers, `_`, and `-`
- `--directory` defaults to `"migrations"`
- `--pad-width` defaults to `3` and must be an integer from `0` to `7`
- `--help` and `-h` are boolean flags
- Unknown commands and unknown flags cause the CLI to fail

## 👩‍🔬 Configuration

The first argument is a required PostgreSQL connection string or `pg` client configuration.
The second argument is an optional configuration object:

- **directory** The directory that contains your migration `.sql` files. Defaults to `"migrations"`.
- **log** Function to handle logging, e.g. console.log.
- **table** The name of the database table that stores migration history. Defaults to `"migration_history"`.
  Valid values must use conventional PostgreSQL-style names only: `table_name` or `schema_name.table_name`. Table names may only use lowercase letters, numbers, and `_`, and must start with a letter or `_`. If you use a schema-qualified name, the schema must already exist.
- **target** An exact migration filename.

Use `up(config, { target })` to migrate forward until that migration has been applied.
Use `down(config)` to roll back exactly one migration.
Use `down(config, { target })` to roll back newer migrations while leaving the target migration applied.

`up()` is append-only by numeric migration index. If a lower-index migration file is added after a higher-index migration has already been applied, `up()` fails instead of silently applying it out of order.

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
