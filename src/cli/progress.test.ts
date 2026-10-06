import * as assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, it, mock } from "node:test";
import type { CliLogEvent } from "./model.js";
import { createProgressOutput } from "./progress.js";

interface CapturedStream {
  read: () => string;
  stream: PassThrough & { columns?: number; isTTY?: boolean };
}

function captureStream(isTTY: boolean): CapturedStream {
  let text = "";
  const stream = new PassThrough() as PassThrough & {
    columns?: number;
    isTTY?: boolean;
  };
  stream.isTTY = isTTY;
  stream.on("data", (chunk: Buffer) => {
    text += chunk.toString();
  });
  return { read: () => text, stream };
}

// Most tests check verbose output, so their log calls set verbose.
function createVerboseOutput(stream: CapturedStream["stream"]): {
  fail(): void;
  log(event: CliLogEvent): void;
  stop(): void;
} {
  const progress = createProgressOutput(stream, false);
  return {
    ...progress,
    log(event: CliLogEvent): void {
      progress.log(event, true);
    },
  };
}

describe("progress", (): void => {
  it("replaces each interactive phase with one completed line", (): void => {
    const captured = captureStream(true);
    const progress = createVerboseOutput(captured.stream);

    progress.log({ type: "directory-read-start", directory: "demo" });
    progress.log({ type: "directory-read-done", directory: "demo" });
    progress.log({
      type: "target-resolve-start",
      target: "20260719120000_add_users.sql",
    });
    progress.log({
      file: "20260719120000_add_users.sql",
      type: "target-resolve-done",
    });
    progress.log({ type: "consistency-validation-start" });
    progress.log({ type: "consistency-validation-done" });
    progress.log({ direction: "up", type: "plan-start" });
    progress.log({ count: 1, direction: "up", type: "plan-done" });
    progress.log({
      direction: "up",
      file: "20260719120000_add_users.sql",
      type: "migration-start",
    });
    progress.log({
      direction: "up",
      durationMs: 42,
      file: "20260719120000_add_users.sql",
      type: "migration-done",
    });

    const output = captured.read();
    assert.match(output, /⠋ Reading migration directory 'demo'\.\.\./);
    assert.match(output, /› Read migration directory 'demo'\./);
    assert.match(output, /⠋ Resolving migration target/);
    assert.match(output, /› Resolved migration target/);
    assert.match(output, /⠋ Validating migration consistency\.\.\./);
    assert.match(output, /› Validated migration consistency\./);
    assert.match(output, /⠋ Planning migrations to apply\.\.\./);
    assert.match(output, /› Planned 1 migration to apply\./);
    assert.match(output, /⠋ Applying '20260719120000_add_users\.sql'\.\.\./);
    assert.ok(
      output.endsWith("✔ Applied '20260719120000_add_users.sql' (42ms)\n"),
    );
    assert.equal(output.match(/\n/g)?.length, 5);
  });

  it("prints stable progress lines for redirected output", (): void => {
    const captured = captureStream(false);
    const progress = createVerboseOutput(captured.stream);

    progress.log({ type: "directory-read-start", directory: "demo" });
    progress.log({ type: "directory-read-done", directory: "demo" });
    progress.log({
      type: "target-resolve-start",
      target: "20260719120000_add_users.sql",
    });
    progress.log({
      file: "20260719120000_add_users.sql",
      type: "target-resolve-done",
    });
    progress.log({ type: "consistency-validation-start" });
    progress.log({ type: "consistency-validation-done" });
    progress.log({ direction: "down", type: "plan-start" });
    progress.log({ count: 1, direction: "down", type: "plan-done" });
    progress.log({
      direction: "down",
      file: "20260719120000_add_users.sql",
      type: "migration-start",
    });
    progress.log({
      direction: "down",
      durationMs: 42,
      file: "20260719120000_add_users.sql",
      type: "migration-done",
    });

    assert.equal(
      captured.read(),
      "Reading migration directory 'demo'...\n" +
        "› Read migration directory 'demo'.\n" +
        "Resolving migration target '20260719120000_add_users.sql'...\n" +
        "› Resolved migration target '20260719120000_add_users.sql'.\n" +
        "Validating migration consistency...\n" +
        "› Validated migration consistency.\n" +
        "Planning migrations to revert...\n" +
        "› Planned 1 migration to revert.\n" +
        "Reverting '20260719120000_add_users.sql'...\n" +
        "✔ Reverted '20260719120000_add_users.sql' (42ms)\n",
    );
  });

  it("prints stable lines when a phase is wider than the terminal", (): void => {
    const captured = captureStream(true);
    captured.stream.columns = 40;
    const progress = createVerboseOutput(captured.stream);

    progress.log({
      database: {
        database: "pg_migrate_test",
        host: "localhost",
        port: 5432,
        user: "gabrieltollstalbom",
      },
      type: "database-connect-start",
    });
    progress.log({
      database: {
        database: "pg_migrate_test",
        host: "localhost",
        port: 5432,
        user: "gabrieltollstalbom",
      },
      type: "database-connect-done",
    });

    assert.equal(
      captured.read(),
      "Connecting to 'pg_migrate_test' at 'localhost:5432' as " +
        "'gabrieltollstalbom'...\n" +
        "› Connected to 'pg_migrate_test' at 'localhost:5432' as " +
        "'gabrieltollstalbom'.\n",
    );
  });

  it("counts wide characters when it checks the terminal width", (): void => {
    const captured = captureStream(true);
    // The message has 36 characters but needs 41 columns with the spinner.
    captured.stream.columns = 40;
    const progress = createVerboseOutput(captured.stream);

    progress.log({ type: "directory-read-start", directory: "日本語" });

    assert.equal(captured.read(), "Reading migration directory '日本語'...\n");
  });

  it("stops the spinner when the terminal becomes too narrow", (): void => {
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const captured = captureStream(true);
      captured.stream.columns = 80;
      const progress = createVerboseOutput(captured.stream);

      progress.log({ type: "directory-read-start", directory: "demo" });
      captured.stream.columns = 20;
      mock.timers.tick(80);
      mock.timers.tick(80);
      progress.log({ type: "directory-read-done", directory: "demo" });

      const output = captured.read();
      assert.ok(
        output.endsWith(
          "Reading migration directory 'demo'...\n" +
            "› Read migration directory 'demo'.\n",
        ),
      );
      assert.equal(output.match(/⠙/g), null);
    } finally {
      mock.timers.reset();
    }
  });

  it("replaces an interactive migration phase with a failure", (): void => {
    const captured = captureStream(true);
    const progress = createVerboseOutput(captured.stream);

    progress.log({
      direction: "up",
      file: "20260530152542_five.sql",
      type: "migration-start",
    });
    progress.log({
      direction: "up",
      durationMs: 1,
      file: "20260530152542_five.sql",
      type: "migration-failed",
    });

    assert.ok(
      captured.read().endsWith("✖ Failed '20260530152542_five.sql' (1ms)\n"),
    );
  });

  it("keeps the active phase when it does not complete", (): void => {
    const captured = captureStream(true);
    const progress = createVerboseOutput(captured.stream);

    progress.log({ type: "directory-read-start", directory: "demo" });
    progress.fail();

    assert.ok(
      captured.read().endsWith("Reading migration directory 'demo'...\n"),
    );
  });

  it("hides detail events but keeps completion events", (): void => {
    const captured = captureStream(false);
    const progress = createProgressOutput(captured.stream, false);

    progress.log({ type: "directory-read-start", directory: "demo" }, false);
    progress.log({ type: "directory-read-done", directory: "demo" }, false);
    progress.log(
      {
        database: {
          database: "demo",
          host: "localhost",
          port: 5432,
          user: "gabe",
        },
        type: "database-disconnect-done",
      },
      false,
    );
    progress.log(
      {
        direction: "up",
        durationMs: 42,
        file: "20260719120000_add_users.sql",
        type: "migration-done",
      },
      false,
    );

    assert.equal(
      captured.read(),
      "✔ Applied '20260719120000_add_users.sql' (42ms)\n",
    );
  });
});
