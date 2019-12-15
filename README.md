# 🦖 migratosaurus

A node pg database migration tool.

## 🌱 Install

```sh
npm install migratosaurus
```

Or using [yarn](https://yarnpkg.com/).

```sh
yarn add migratosaurus
```

## Sample usage

Create database migration files. Defaultly pgup will look for `./sql/` directory, but this can be configured. The file naming convention should be _index_-_name_.sql. A valid migration path would be: `./sql/1-initial-migration.sql`.

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR (100) NOT NULL
);
```

And add a pgup step after initializing your pg instance.

```js
import { Pool } from 'pg';
import { migratosaurus } from 'migrate-pg';

const pool = new Pool({
  connectionString: 'postgres://localhost:5432/database',
});

(async () => {
  await migratosaurus(pool);
})();
```

## Configuration

The first argument is a [pg](https://www.npmjs.com/package/pg) Pool instance and is required.

The second argument is options but allows you configure pgup.

- `directory` A string value of the path to the directory containing your postgres database migrations in .sql files. Default is "sql".
- `table` A string value for the name of the table in the database that should store migration history.

## Tests

Run tests:

```sh
DATABASE_URL="postgres://localhost:5432/DATABASE" yarn mocha --verbose
```

## Changelog

[Changelog](./CHANGELOG.md)

## Lisence

[MIT](./LICENSE)
