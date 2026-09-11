/**
 * The shared half of every on-demand transcript read: the cut a rendering is
 * held to when it is longer than its reader can carry. A provider maps its own
 * records into the one line vocabulary — `Developer:` for the person, the agent's own
 * name for its replies, `→` for a tool call, `←` for its answer, `Error:` for
 * a failure the provider recorded — and this module is the one cut every
 * rendering shares. A message is rendered whole, line breaks and all, and
 * there is no bound on the total: the reader that asked cuts the rendering
 * from the front to what it can carry, so a second bound here could only lose
 * words it would have kept.
 */

import { OMISSION_MARKER } from "@sidecar/session";

/**
 * Joins rendered lines into one rendering, or nothing when there are no lines
 * to render. With no maximum the whole rendering stands, bounded only by the
 * tail the read loaded and the tool-line cuts already applied. When a caller
 * asks for one, the newest turns win the space: a question about a session is
 * almost always about where it is now, so the rendering is cut from the
 * front, at a line, and says so.
 */
export function boundedTranscript(
  lines: readonly string[],
  maximumLength?: number,
): string | undefined {
  if (lines.length === 0) return undefined;
  let rendered = lines.join("\n");
  if (maximumLength !== undefined && rendered.length > maximumLength) {
    const kept = rendered.slice(rendered.length - maximumLength);
    const firstWholeLine = kept.indexOf("\n");
    rendered = `${OMISSION_MARKER}\n${firstWholeLine >= 0 ? kept.slice(firstWholeLine + 1) : kept}`;
  }
  return rendered;
}
