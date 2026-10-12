/**
 * keycaps.tsx -- a chord drawn as one cap per key: the one way the window draws a chord as keys rather than as a menu's inline glyphs.
 *
 * A chord drawn as the keys it is: one cap per key, the way a keyboard has
 * them and the way developer tools print them, rather than one chip holding
 * ⌥Space as though it were a word.
 *
 * Nested `kbd` is the element's own idiom for a combination — the outer one is
 * the chord, each inner one is a key — so a reader still announces the chord in
 * one piece and the gaps between the caps are drawn rather than spelled.
 */

import type React from "react";

export function Keycaps({
  caps,
}: {
  /** The chord's keys in the order a Mac writes them, e.g. `["⌥", "Space"]`. */
  caps: readonly string[];
}): React.JSX.Element {
  return (
    <kbd className="keycap-chord">
      {/* A chord holds each modifier once and ends in a key no modifier
          spells, so the cap itself is the identity. */}
      {caps.map((cap) => (
        <kbd className="keycap" key={cap}>
          {cap}
        </kbd>
      ))}
    </kbd>
  );
}
