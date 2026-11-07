/**
 * words-owner.ts -- the descriptions' words told which account is signed in, as the window tells them, and let go of as another signs in, for a test that draws a description.
 *
 * The words a task was left with are the window's, kept for as long as its
 * document stands and so past the test that left them. A test that leaves
 * words unsaved mounts `WordsOwner` and lets go of them before its roots go
 * (`letGoOfWords`), as the window does once another account signs in.
 */

import { act } from "react";
import { useDescriptionWordsOwner } from "../tasks/use-description-editing.js";
import { signedInAs } from "./app-state.js";
import { writeAppState } from "./copy-feedback.js";

/** An account no test signs in as, whose signing in lets go of every other's words. */
const PASSERBY = {
  id: "user-passerby",
  email: "passerby@example.com",
  name: "Passerby",
} as const;

/** Tells the descriptions' words which account is signed in, and draws nothing. */
export function WordsOwner(): null {
  useDescriptionWordsOwner();
  return null;
}

/**
 * Lets go of the words the test's descriptions were left with, and of any
 * save of them still out, by signing another account in while `WordsOwner`
 * stands: call it before the test's roots unmount.
 */
export async function letGoOfWords(): Promise<void> {
  await act(async () => writeAppState(signedInAs(PASSERBY)));
}
