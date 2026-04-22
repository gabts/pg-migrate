import * as assert from "assert";
import { createIo } from "./io.js";

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

describe("io", (): void => {
  it("writes command results to stdout", (): void => {
    const stdout = createWritable(false);
    const stderr = createWritable(false);
    const io = createIo({ stderr, stdout });

    io.result("ok");

    assert.equal(stdout.chunks.join(""), "ok\n");
    assert.equal(stderr.chunks.join(""), "");
  });

  it("routes logs to stderr", (): void => {
    const stdout = createWritable(false);
    const stderr = createWritable(false);
    const io = createIo({ stderr, stdout, verbose: false });

    io.info("hello");
    io.warn("careful");
    io.error("boom");
    io.debug("details");

    assert.equal(stdout.chunks.join(""), "");
    assert.equal(
      stderr.chunks.join(""),
      ["hello\n", "Warning: careful\n", "Error: boom\n"].join(""),
    );
  });

  it("suppresses non-error logs in quiet mode", (): void => {
    const stderr = createWritable(false);
    const io = createIo({
      quiet: true,
      stderr,
      verbose: true,
    });

    io.info("hello");
    io.warn("careful");
    io.debug("details");
    io.error("boom");

    assert.equal(stderr.chunks.join(""), "Error: boom\n");
  });

  it("prints debug logs when verbose is enabled", (): void => {
    const stderr = createWritable(false);
    const io = createIo({
      stderr,
      verbose: true,
    });

    io.debug("details");

    assert.equal(stderr.chunks.join(""), "Debug: details\n");
  });

  it("enables ANSI level prefixes in auto mode only when stderr is a tty", (): void => {
    const stderrWithColor = createWritable(true);
    const withColor = createIo({
      stderr: stderrWithColor,
    });
    withColor.warn("careful");

    assert.match(
      stderrWithColor.chunks.join(""),
      /\u001B\[33mWarning:\u001B\[0m/,
    );

    const stderrNoColor = createWritable(true);
    const noColor = createIo({
      color: false,
      stderr: stderrNoColor,
    });
    noColor.warn("careful");
    assert.equal(stderrNoColor.chunks.join(""), "Warning: careful\n");
  });

  it("allows forcing ANSI prefixes when color is true on non-tty streams", (): void => {
    const stderr = createWritable(false);
    const io = createIo({
      color: true,
      stderr,
      verbose: true,
    });

    io.warn("careful");
    io.error("boom");
    io.debug("details");

    const text = stderr.chunks.join("");
    assert.match(text, /\u001B\[33mWarning:\u001B\[0m careful\n/);
    assert.match(text, /\u001B\[31mError:\u001B\[0m boom\n/);
    assert.match(text, /\u001B\[36mDebug:\u001B\[0m details\n/);
    assert.equal(io.supportsColor, true);
  });

  it("serializes non-string results as JSON lines to stdout", (): void => {
    const stdout = createWritable(false);
    const io = createIo({ stdout });

    io.result({ ok: true });

    assert.equal(stdout.chunks.join(""), '{"ok":true}\n');
  });

  it("writes undefined results safely", (): void => {
    const stdout = createWritable(false);
    const io = createIo({ stdout });

    io.result(undefined);

    assert.equal(stdout.chunks.join(""), "undefined\n");
  });

  it("exposes global mode flags", (): void => {
    const jsonStderr = createWritable(true);
    const jsonIo = createIo({
      json: true,
      stderr: jsonStderr,
      quiet: true,
      verbose: true,
    });

    assert.equal(jsonIo.json, true);
    assert.equal(jsonIo.quiet, true);
    assert.equal(jsonIo.verbose, true);
  });
});
