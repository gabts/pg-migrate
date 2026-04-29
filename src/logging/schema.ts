type LogLevel = "trace" | "debug" | "info" | "warn" | "error";
type LogOutcome = "success" | "failure";

interface LogError {
  code?: string;
  message: string;
  stack?: string;
  type?: string;
}

/**
 * Additional structured fields attached to a log event or record.
 */
export type LogFields = Record<string, unknown>;

/**
 * Structured log record emitted internally and written to a sink.
 */
export interface LogRecord {
  error?: LogError;
  event: {
    action: string;
    duration?: number;
    outcome?: LogOutcome;
  };
  fields?: LogFields;
  level: LogLevel;
  message: string;
  service?: {
    name: "migratorosaurus";
    version?: string;
  };
  time?: string;
}

/**
 * Converts a duration in milliseconds to nanoseconds.
 */
export function durationMsToNs(durationMs: number): number {
  return Math.round(durationMs * 1_000_000);
}

/**
 * Normalizes unknown error values into structured log error fields.
 */
export function normalizeError(error: unknown): LogError {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      ...(code === undefined || code === null || code === ""
        ? {}
        : { code: String(code) }),
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      type: error.name,
    };
  }

  return {
    message: String(error),
  };
}
