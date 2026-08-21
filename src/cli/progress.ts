import * as readline from "node:readline";
import { formatEvent } from "./format.js";
import type { CliLogEvent } from "./model.js";

interface ProgressOutput {
  fail(): void;
  log(event: CliLogEvent, verbose?: boolean): void;
  stop(): void;
}

interface TerminalStream extends NodeJS.WritableStream {
  columns?: number;
  isTTY?: boolean;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function isAlwaysVisible(event: CliLogEvent): boolean {
  switch (event.type) {
    case "migration-done":
    case "migration-failed":
    case "no-pending":
    case "no-applied":
    case "target-current":
    case "file-created":
      return true;
    default:
      return false;
  }
}

/** Writes migration progress to a terminal stream. */
export function createProgressOutput(
  stream: TerminalStream,
  colors: boolean,
): ProgressOutput {
  let active = false;
  let activeMessage: string | undefined;
  let frameIndex = 0;
  let timer: NodeJS.Timeout | undefined;

  function stop(): void {
    if (!active) {
      return;
    }
    active = false;
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    readline.clearLine(stream, 0);
    readline.cursorTo(stream, 0);
    activeMessage = undefined;
  }

  function start(message: string): void {
    stop();
    const spinnerWidth = message.length + 2;
    const fitsTerminal =
      stream.columns === undefined || spinnerWidth < stream.columns;
    if (!stream.isTTY || !fitsTerminal) {
      stream.write(message + "\n");
      return;
    }
    active = true;
    activeMessage = message;
    frameIndex = 0;

    function render(): void {
      readline.cursorTo(stream, 0);
      stream.write(`${SPINNER_FRAMES[frameIndex]} ${message}`);
      frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
    }

    render();
    timer = setInterval(render, 80);
    timer.unref();
  }

  function fail(): void {
    const message = activeMessage;
    stop();
    if (message) {
      stream.write(message + "\n");
    }
  }

  function log(event: CliLogEvent, verbose = true): void {
    if (!verbose && !isAlwaysVisible(event)) {
      return;
    }
    switch (event.type) {
      case "file-create-start":
      case "directory-read-start":
      case "filenames-validation-start":
      case "sql-read-start":
      case "sql-validation-start":
      case "database-connect-start":
      case "lock-acquire-start":
      case "history-definition-read-start":
      case "history-definition-validation-start":
      case "applied-read-start":
      case "target-resolve-start":
      case "consistency-validation-start":
      case "plan-start":
      case "history-initialize-start":
      case "migration-start":
        start(formatEvent(event, colors));
        return;
    }
    stop();
    stream.write(formatEvent(event, colors) + "\n");
  }

  return { fail, log, stop };
}
