import type { ColorMode } from "./color.js";

/**
 * Supported top-level CLI command names.
 */
export type CommandName = "create" | "up" | "down" | "validate" | "status";

type FlagKind = "boolean" | "value";
type CommandScope = "all" | readonly CommandName[];

interface FlagSpec {
  canonical: string;
  aliases: readonly string[];
  kind: FlagKind;
  label: string;
  commands: CommandScope;
}

const flagSpecs: readonly FlagSpec[] = [
  {
    aliases: [],
    canonical: "--json",
    commands: "all",
    kind: "boolean",
    label: "JSON",
  },
  {
    aliases: [],
    canonical: "--quiet",
    commands: "all",
    kind: "boolean",
    label: "Quiet",
  },
  {
    aliases: ["-v"],
    canonical: "--verbose",
    commands: "all",
    kind: "boolean",
    label: "Verbose",
  },
  {
    aliases: [],
    canonical: "--env-file",
    commands: "all",
    kind: "value",
    label: "Env file",
  },
  {
    aliases: [],
    canonical: "--no-color",
    commands: "all",
    kind: "boolean",
    label: "No color",
  },
  {
    aliases: ["-h"],
    canonical: "--help",
    commands: "all",
    kind: "boolean",
    label: "Help",
  },
  {
    aliases: ["-d"],
    canonical: "--directory",
    commands: ["create", "up", "down", "validate", "status"],
    kind: "value",
    label: "Directory",
  },
  {
    aliases: ["-n"],
    canonical: "--name",
    commands: ["create"],
    kind: "value",
    label: "Name",
  },
  {
    aliases: [],
    canonical: "--irreversible",
    commands: ["create"],
    kind: "boolean",
    label: "Irreversible",
  },
  {
    aliases: [],
    canonical: "--url",
    commands: ["up", "down", "validate", "status"],
    kind: "value",
    label: "Database URL",
  },
  {
    aliases: ["-t"],
    canonical: "--target",
    commands: ["up", "down"],
    kind: "value",
    label: "Target",
  },
  {
    aliases: [],
    canonical: "--table",
    commands: ["up", "down", "validate", "status"],
    kind: "value",
    label: "Table",
  },
  {
    aliases: [],
    canonical: "--dry-run",
    commands: ["up", "down"],
    kind: "boolean",
    label: "Dry run",
  },
];

const tokenToSpec: ReadonlyMap<string, FlagSpec> = ((): ReadonlyMap<
  string,
  FlagSpec
> => {
  const map = new Map<string, FlagSpec>();
  for (const spec of flagSpecs) {
    map.set(spec.canonical, spec);
    for (const alias of spec.aliases) {
      map.set(alias, spec);
    }
  }
  return map;
})();

function flagTokens(spec: FlagSpec): string {
  return [spec.canonical, ...spec.aliases].join(", ");
}

function isHelpToken(token: string): boolean {
  return token === "--help" || token === "-h";
}

function toCommandName(token: string | undefined): CommandName | undefined {
  switch (token) {
    case "create":
    case "up":
    case "down":
    case "validate":
    case "status":
      return token;
    case undefined:
      return undefined;
    default:
      return undefined;
  }
}

interface GlobalOptions {
  color: ColorMode;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
}

interface UnknownArgumentIssue {
  kind: "unknown-argument";
  token: string;
}

interface MissingValueIssue {
  kind: "missing-value";
  label: string;
  tokens: string;
}

type TokenValidationIssue = MissingValueIssue | UnknownArgumentIssue;

/**
 * Parsed CLI flags and positional arguments.
 */
export interface ParsedTokens {
  command: string | undefined;
  extraPositional: readonly string[];
  flags: Map<string, string | true>;
  globals: GlobalOptions;
  help: boolean;
  positional: readonly string[];
  validationIssues: readonly TokenValidationIssue[];
}

/**
 * Parses CLI tokens into canonical flag values and positional arguments.
 *
 * This only performs syntactic token scanning. User-facing validation errors
 * are reported by assertValidTokens so callers can still read globals first.
 */
export function parseTokens(tokens: readonly string[]): ParsedTokens {
  const flags = new Map<string, string | true>();
  const globals: GlobalOptions = {
    color: "auto",
    json: false,
    quiet: false,
    verbose: false,
  };
  const validationIssues: TokenValidationIssue[] = [];
  const positional: string[] = [];
  let help = false;
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i]!;
    if (isHelpToken(token)) {
      help = true;
    }

    if (!token.startsWith("-")) {
      positional.push(token);
      i += 1;
      continue;
    }

    const spec = tokenToSpec.get(token);
    if (!spec) {
      validationIssues.push({
        kind: "unknown-argument",
        token,
      });
      i += 1;
      continue;
    }

    if (spec.kind === "boolean") {
      flags.set(spec.canonical, true);
      switch (spec.canonical) {
        case "--json":
          globals.json = true;
          break;
        case "--quiet":
          globals.quiet = true;
          break;
        case "--verbose":
          globals.verbose = true;
          break;
        case "--no-color":
          globals.color = false;
          break;
      }
      i += 1;
      continue;
    }

    const value = tokens[i + 1];
    if (value === undefined) {
      validationIssues.push({
        kind: "missing-value",
        label: spec.label,
        tokens: flagTokens(spec),
      });
      i += 1;
      continue;
    }
    if (isHelpToken(value)) {
      help = true;
    }
    flags.set(spec.canonical, value);
    i += 2;
  }

  const [command, ...extraPositional] = positional;

  return {
    command,
    extraPositional,
    flags,
    globals,
    help,
    positional,
    validationIssues,
  };
}

/**
 * Returns the parsed command name when it is one of the supported commands.
 */
export function commandName(parsed: ParsedTokens): CommandName | undefined {
  return toCommandName(parsed.command);
}

/**
 * Reads a string-valued flag from parsed tokens.
 */
export function valueFlag(
  parsed: ParsedTokens,
  canonical: string,
): string | undefined {
  const value = parsed.flags.get(canonical);
  if (value === undefined || value === true) {
    return undefined;
  }
  return value;
}

/**
 * Returns whether a boolean flag is enabled.
 */
export function booleanFlag(parsed: ParsedTokens, canonical: string): boolean {
  return parsed.flags.get(canonical) === true;
}

/**
 * Validates parsed CLI tokens after globals have been read.
 */
export function assertValidTokens(parsed: ParsedTokens): void {
  const issue = parsed.validationIssues[0];
  if (issue?.kind === "unknown-argument") {
    throw new Error(`Unknown argument: ${issue.token}`);
  }
  if (issue?.kind === "missing-value") {
    throw new Error(`${issue.label} flag (${issue.tokens}) requires a value`);
  }

  const command = commandName(parsed);
  if (parsed.command !== undefined && command === undefined) {
    throw new Error(`Unknown command: ${parsed.command}`);
  }

  if (parsed.help) {
    return;
  }

  for (const canonical of parsed.flags.keys()) {
    const spec = tokenToSpec.get(canonical)!;
    if (spec.commands === "all") {
      continue;
    }
    if (command === undefined || !spec.commands.includes(command)) {
      throw new Error(`Unknown argument: ${canonical}`);
    }
  }
}
