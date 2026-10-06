import {
  isCommand,
  type Args,
  type Command,
  type ParsedArgs,
  type ValidatedInvocation,
} from "./model.js";

const GLOBAL_OPTIONS = [
  "config",
  "directory",
  "help",
  "no-color",
  "quiet",
  "verbose",
] as const;
const DATABASE_OPTIONS = [...GLOBAL_OPTIONS, "table", "url"] as const;
const MIGRATE_OPTIONS = [...DATABASE_OPTIONS, "target"] as const;

function assertNoPositionals(positionals: string[]): void {
  const extra = positionals[0];
  if (extra !== undefined) {
    throw new Error(`Unexpected positional '${extra}'.`);
  }
}

function requireName(positionals: string[]): string {
  const name = positionals[0];
  if (name === undefined) {
    throw new Error("Missing required argument 'name'.");
  }
  const extra = positionals[1];
  if (extra !== undefined) {
    throw new Error(`Unexpected positional '${extra}'.`);
  }
  return name;
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

/** Validates a parsed command or help request and its arguments. */
export function validateInvocation(
  parsed: ParsedArgs,
): ValidatedInvocation | { command: "help"; topic: Command | "help" } {
  const [command, ...positionals] = parsed.positionals;
  if (command === undefined || command === "help") {
    const topic = validateHelpTopic(positionals);
    assertOptions(parsed.values, GLOBAL_OPTIONS);
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
        name: requireName(positionals),
        values: parsed.values,
      };
    case "status":
    case "validate":
      assertNoPositionals(positionals);
      assertOptions(parsed.values, DATABASE_OPTIONS);
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
  }
}
