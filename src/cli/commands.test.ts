import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseTokens } from "./args.js";
import { runCommand, type CommandHandlers } from "./commands.js";
import type { CliResultWriter } from "./output.js";
import type { Logger } from "../logging/logger.js";
import type { LogRecord } from "../logging/schema.js";
import type { LogSink } from "../logging/writers.js";
import type { MigrationOptions, ValidateOptions } from "../main.js";

interface CapturedResultWriter extends CliResultWriter {
  jsonValues: unknown[];
  textValues: string[];
}

function createResultWriter(): CapturedResultWriter {
  const jsonValues: unknown[] = [];
  const textValues: string[] = [];

  return {
    jsonValues,
    textValues,
    writeJson(value: unknown): void {
      jsonValues.push(value);
    },
    writeText(value: string): void {
      textValues.push(value);
    },
  };
}

function createLogger(records: LogRecord[]): Logger {
  return {
    emit(record: LogRecord): void {
      records.push(record);
    },
  };
}

function createLogSink(records: LogRecord[]): LogSink {
  return {
    write(record: LogRecord): void {
      records.push(record);
    },
  };
}

function createHandlers(overrides: Partial<CommandHandlers>): CommandHandlers {
  const fail = (): never => {
    throw new Error("Unexpected command handler call");
  };

  return {
    createMigration: fail,
    down: async (): Promise<void> => {
      fail();
    },
    up: async (): Promise<void> => {
      fail();
    },
    validate: async (): Promise<void> => {
      fail();
    },
    ...overrides,
  };
}

describe("commands", (): void => {
  let tempDir: string;

  beforeEach((): void => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "migratorosaurus-command-"),
    );
  });

  afterEach((): void => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("runs create and writes the created file path as text", async (): Promise<void> => {
    const parsed = parseTokens([
      "create",
      "--directory",
      tempDir,
      "--name",
      "create_person",
    ]);
    const resultWriter = createResultWriter();
    const logRecords: LogRecord[] = [];
    const sinkRecords: LogRecord[] = [];

    const status = await runCommand(
      "create",
      parsed,
      parsed.extraPositional,
      resultWriter,
      createLogger(logRecords),
      createLogSink(sinkRecords),
      {
        correlationId: "test-correlation-id",
        json: false,
        quiet: false,
        verbose: false,
      },
    );

    assert.equal(status, 0);
    assert.equal(resultWriter.jsonValues.length, 0);
    const filePath = resultWriter.textValues[0]!;
    assert.equal(path.dirname(filePath), tempDir);
    assert.match(path.basename(filePath), /^\d{14}_create_person\.sql$/);
    assert.equal(logRecords[0]?.event.action, "command.options");
    assert.equal(sinkRecords.length, 0);
  });

  it("runs create and writes JSON results in JSON mode", async (): Promise<void> => {
    const parsed = parseTokens([
      "create",
      "--directory",
      tempDir,
      "--name",
      "create_person",
    ]);
    const resultWriter = createResultWriter();

    const status = await runCommand(
      "create",
      parsed,
      parsed.extraPositional,
      resultWriter,
      createLogger([]),
      createLogSink([]),
      {
        correlationId: "test-correlation-id",
        json: true,
        quiet: false,
        verbose: false,
      },
    );

    assert.equal(status, 0);
    assert.equal(resultWriter.textValues.length, 0);
    const result = resultWriter.jsonValues[0] as {
      command: string;
      file: string;
    };
    assert.equal(result.command, "create");
    assert.equal(path.dirname(result.file), tempDir);
  });

  it("runs validate with resolved runtime options", async (): Promise<void> => {
    const parsed = parseTokens([
      "validate",
      "--url",
      "postgres://example/db",
      "--directory",
      tempDir,
      "--table",
      "custom_history",
    ]);
    const resultWriter = createResultWriter();
    const logSink = createLogSink([]);
    let capturedClientConfig: unknown;
    let capturedOptions: ValidateOptions | undefined;

    const status = await runCommand(
      "validate",
      parsed,
      parsed.extraPositional,
      resultWriter,
      createLogger([]),
      logSink,
      {
        correlationId: "test-correlation-id",
        json: true,
        quiet: true,
        verbose: true,
      },
      createHandlers({
        validate: async (clientConfig, options): Promise<void> => {
          capturedClientConfig = clientConfig;
          capturedOptions = options;
        },
      }),
    );

    assert.equal(status, 0);
    assert.deepEqual(resultWriter.jsonValues, [
      {
        command: "validate",
        ok: true,
      },
    ]);
    assert.equal(capturedClientConfig, "postgres://example/db");
    assert.equal(capturedOptions?.directory, tempDir);
    assert.equal(capturedOptions?.logSink, logSink);
    assert.equal(capturedOptions?.quiet, true);
    assert.equal(capturedOptions?.correlationId, "test-correlation-id");
    assert.equal(capturedOptions?.table, "custom_history");
    assert.equal(capturedOptions?.verbose, true);
  });

  it("runs up with migration options and writes JSON results", async (): Promise<void> => {
    const parsed = parseTokens([
      "up",
      "postgres://example/db",
      "--directory",
      tempDir,
      "--dry-run",
      "--target",
      "20260429123456_create.sql",
    ]);
    const resultWriter = createResultWriter();
    const logSink = createLogSink([]);
    let capturedClientConfig: unknown;
    let capturedOptions: MigrationOptions | undefined;

    const status = await runCommand(
      "up",
      parsed,
      parsed.extraPositional,
      resultWriter,
      createLogger([]),
      logSink,
      {
        correlationId: "test-correlation-id",
        json: true,
        quiet: false,
        verbose: true,
      },
      createHandlers({
        up: async (clientConfig, options): Promise<void> => {
          capturedClientConfig = clientConfig;
          capturedOptions = options;
        },
      }),
    );

    assert.equal(status, 0);
    assert.deepEqual(resultWriter.jsonValues, [
      {
        command: "up",
        dryRun: true,
        ok: true,
        target: "20260429123456_create.sql",
      },
    ]);
    assert.equal(capturedClientConfig, "postgres://example/db");
    assert.equal(capturedOptions?.directory, tempDir);
    assert.equal(capturedOptions?.dryRun, true);
    assert.equal(capturedOptions?.logSink, logSink);
    assert.equal(capturedOptions?.quiet, false);
    assert.equal(capturedOptions?.correlationId, "test-correlation-id");
    assert.equal(capturedOptions?.table, "migration_history");
    assert.equal(capturedOptions?.target, "20260429123456_create.sql");
    assert.equal(capturedOptions?.verbose, true);
  });

  it("dispatches down commands to the down handler", async (): Promise<void> => {
    const parsed = parseTokens(["down", "postgres://example/db"]);
    const resultWriter = createResultWriter();
    let downCalled = false;

    const status = await runCommand(
      "down",
      parsed,
      parsed.extraPositional,
      resultWriter,
      createLogger([]),
      createLogSink([]),
      {
        correlationId: "test-correlation-id",
        json: false,
        quiet: false,
        verbose: false,
      },
      createHandlers({
        down: async (): Promise<void> => {
          downCalled = true;
        },
      }),
    );

    assert.equal(status, 0);
    assert.equal(downCalled, true);
    assert.deepEqual(resultWriter.jsonValues, []);
    assert.deepEqual(resultWriter.textValues, []);
  });
});
