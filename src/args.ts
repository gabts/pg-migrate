import type { ColorMode } from "./logger.js";

export type CommandName = "create" | "up" | "down" | "validate";

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
    commands: ["create", "up", "down", "validate"],
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
    canonical: "--url",
    commands: ["up", "down", "validate"],
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
    commands: ["up", "down", "validate"],
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

const tokenToSpec: ReadonlyMap<string, FlagSpec> = (() => {
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

export interface ParsedTokens {
  flags: Map<string, string | true>;
  positional: readonly string[];
}

export function parseTokens(tokens: readonly string[]): ParsedTokens {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i]!;
    if (!token.startsWith("-")) {
      positional.push(token);
      i += 1;
      continue;
    }

    const spec = tokenToSpec.get(token);
    if (!spec) {
      throw new Error(`Unknown argument: ${token}`);
    }

    if (spec.kind === "boolean") {
      flags.set(spec.canonical, true);
      i += 1;
      continue;
    }

    const value = tokens[i + 1];
    if (value === undefined) {
      throw new Error(
        `${spec.label} flag (${flagTokens(spec)}) requires a value`,
      );
    }
    flags.set(spec.canonical, value);
    i += 2;
  }

  return { flags, positional };
}

export function hasHelpFlag(tokens: readonly string[]): boolean {
  return tokens.includes("--help") || tokens.includes("-h");
}

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

export function booleanFlag(parsed: ParsedTokens, canonical: string): boolean {
  return parsed.flags.get(canonical) === true;
}

export function assertFlagsAllowedFor(
  parsed: ParsedTokens,
  command: CommandName | undefined,
): void {
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

export interface GlobalOptions {
  color: ColorMode;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
}

export function extractGlobals(parsed: ParsedTokens): GlobalOptions {
  return {
    color: booleanFlag(parsed, "--no-color") ? false : "auto",
    json: booleanFlag(parsed, "--json"),
    quiet: booleanFlag(parsed, "--quiet"),
    verbose: booleanFlag(parsed, "--verbose"),
  };
}
