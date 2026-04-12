import * as fs from "fs";
import type * as pg from "pg";
import { parseMigration } from "./migration-files.js";
import { parseTableName, qualifyTableName } from "./table-name.js";
import type { DiskMigration, LogFn } from "./types.js";

export async function executeUpPlan(args: {
  client: pg.Client;
  log: LogFn;
  migrations: DiskMigration[];
  table: string;
}): Promise<void> {
  const { client, log, migrations, table } = args;
  const qualifiedTableName = qualifyTableName(parseTableName(table));

  for (const { file, index, path } of migrations) {
    const sql = parseMigration(fs.readFileSync(path, "utf8"), "up", file);
    log(`↑  upgrading > "${file}"`);
    await client.query(sql);
    await client.query(
      `INSERT INTO ${qualifiedTableName} ( index, file, date ) VALUES ( $1, $2, clock_timestamp() );`,
      [index, file],
    );
  }
}

export async function executeDownPlan(args: {
  client: pg.Client;
  log: LogFn;
  migrations: DiskMigration[];
  table: string;
}): Promise<void> {
  const { client, log, migrations, table } = args;
  const qualifiedTableName = qualifyTableName(parseTableName(table));

  for (const { file, path } of migrations) {
    const sql = parseMigration(fs.readFileSync(path, "utf8"), "down", file);
    log(`↓  downgrading > "${file}"`);
    await client.query(sql);
    await client.query(`DELETE FROM ${qualifiedTableName} WHERE file = $1;`, [
      file,
    ]);
  }
}
