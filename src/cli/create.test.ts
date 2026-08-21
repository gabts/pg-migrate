import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { create } from "./create.js";
import type { CliLogEvent } from "./model.js";

const version = "20090103181505";

describe("create", (): void => {
  let tempDir: string;

  // Use a fixed Date to get a known version. This permits tests of exact
  // filenames and version conflicts. The date is the Bitcoin genesis block.
  beforeEach(async (): Promise<void> => {
    mock.timers.enable({
      apis: ["Date"],
      now: Date.UTC(2009, 0, 3, 18, 15, 5),
    });
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg_migrate-"));
  });

  afterEach(async (): Promise<void> => {
    mock.timers.reset();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("writes a timestamped file with the template", async (): Promise<void> => {
    const filePath = await create({
      directory: tempDir,
      name: "add_users",
    });

    assert.equal(filePath, path.join(tempDir, `${version}_add_users.sql`));
    assert.equal(
      await fs.readFile(filePath, "utf8"),
      "-- migrate:up\n\n-- migrate:down\n",
    );
  });

  it("emits creation events", async (): Promise<void> => {
    const events: CliLogEvent[] = [];
    await create({
      directory: tempDir,
      log(event): undefined {
        events.push(event);
      },
      name: "add_users",
    });

    assert.deepEqual(events, [
      { type: "file-create-start", directory: tempDir },
      {
        type: "file-created",
        path: path.join(tempDir, `${version}_add_users.sql`),
      },
    ]);
  });

  it("rejects an invalid migration name", async (): Promise<void> => {
    await assert.rejects(
      create({ directory: tempDir, name: "Invalid-Name" }),
      new Error(
        "Invalid migration name 'Invalid-Name', expected lowercase letters, " +
          "numbers, and underscores.",
      ),
    );
  });

  it("ignores log sink failures", async (): Promise<void> => {
    const filePath = await create({
      directory: tempDir,
      log(): undefined {
        throw new Error("Log sink failed.");
      },
      name: "add_users",
    });

    assert.equal(
      await fs.readFile(filePath, "utf8"),
      "-- migrate:up\n\n-- migrate:down\n",
    );
  });

  it("creates the directory recursively", async (): Promise<void> => {
    const directory = path.join(tempDir, "db", "migrations");
    await create({ directory, name: "add_users" });

    await fs.access(path.join(directory, `${version}_add_users.sql`));
  });

  it("rejects when the path is not a directory", async (): Promise<void> => {
    const filePath = path.join(tempDir, "migrations");
    await fs.writeFile(filePath, "");

    await assert.rejects(
      create({ directory: filePath, name: "add_users" }),
      new Error(`Migration path '${filePath}' is not a directory.`),
    );
  });

  it("rejects when the version already exists", async (): Promise<void> => {
    await create({ directory: tempDir, name: "first" });

    await assert.rejects(
      create({ directory: tempDir, name: "second" }),
      new Error(`Migration version '${version}' already exists.`),
    );

    // The failed operation must remove its lock file. A remaining lock file
    // blocks the version.
    assert.deepEqual(await fs.readdir(tempDir), [`${version}_first.sql`]);
  });

  it("rejects a version before the latest existing version", async (): Promise<void> => {
    const latestVersion = "20090103181506";
    await fs.writeFile(path.join(tempDir, `${latestVersion}_existing.sql`), "");

    await assert.rejects(
      create({ directory: tempDir, name: "add_users" }),
      new Error(
        `Migration version '${version}' must be later than existing version ` +
          `'${latestVersion}'.`,
      ),
    );

    assert.deepEqual(await fs.readdir(tempDir), [
      `${latestVersion}_existing.sql`,
    ]);
  });

  it("rejects when a concurrent create locks the version", async (): Promise<void> => {
    await fs.writeFile(path.join(tempDir, `.${version}.lock`), "");

    await assert.rejects(
      create({ directory: tempDir, name: "add_users" }),
      new Error(`Migration version '${version}' already exists.`),
    );
  });

  it("removes the lock file afterwards", async (): Promise<void> => {
    await create({ directory: tempDir, name: "add_users" });

    assert.deepEqual(await fs.readdir(tempDir), [`${version}_add_users.sql`]);
  });
});
