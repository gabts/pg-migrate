import { appendNewline, serializeValue } from "./serialize.js";

/**
 * Logging contract used throughout the migrator runtime.
 */
export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
}

/**
 * Structured log fields attached to log events.
 */
export type LogFields = Record<string, unknown>;

/**
 * Structured log object emitted by the logger.
 */
export interface LogObject {
  logLevel: string;
  message: string;
  fields?: LogFields;
}

/**
 * Consumes structured log objects.
 */
export interface LogWriter {
  write(event: LogObject): void;
}

interface LogJsonWritable {
  write(chunk: string): boolean | void;
}

/**
 * Options for creating a configured logger instance.
 */
export interface LoggerOptions {
  quiet?: boolean;
  verbose?: boolean;
  writer?: LogWriter;
}

/**
 * Applies standard logger options to a logger implementation.
 */
export function withLoggerOptions(
  logger: Logger,
  options: Pick<LoggerOptions, "quiet" | "verbose"> = {},
): Logger {
  const quiet = options.quiet ?? false;
  const verbose = options.verbose;

  return {
    info(message: string, fields?: LogFields): void {
      if (quiet) {
        return;
      }
      logger.info(message, fields);
    },
    warn(message: string, fields?: LogFields): void {
      if (quiet) {
        return;
      }
      logger.warn(message, fields);
    },
    error(message: string, fields?: LogFields): void {
      logger.error(message, fields);
    },
    debug(message: string, fields?: LogFields): void {
      if (quiet || verbose === false) {
        return;
      }
      logger.debug(message, fields);
    },
  };
}

function serializeLogObject(event: LogObject): string {
  try {
    const serialized = JSON.stringify(event);
    if (serialized !== undefined) {
      return serialized;
    }
  } catch {
    // Fallback for values JSON cannot serialize (e.g. BigInt, circular refs).
  }

  const fallback: LogObject = {
    logLevel: event.logLevel,
    message: event.message,
  };
  if (event.fields && Object.keys(event.fields).length > 0) {
    fallback.fields = Object.fromEntries(
      Object.entries(event.fields).map(([key, value]): [string, string] => [
        key,
        serializeValue(value),
      ]),
    );
  }

  return JSON.stringify(fallback);
}

/**
 * Creates a writer that writes structured log objects as newline-delimited JSON.
 */
export function createJsonLogWriter(stream: LogJsonWritable): LogWriter {
  return {
    write(event: LogObject): void {
      stream.write(appendNewline(serializeLogObject(event)));
    },
  };
}

/**
 * Creates a logger that emits structured log objects.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const writer = options.writer ?? createJsonLogWriter(process.stderr);

  function write(logLevel: string, message: string, fields?: LogFields): void {
    const event: LogObject = {
      logLevel,
      message,
    };
    if (fields && Object.keys(fields).length > 0) {
      event.fields = fields;
    }
    writer.write(event);
  }

  return withLoggerOptions(
    {
      info(message: string, fields?: LogFields): void {
        write("info", message, fields);
      },
      warn(message: string, fields?: LogFields): void {
        write("warn", message, fields);
      },
      error(message: string, fields?: LogFields): void {
        write("error", message, fields);
      },
      debug(message: string, fields?: LogFields): void {
        write("debug", message, fields);
      },
    },
    {
      quiet: options.quiet,
      verbose: options.verbose ?? false,
    },
  );
}
