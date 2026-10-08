import {
  isCommand,
  type Args,
  type Command,
  type ParsedArgs,
  type ValidatedInvocation,
} from "./model.js";

const GLOBAL_OPTIONS = [
  "directory",
  "env-file",
  "help",
  "no-color",
  "quiet",
  "verbose",
] as const;
const TOP_LEVEL_OPTIONS = [...GLOBAL_OPTIONS, "version"] as const;
const DATABASE_OPTIONS = [...GLOBAL_OPTIONS, "table", "url"] as const;
const STATUS_OPTIONS = [...DATABASE_OPTIONS, "fail-on-pending"] as const;
const MIGRATE_OPTIONS = [...DATABASE_OPTIONS, "target"] as const;

function assertNoPositionals(positionals: string[]): void {
  const extra = positionals[0];
  if (extra !== undefined) {
    throw new Error(`Unexpected positional '${extra}'.`);
  }
}

function requireArgument(positionals: string[], argument: string): string {
  const value = positionals[0];
  if (value === undefined) {
    throw new Error(`Missing required argument '${argument}'.`);
  }
  const extra = positionals[1];
  if (extra !== undefined) {
    throw new Error(`Unexpected positional '${extra}'.`);
  }
  return value;
}

function assertOptions(values: Args, allowed: readonly string[]): void {
  for (const key of Object.keys(values)) {
    if (!allowed.includes(key)) {
      throw new Error(`Unknown option '--${key}'.`);
    }
  }
}

function validateHelpTopic(positionals: string[]): Command | "help" {
  const [topic, ...extra] = positionals;
  if (topic === undefined) {
    return "help";
  }
  if (!isCommand(topic)) {
    throw new Error(`Unknown command '${topic}'.`);
  }
  assertNoPositionals(extra);
  return topic;
}

/** Validates a parsed command, help or version request and its arguments. */
export function validateInvocation(
  parsed: ParsedArgs,
):
  | ValidatedInvocation
  | { command: "help"; topic: Command | "help" }
  | { command: "version" } {
  const [command, ...positionals] = parsed.positionals;
  if (parsed.values.quiet === true && parsed.values.verbose === true) {
    throw new Error("Option '--quiet' cannot be used with '--verbose'.");
  }
  if (
    command === undefined &&
    parsed.values.version === true &&
    parsed.values.help !== true
  ) {
    assertOptions(parsed.values, TOP_LEVEL_OPTIONS);
    // Quiet would hide the version, which is the only output.
    if (parsed.values.quiet === true) {
      throw new Error("Option '--quiet' cannot be used with '--version'.");
    }
    return { command: "version" };
  }
  // Options without a command suggest a script whose command is empty, such
  // as an unset variable.
  if (
    command === undefined &&
    parsed.values.help !== true &&
    Object.keys(parsed.values).length > 0
  ) {
    throw new Error("Missing required argument 'command'.");
  }
  if (command === undefined || command === "help") {
    const topic = validateHelpTopic(positionals);
    assertOptions(parsed.values, TOP_LEVEL_OPTIONS);
    return { command: "help", topic };
  }
  if (!isCommand(command)) {
    throw new Error(`Unknown command '${command}'.`);
  }

  const help = parsed.values.help === true;
  switch (command) {
    case "create":
      assertOptions(parsed.values, GLOBAL_OPTIONS);
      if (help) {
        // Help for create does not require the name.
        assertNoPositionals(positionals.slice(1));
        return { command: "help", topic: command };
      }
      return {
        command,
        name: requireArgument(positionals, "name"),
        values: parsed.values,
      };
    case "status":
    case "validate":
      assertNoPositionals(positionals);
      assertOptions(
        parsed.values,
        command === "status" ? STATUS_OPTIONS : DATABASE_OPTIONS,
      );
      return help
        ? { command: "help", topic: command }
        : { command, values: parsed.values };
    case "up":
    case "down":
      assertNoPositionals(positionals);
      assertOptions(parsed.values, MIGRATE_OPTIONS);
      return help
        ? { command: "help", topic: command }
        : { command, values: parsed.values };
    case "repair":
      assertOptions(parsed.values, DATABASE_OPTIONS);
      if (help) {
        assertNoPositionals(positionals.slice(1));
        return { command: "help", topic: command };
      }
      return {
        command,
        target: requireArgument(positionals, "target"),
        values: parsed.values,
      };
  }
}
