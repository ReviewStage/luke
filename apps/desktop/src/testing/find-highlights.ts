/**
 * find-highlights.ts -- jsdom has no CSS Custom Highlight API and lays nothing out, so a find's tints are read from a stand-in registry, and a range measures as an empty box at the origin.
 */

import { vi } from "vitest";
import { FIND_HIGHLIGHT } from "../renderer/find-matches";

/** The platform's `Highlight`, as the find uses it: a set of ranges with a priority. */
class StandInHighlight extends Set<Range> {
  priority = 0;
}

/** What the find paints now: the text of every match, in the order painted, and of the one it is at. */
interface PaintedHighlights {
  readonly matches: () => string[];
  readonly current: () => string | undefined;
}

/**
 * Installs the stand-in API for one test, answering what each highlight
 * paints from then on.
 */
export function installHighlights(): PaintedHighlights {
  const registry = new Map<string, StandInHighlight>();
  vi.stubGlobal("Highlight", StandInHighlight);
  vi.stubGlobal("CSS", { ...globalThis.CSS, highlights: registry });
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  const painted = (name: string) => [...(registry.get(name) ?? [])].map(String);
  return {
    matches: () => painted(FIND_HIGHLIGHT.MATCH),
    current: () => painted(FIND_HIGHLIGHT.CURRENT).at(0),
  };
}
