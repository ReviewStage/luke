/**
 * first-frame-hint.tsx -- whether this browser's tab last read someone signed in, kept for the next load's first frame.
 *
 * The shell's frame app.html draws before the session is read stands a
 * sidebar only where the tab would draw the signed-in shell, and the head's
 * script (`public/app-theme.js`) can know that only from what an earlier
 * load kept. The sidebar's own fold is no such word: the panel keeps it
 * while the sign-in gate stands too. So the tab keeps here whether the
 * account last read signed in, and nothing else of it: set as it reads
 * signed in, taken away as it reads signed out, and left as it stands while
 * the account is unread or a sign-in is under way.
 */

import { useAppState } from "@luke/panel/use-app-state";
import { useEffect } from "react";

/** Where the word is kept, as `public/app-theme.js` reads it. */
const SIGNED_IN_KEY = "luke.signed-in-here";

/** Draws nothing: keeps whether the account last read signed in, for the next load's frame. */
export function FirstFrameHint(): null {
  const status = useAppState()?.account.status;
  useEffect(() => {
    if (status !== "signed-in" && status !== "signed-out") return;
    try {
      if (status === "signed-in") localStorage.setItem(SIGNED_IN_KEY, "true");
      else localStorage.removeItem(SIGNED_IN_KEY);
    } catch {
      // Note that a refused write costs the next load its frame's sidebar and nothing else.
    }
  }, [status]);
  return null;
}
