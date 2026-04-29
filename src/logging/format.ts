import type { LogFields, LogRecord } from "./schema.js";
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
    case "trace":
      return formatLevelPrefix("Trace", 36, supportsColor);
    default:
      return "";
  }
}

function isObject(value: unknown): value is LogFields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatText(value: string): string {
  return value.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

function formatField(key: string, value: unknown): string {
  return `${key}=${
    typeof value === "string" ? formatText(value) : serializeValue(value)
  }`;
}

function durationMs(record: LogRecord): number | undefined {
  if (record.event.duration === undefined) {
    return undefined;
  }
  return Math.round(record.event.duration / 1_000_000);
}

function migratorosaurusFields(record: LogRecord): LogFields {
  const fields = record.fields?.migratorosaurus;
  return isObject(fields) ? fields : {};
}

function migrationName(record: LogRecord): string | undefined {
  const migration = migratorosaurusFields(record).migration;
  if (!isObject(migration)) {
    return undefined;
  }
  return typeof migration.name === "string" ? migration.name : undefined;
}

function collectDetails(record: LogRecord): string[] {
  const data = migratorosaurusFields(record);
  const details: string[] = [];
  const detailKeys = new Set<string>();
  const migration = migrationName(record);
  const duration = durationMs(record);

  if (migration !== undefined) {
    detailKeys.add("migration");
    details.push(formatField("migration", migration));
  }
  if (typeof data.step_count === "number") {
    detailKeys.add("step_count");
    details.push(formatField("count", data.step_count));
  }
  if (typeof data.table === "string") {
    detailKeys.add("table");
    details.push(formatField("table", data.table));
  }
  if (typeof data.target === "string") {
    detailKeys.add("target");
    details.push(formatField("target", data.target));
  }
  if (data.dry_run === true) {
    detailKeys.add("dry_run");
    details.push(formatField("dry_run", data.dry_run));
  }
  if (data.has_sql === false) {
    detailKeys.add("has_sql");
    details.push(formatField("has_sql", data.has_sql));
  }
  if (duration !== undefined) {
    detailKeys.add("duration");
    details.push(formatField("duration", `${duration}ms`));
  }
  if (record.error?.code !== undefined) {
    detailKeys.add("code");
    details.push(formatField("code", record.error.code));
  }
  if (record.error !== undefined && record.message !== record.error.message) {
    detailKeys.add("error");
    details.push(formatField("error", record.error.message));
  }
  if (record.event.action === "validation.summary") {
    if (typeof data.pending_up_count === "number") {
      detailKeys.add("pending_up_count");
      details.push(formatField("pending_up", data.pending_up_count));
    }
    if (typeof data.rollbackable_down_count === "number") {
      detailKeys.add("rollbackable_down_count");
      details.push(
        formatField("rollbackable_down", data.rollbackable_down_count),
      );
    }
    if (typeof data.next_down_count === "number") {
      detailKeys.add("next_down_count");
      details.push(formatField("next_down", data.next_down_count));
    }
  }
  if (record.level === "debug" || record.level === "trace") {
    for (const [key, value] of Object.entries(data)) {
      if (key === "correlation_id" || detailKeys.has(key)) {
        continue;
      }
      details.push(formatField(key, value));
    }
  }

  return details;
}

/**
 * Formats a structured log record as a human-readable CLI log line.
 */
export function formatHumanLogRecord(
  record: LogRecord,
  options: HumanLogFormatOptions = {},
): string {
  const parts: string[] = [];

  if (options.prefixes) {
    const prefix = prefixForLogLevel(
      record.level,
      options.supportsColor ?? false,
    );
    if (prefix !== "") {
      parts.push(prefix);
    }
  }

  parts.push(formatText(record.message), ...collectDetails(record));
  return parts.join(" ");
}
