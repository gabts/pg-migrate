import * as assert from "assert";
import {
  createJsonLogWriter,
  createLogger,
  type LogObject,
  type LogWriter,
  withLoggerOptions,
} from "./logger.js";

interface CapturedLogWriter {
  chunks: LogObject[];
  writer: LogWriter;
}

function createCapturedLogWriter(): CapturedLogWriter {
  const chunks: LogObject[] = [];
  return {
    chunks,
    writer: {
      write(event: LogObject): void {
        chunks.push(event);
      },
    },
  };
}

describe("logger", (): void => {
  it("emits info/warn/error objects and hides debug by default", (): void => {
    const capture = createCapturedLogWriter();
    const logger = createLogger({
      writer: capture.writer,
    });

    logger.info("hello");
    logger.warn("careful");
    logger.error("boom");
    logger.debug("details");

    assert.deepEqual(capture.chunks, [
      { logLevel: "info", message: "hello" },
      { logLevel: "warn", message: "careful" },
      { logLevel: "error", message: "boom" },
    ]);
  });

  it("suppresses non-error logs in quiet mode", (): void => {
    const capture = createCapturedLogWriter();
    const logger = createLogger({
      quiet: true,
      verbose: true,
      writer: capture.writer,
    });

    logger.info("hello");
    logger.warn("careful");
    logger.debug("details");
    logger.error("boom");

    assert.deepEqual(capture.chunks, [{ logLevel: "error", message: "boom" }]);
  });

  it("prints debug when verbose is enabled", (): void => {
    const capture = createCapturedLogWriter();
    const logger = createLogger({
      verbose: true,
      writer: capture.writer,
    });

    logger.debug("details");

    assert.deepEqual(capture.chunks, [
      { logLevel: "debug", message: "details" },
    ]);
  });

  it("applies quiet and verbose filtering to wrapped loggers", (): void => {
    const capture = createCapturedLogWriter();
    const logger = withLoggerOptions(
      createLogger({
        verbose: true,
        writer: capture.writer,
      }),
      {
        quiet: true,
        verbose: true,
      },
    );

    logger.info("hello");
    logger.warn("careful");
    logger.debug("details");
    logger.error("boom");

    assert.deepEqual(capture.chunks, [{ logLevel: "error", message: "boom" }]);
  });

  it("leaves wrapped logger debug behavior unchanged when verbose is omitted", (): void => {
    const capture = createCapturedLogWriter();
    const logger = withLoggerOptions({
      debug(message: string): void {
        capture.writer.write({ logLevel: "debug", message });
      },
      error(message: string): void {
        capture.writer.write({ logLevel: "error", message });
      },
      info(message: string): void {
        capture.writer.write({ logLevel: "info", message });
      },
      warn(message: string): void {
        capture.writer.write({ logLevel: "warn", message });
      },
    });

    logger.debug("details");

    assert.deepEqual(capture.chunks, [
      { logLevel: "debug", message: "details" },
    ]);
  });

  it("emits error messages", (): void => {
    const capture = createCapturedLogWriter();
    const logger = createLogger({
      writer: capture.writer,
    });

    logger.error("db down");

    assert.deepEqual(capture.chunks, [
      { logLevel: "error", message: "db down" },
    ]);
  });

  it("supports structured fields for all levels", (): void => {
    const capture = createCapturedLogWriter();
    const logger = createLogger({
      verbose: true,
      writer: capture.writer,
    });

    logger.info("hello", { run: "up" });
    logger.warn("careful", { count: 2 });
    logger.error("migration failed", {
      file: "20260416090000_create.sql",
    });
    logger.debug("details", {
      dryRun: true,
    });

    assert.deepEqual(capture.chunks, [
      {
        fields: { run: "up" },
        logLevel: "info",
        message: "hello",
      },
      {
        fields: { count: 2 },
        logLevel: "warn",
        message: "careful",
      },
      {
        fields: { file: "20260416090000_create.sql" },
        logLevel: "error",
        message: "migration failed",
      },
      {
        fields: { dryRun: true },
        logLevel: "debug",
        message: "details",
      },
    ]);
  });

  it("writes JSON lines with the JSON writer", (): void => {
    const chunks: string[] = [];
    const stringOnlyStream = {
      write(chunk: string): boolean {
        chunks.push(chunk);
        return true;
      },
    };
    const logger = createLogger({
      writer: createJsonLogWriter(stringOnlyStream),
    });

    logger.info("hello");
    logger.error("migration failed", {
      file: "20260416090000_create.sql",
    });

    assert.deepEqual(chunks, [
      '{"logLevel":"info","message":"hello"}\n',
      '{"logLevel":"error","message":"migration failed","fields":{"file":"20260416090000_create.sql"}}\n',
    ]);
  });

  it("serializes non-JSON field values safely with the JSON writer", (): void => {
    const chunks: string[] = [];
    const stringOnlyStream = {
      write(chunk: string): boolean {
        chunks.push(chunk);
        return true;
      },
    };
    const logger = createLogger({
      writer: createJsonLogWriter(stringOnlyStream),
    });

    logger.info("hello", {
      count: 1n,
    });

    assert.deepEqual(chunks, [
      '{"logLevel":"info","message":"hello","fields":{"count":"1"}}\n',
    ]);
  });
});
