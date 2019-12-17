# 🦖 migratosaurus

An exotically simple database migration tool for node [pg](https://www.npmjs.com/package/pg).

## ☄️ Features

- Dead simple, zero config!
- Write migrations in .sql files!
- Lightweight and easy to integrate into workflows!

## 🌱 Install

```sh
npm install migratosaurus
```

Or using [yarn](https://yarnpkg.com/).

```sh
yarn add migratosaurus
```

You must also install [pg](https://www.npmjs.com/package/pg) and have a [postgres](https://www.postgresql.org/) database setup.

## 🥚 Development

Download the project repository and initiate development with the following commands:

```sh
git clone https://github.com/gabbes/migratosaurus
cd migratosaurus
yarn # installs dependencies
yarn tsc -w # watch /src and compile TypeScript on changes
```

### 🦟 Tests

To test that any changes did not break the package first ensure that you have a [postgres](https://www.postgresql.org/)s database running. Then run `yarn mocha` with the database connection string as an node env variable.

```sh
DATABASE_URL="postgres://localhost:5432/database" yarn mocha --verbose
```

## 🌋 Changelog

Changes are tracked [here](./CHANGELOG.md).

## 🐣 License

[MIT](./LICENSE)
