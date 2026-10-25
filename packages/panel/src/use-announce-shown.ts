import { type Announce, announce } from "@luke/ui";
import { useEffect } from "react";

/**
 * use-announce-shown.ts -- says the words a surface draws as a failure or a notice, from the moment it first draws them.
 *
 * `@luke/ui`'s `useAnnounce` says words each time they change and none a
 * component first draws, as a live region drawn already holding its words
 * would. A note that appears with what went wrong (a refusal under a row, a
 * failed save under an editor) is drawn at that moment and must be heard at
 * that moment, so this says its words as they are first drawn and again each
 * time they change, and takes them back once they change or the note goes.
 * Empty words say nothing, which is how a note not drawn stays quiet.
 */

/** Says `words` through `level` while they stand, and none where they are empty. */
export function useAnnounceShown(level: Announce, words: string): void {
  useEffect(() => announce(level, words), [level, words]);
}
