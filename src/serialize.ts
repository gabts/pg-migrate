/**
 * Serializes arbitrary values for logs and CLI output.
 */
export function serializeValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) {
      return serialized;
    }
  } catch {
    // Fallback for values JSON cannot serialize (e.g. BigInt, circular refs).
  }

  return String(value);
}

/**
 * Ensures rendered output ends with exactly one trailing newline.
 */
export function appendNewline(value: string): string {
  if (value.endsWith("\n")) {
    return value;
  }
  return `${value}\n`;
}
