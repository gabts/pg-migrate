import type { LogEvent, LogSink } from "./model.js";

/** Wraps the caller's log sink so that it cannot change command behavior. */
export function withSafeLog<T extends { log?: LogSink }>(
  options: T,
): T & { log: LogSink } {
  return {
    ...options,
    log(event: LogEvent): undefined {
      // Call the sink as a method so that it can use 'this'.
      try {
        void Promise.resolve(options.log?.(event)).catch(() => {});
      } catch {}
    },
  };
}
