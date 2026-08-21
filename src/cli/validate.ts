import {
  isCommand,
  type Args,
  type ParsedArgs,
  type ValidatedInvocation,
} from "./model.js";

const GLOBAL_OPTIONS = [
  "config",
  "directory",
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

/** Validates a parsed command, its positionals, and its options. */
export function validateInvocation(parsed: ParsedArgs): ValidatedInvocation {
  const [command, ...positionals] = parsed.positionals;
  if (!isCommand(command)) {
    throw new Error(`Unknown command '${command}'.`);
  }

  switch (command) {
    case "create":
      assertOptions(parsed.values, GLOBAL_OPTIONS);
      return {
        command,
        name: requireName(positionals),
        values: parsed.values,
      };
    case "status":
    case "validate":
      assertNoPositionals(positionals);
      assertOptions(parsed.values, DATABASE_OPTIONS);
      return { command, values: parsed.values };
    case "up":
    case "down":
      assertNoPositionals(positionals);
      assertOptions(parsed.values, MIGRATE_OPTIONS);
      return { command, values: parsed.values };
  }
}
