/**
 * words-owner.ts -- the descriptions' words told which account is signed in, as the window tells them, for a test that draws a description.
 *
 * The words a task was left with are the window's, kept past the test that
 * typed them; the window's owner lets go of them as it mounts, so a test
 * that leaves words unsaved mounts it, as a test whose minute moves mounts
 * `TimeTicks`.
 */

import { useDescriptionWordsOwner } from "../tasks/use-description-editing.js";

/** Tells the descriptions' words which account is signed in, and draws nothing. */
export function WordsOwner(): null {
  useDescriptionWordsOwner();
  return null;
}
