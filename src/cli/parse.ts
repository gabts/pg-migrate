import * as util from "node:util";
import type { ParsedArgs } from "./model.js";

const optionsDescriptors = {
  directory: {
    type: "string",
    short: "d",
  },
  "env-file": {
    type: "string",
  },
  "fail-on-pending": {
    type: "boolean",
  },
  help: {
    type: "boolean",
    short: "h",
  },
  "no-color": {
    type: "boolean",
  },
  quiet: {
    type: "boolean",
    short: "q",
  },
  table: {
    type: "string",
  },
  target: {
    type: "string",
  },
  url: {
    type: "string",
    short: "u",
  },
  verbose: {
    type: "boolean",
    short: "v",
  },
  version: {
    type: "boolean",
  },
} as const satisfies util.ParseArgsConfig["options"];

// util.parseArgs adds explanations after the first sentence, separated by a
// space or a line break. Keep only the first sentence to use the CLI style.
function firstSentenceOf(error: unknown): unknown {
  if (
    error instanceof TypeError &&
    "code" in error &&
    String(error.code).startsWith("ERR_PARSE_ARGS")
  ) {
    const [sentence = error.message] = error.message.split(/\.\s/);
    return new Error(sentence.endsWith(".") ? sentence : `${sentence}.`);
  }
  return error;
}

/** Parses raw CLI arguments into positionals and option values. */
export function parseArgs(args: string[]): ParsedArgs {
  try {
    const result = util.parseArgs({
      args,
      options: optionsDescriptors,
      allowPositionals: true,
      tokens: true,
    });
    const seen = new Set<string>();
    for (const token of result.tokens) {
      if (token.kind !== "option") {
        continue;
      }
      // A short option takes the rest of its argument as the value, so '-d=db'
      // sets '=db'. Reject it rather than guess what was meant.
      if (
        token.inlineValue === true &&
        !token.rawName.startsWith("--") &&
        token.value.startsWith("=")
      ) {
        throw new Error(`Unexpected '=' after option '${token.rawName}'.`);
      }
      // util.parseArgs keeps the last value of a repeated option.
      if (seen.has(token.name)) {
        throw new Error(`Repeated option '--${token.name}'.`);
      }
      seen.add(token.name);
    }
    const { positionals, values } = result;
    return { positionals, values };
  } catch (error) {
    throw firstSentenceOf(error);
  }
}
