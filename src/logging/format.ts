import type { LogObject } from "./logger.js";
import { serializeValue } from "./serialize.js";

interface HumanLogFormatOptions {
  prefixes?: boolean;
  supportsColor?: boolean;
}

function formatLevelPrefix(
  label: string,
  colorCode: number,
  supportsColor: boolean,
): string {
  if (!supportsColor) {
    return `${label}:`;
  }
  return `\u001B[${colorCode}m${label}:\u001B[0m`;
}

function prefixForLogLevel(level: string, supportsColor: boolean): string {
  switch (level) {
    case "warn":
      return formatLevelPrefix("Warning", 33, supportsColor);
    case "error":
      return formatLevelPrefix("Error", 31, supportsColor);
    case "debug":
      return formatLevelPrefix("Debug", 36, supportsColor);
    default:
      return "";
  }
}

function hasFields(value: unknown): boolean {
  return (
    typeof value === "object" && value !== null && Object.keys(value).length > 0
  );
}

/**
 * Formats a structured log event as a human-readable CLI log line.
 */
export function formatHumanLogEvent(
  event: LogObject,
  options: HumanLogFormatOptions = {},
): string {
  const parts: string[] = [];

  if (options.prefixes) {
    const prefix = prefixForLogLevel(
      event.logLevel,
      options.supportsColor ?? false,
    );
    if (prefix !== "") {
      parts.push(prefix);
    }
  }

  parts.push(event.message);

  if (hasFields(event.fields)) {
    parts.push(serializeValue(event.fields));
  }

  return parts.join(" ");
}
