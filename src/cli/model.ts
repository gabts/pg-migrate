import type { DatabaseOptions, LogEvent, MigrateOptions } from "../main.js";

const COMMANDS = ["create", "status", "validate", "up", "down"] as const;

/** A recognized CLI command name. */
export type Command = (typeof COMMANDS)[number];

/**
 * Option values a CLI invocation can carry, all optional at parse time.
 */
export interface Args {
  config?: string;
  directory?: string;
  "no-color"?: boolean;
  quiet?: boolean;
  table?: string;
  target?: string;
  url?: string;
  verbose?: boolean;
}

/** Parsed CLI arguments before command validation. */
export interface ParsedArgs {
  positionals: string[];
  values: Args;
}

type CreateEvent =
  | { type: "file-create-start"; directory: string }
  | { type: "file-created"; path: string };

/** A library or CLI create progress event. */
export type CliLogEvent = LogEvent | CreateEvent;

/** Receives progress events used by the CLI synchronously. */
export type CliLogSink = (event: CliLogEvent) => undefined;

/** A command with valid positionals and options. */
export type ValidatedInvocation =
  | { command: "create"; name: string; values: Args }
  | {
      command: "status" | "validate" | "up" | "down";
      values: Args;
    };

/** A command with complete options. */
export type ResolvedInvocation =
  | {
      command: "create";
      options: { directory: string; name: string };
    }
  | { command: "status"; options: DatabaseOptions }
  | { command: "validate"; options: DatabaseOptions }
  | { command: "up"; options: MigrateOptions }
  | { command: "down"; options: MigrateOptions };

/** Returns whether a value is a recognized CLI command name. */
export function isCommand(value: unknown): value is Command {
  return COMMANDS.some((command) => command === value);
}
