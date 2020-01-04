<h1 align="center">🦖 migratorosaurus 🦖</h1>
<p align="center">An exotically simple database migration tool for node [pg](https://www.npmjs.com/package/pg).</p>
<br />

## 🌋 Features

- Dead simple, zero config!
- Write migrations in .sql files!
- Lightweight and easy to integrate into workflows!

## 🌍 Install

```sh
npm install migratorosaurus
```

Or using [yarn](https://yarnpkg.com/).

```sh
yarn add migratorosaurus
```

Your environment should also have [pg](https://www.npmjs.com/package/pg) installed and have a [postgres](https://www.postgresql.org/) database setup.

## 🧬 Usage

_Coming soon..._

## 👩‍🔬 Development

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

## ☄️ Changelog

Changes are tracked [here](./CHANGELOG.md).

## 🐣 License

[MIT](./LICENSE)
