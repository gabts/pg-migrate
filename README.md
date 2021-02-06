<h1 align="center">🦖 MIGRATOROSAURUS 🦖</h1>
<br />

An exotically simple database migration tool for node [pg](https://www.npmjs.com/package/pg).

## 🌋 Features

- Dead simple, zero config!
- Write migrations in .sql files!
- Lightweight and easy to integrate into workflows!

## 🌍 Install

```sh
npm install --save migratorosaurus
```

Or using [yarn](https://yarnpkg.com/).

```sh
yarn add migratorosaurus
```

Your environment should also have [pg](https://www.npmjs.com/package/pg) installed and have a [postgres](https://www.postgresql.org/) database setup.

## 🧬 Usage

In your database migration script file:

```javascript
const { Pool } = require('pg');
const { migratorosaurus } = require('migratorosaurus');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

migratorosaurus(pool, {
  directory: `sql/migrations`,
  table: 'my_migration_history',
});
```

Sample migration file:

```sql
-- up-migration
CREATE TABLE person (
  id SERIAL PRIMARY KEY,
  name varchar(100) NOT NULL
);

-- down-migration
DROP TABLE person;
```

Migrations will be split by up/down comments.

## 👩‍🔬 Configuration

First argument is a required pg Pool object or a database connection string.

Second argument is an optional configuration object.

- **directory** The directory that contains your migation .sql files. Defaults to "migrations".
- **log** Function to handle logging, e.g. console.log.
- **table** The name of the database table that stores migration history. Default to "migration_history".
- **target** A specific migration that you would like to up/down migrate. Any migrations between the last migrated migration and the target will be up/down migrated as well.

## 🚁 Development

Download the project repository and initiate development with the following commands:

```sh
git clone https://github.com/gabts/migratorosaurus
cd migratorosaurus
yarn # installs dependencies
yarn tsc -w # watch and compile TypeScript on changes
```

### 🦟 Testing

To test that any changes did not break the package first ensure that you have a [PostgreSQL](https://www.postgresql.org/) database running. Then run `yarn mocha` with the database connection string as an node env variable.

```sh
DATABASE_URL="postgres://localhost:5432/database" yarn mocha --verbose
```

## ☄️ License

[MIT](./LICENSE)
