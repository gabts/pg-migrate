import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  calculateMigrationChecksum,
  readMigrationChecksums,
} from "./checksum.js";
import type { DiskMigration } from "./files.js";
import type { LogEvent } from "./model.js";

describe("checksum", (): void => {
  let tempDir: string;

  beforeEach(async (): Promise<void> => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg_migrate-"));
  });

  afterEach(async (): Promise<void> => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("calculates a SHA-256 checksum from exact bytes", (): void => {
    assert.equal(
      calculateMigrationChecksum(Buffer.from("abc")),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    assert.notEqual(
      calculateMigrationChecksum(Buffer.from("SELECT 1;\n")),
      calculateMigrationChecksum(Buffer.from("SELECT 1;\r\n")),
    );
  });

  it("reads migration checksums and emits progress", async (): Promise<void> => {
    const file = "20260811120000_add_users.sql";
    const filePath = path.join(tempDir, file);
    const contents = Buffer.from("SELECT 1;\n");
    await fs.writeFile(filePath, contents);
    const migration: DiskMigration = {
      file,
      name: "add_users",
      path: filePath,
      version: "20260811120000",
    };
    const events: LogEvent[] = [];

    const result = await readMigrationChecksums([migration], (event) => {
      events.push(event);
    });

    assert.equal(result.get(file), calculateMigrationChecksum(contents));
    assert.deepEqual(events, [
      { count: 1, type: "checksum-calculation-start" },
      { count: 1, type: "checksum-calculation-done" },
    ]);
  });
});
