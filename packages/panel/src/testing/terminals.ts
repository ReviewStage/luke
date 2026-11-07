/**
 * terminals.ts -- a window's terminals of the test's own: the lists read from what the test kept in session storage, and the sessions let go as the test finishes, as a window's are as it closes.
 *
 * A case that stands for a reload makes a second one, which reads the lists
 * again as a reloaded window does.
 */

import { createElement, type ReactElement } from "react";
import { onTestFinished } from "vitest";
import { makeTerminals, type Terminals, TerminalsContext } from "../tasks/use-terminal-session.js";

/** A window's terminals, read from session storage now, every session let go as the calling test finishes. */
export function windowTerminals(): Terminals {
  const terminals = makeTerminals();
  onTestFinished(() => terminals.sessions.dispose());
  return terminals;
}

/** `element` drawn in the window `terminals` stands for. */
export function onTerminals(terminals: Terminals, element: ReactElement): ReactElement {
  return createElement(TerminalsContext.Provider, { value: terminals }, element);
}
