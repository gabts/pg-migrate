import * as assert from "assert";
import { createLogger } from "./logger.js";

interface FakeWritable {
  chunks: string[];
  isTTY: boolean;
  write(chunk: string): boolean;
}

function createWritable(isTTY = false): FakeWritable {
  const chunks: string[] = [];

  return {
    chunks,
    isTTY,
    write(chunk: string): boolean {
      chunks.push(chunk);
      return true;
    },
  };
}

describe("logger", (): void => {
  it("writes info/warn/error to stderr and hides debug by default", (): void => {
    const stderr = createWritable(false);
    const log = createLogger({ stderr });

    log.info("hello");
    log.warn("careful");
    log.error("boom");
    log.debug("details");

    assert.equal(
      stderr.chunks.join(""),
      ["hello\n", "Warning: careful\n", "Error: boom\n"].join(""),
    );
  });

  it("suppresses non-error logs in quiet mode", (): void => {
    const stderr = createWritable(false);
    const log = createLogger({
      quiet: true,
      stderr,
      verbose: true,
    });

    log.info("hello");
    log.warn("careful");
    log.debug("details");
    log.error("boom");

    assert.equal(stderr.chunks.join(""), "Error: boom\n");
  });

  it("prints debug when verbose is enabled", (): void => {
    const stderr = createWritable(false);
    const log = createLogger({
      stderr,
      verbose: true,
    });

    log.debug("details");

    assert.equal(stderr.chunks.join(""), "Debug: details\n");
  });

  it("uses ANSI prefixes in auto mode only when stderr is a tty", (): void => {
    const ttyStderr = createWritable(true);
    const withColor = createLogger({
      stderr: ttyStderr,
      verbose: true,
    });

    withColor.warn("careful");
    withColor.error("boom");
    withColor.debug("details");

    const ttyText = ttyStderr.chunks.join("");
    assert.match(ttyText, /\u001B\[33mWarning:\u001B\[0m careful\n/);
    assert.match(ttyText, /\u001B\[31mError:\u001B\[0m boom\n/);
    assert.match(ttyText, /\u001B\[36mDebug:\u001B\[0m details\n/);

    const noColorStderr = createWritable(true);
    const noColor = createLogger({
      color: false,
      stderr: noColorStderr,
      verbose: true,
    });
    noColor.warn("careful");
    noColor.error("boom");
    noColor.debug("details");

    assert.equal(
      noColorStderr.chunks.join(""),
      ["Warning: careful\n", "Error: boom\n", "Debug: details\n"].join(""),
    );
  });

  it("allows forcing ANSI prefixes when color is true on non-tty streams", (): void => {
    const stderr = createWritable(false);
    const log = createLogger({
      color: true,
      stderr,
      verbose: true,
    });

    log.warn("careful");
    log.error("boom");
    log.debug("details");

    const text = stderr.chunks.join("");
    assert.match(text, /\u001B\[33mWarning:\u001B\[0m careful\n/);
    assert.match(text, /\u001B\[31mError:\u001B\[0m boom\n/);
    assert.match(text, /\u001B\[36mDebug:\u001B\[0m details\n/);
  });

  it("does not append a second newline for newline-terminated messages", (): void => {
    const stderr = createWritable(false);
    const log = createLogger({ stderr });

    log.info("hello\n");

    assert.equal(stderr.chunks.join(""), "hello\n");
  });
});
