/**
 * Color rendering mode for CLI output.
 */
export type ColorMode = boolean | "auto";

/**
 * Resolves the configured color mode against terminal capabilities.
 */
export function resolveSupportsColor(
  color: ColorMode | undefined,
  isTTY: boolean,
): boolean {
  const mode = color ?? "auto";
  if (mode === "auto") {
    return isTTY;
  }
  return mode;
}
