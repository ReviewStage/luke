import type { Workspace } from "@luke/features/workspace-wire";
import { useEffect } from "react";

/**
 * window-title.ts -- the window's title, which names the open task and its workspace for Mission Control, the Window menu, and a shared screen.
 *
 * The title bar is drawn over, so the window's title is never on its own
 * frame; it stands where macOS lists the window: Mission Control, ⌘`, the
 * Window menu, and a screen share's window picker. There it says what
 * stands in the window and the workspace it is in: the task on screen,
 * "Teammate invitations — Acme", or the Inbox, "Inbox — Acme"; the workspace
 * alone while nothing is open in it; Settings alone, whose pages are not one
 * workspace's; and Luke while nothing is signed in, whatever a task read
 * before the sign-out still holds, as Electron takes the document's title for
 * the window's.
 */

/** What the window is called, by what it shows: `subject` is what stands in it, `workspace` the one that stands in. */
export function windowTitle(input: {
  readonly signedIn: boolean;
  readonly subject: string | undefined;
  readonly workspace: Pick<Workspace, "name"> | undefined;
}): string {
  if (!input.signedIn) return "Luke";
  if (input.workspace === undefined) return input.subject ?? "Luke";
  return input.subject === undefined
    ? input.workspace.name
    : `${input.subject} — ${input.workspace.name}`;
}

/** Keeps the document's title, and so the window's, on what the window shows. */
export function useWindowTitle(input: Parameters<typeof windowTitle>[0]): void {
  const title = windowTitle(input);
  useEffect(() => {
    document.title = title;
  }, [title]);
}
