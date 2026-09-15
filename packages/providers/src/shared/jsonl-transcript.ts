/**
 * The shared half of every on-demand transcript read: the one rendering a
 * provider's mapped lines are joined into. A provider maps its own records
 * into the one line vocabulary — `Developer:` for the person, the agent's own
 * name for its replies, `→` for a tool call, `←` for its answer, `Error:` for
 * a failure the provider recorded — and this module is where those lines
 * become the rendering every provider shares. A message is rendered whole,
 * line breaks and all, and there is no bound on the total: the reader that
 * asked cuts the rendering from the front to what it can carry, so a bound
 * here could only lose words it would have kept.
 */

/**
 * Joins rendered lines into one rendering, or nothing when there are no lines
 * to render. The whole rendering stands, bounded only by the tail the read
 * loaded and the tool-line cuts already applied.
 */
export function boundedTranscript(lines: readonly string[]): string | undefined {
  if (lines.length === 0) return undefined;
  return lines.join("\n");
}
