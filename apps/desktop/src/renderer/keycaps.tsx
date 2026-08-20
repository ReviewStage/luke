/**
 * A chord drawn as the keys it is: one cap per key, the way a keyboard has
 * them and the way developer tools print them, rather than one chip holding
 * ⌥Space as though it were a word.
 *
 * Nested `kbd` is the element's own idiom for a combination — the outer one is
 * the chord, each inner one is a key — so a reader still announces the chord in
 * one piece and the gaps between the caps are drawn rather than spelled.
 */

import type React from "react";
import { voiceHotkeyKeycaps } from "../shared/voice-hotkey";

export function Keycaps({
  accelerator,
  className,
}: {
  /** The chord as the system registered it, e.g. `Alt+Space`. */
  accelerator: string;
  /** What the surface around the caps calls them, if it needs to say. */
  className?: string;
}): React.JSX.Element {
  return (
    <kbd className={className ? `keycap-chord ${className}` : "keycap-chord"}>
      {/* A chord holds each modifier once and ends in a key no modifier
          spells, so the cap itself is the identity. */}
      {voiceHotkeyKeycaps(accelerator).map((cap) => (
        <kbd className="keycap" key={cap}>
          {cap}
        </kbd>
      ))}
    </kbd>
  );
}
