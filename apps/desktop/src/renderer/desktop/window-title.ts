import type { Workspace } from "@luke/features/workspace-wire";
import { useEffect } from "react";

/**
 * window-title.ts -- the window's title, which names the open plan and its workspace for Mission Control, the Window menu, and a shared screen.
 *
 * The title bar is drawn over, so the window's title is never on its own
 * frame; it stands where macOS lists the window: Mission Control, ⌘`, the
 * Window menu, and a screen share's window picker. There it says the open
 * plan and the workspace it is in, "Teammate invitations — Acme", the
 * workspace alone while no plan is open, and Luke while nothing is signed in,
 * as Electron takes the document's title for the window's.
 */

/** What the window is called, by what it shows. */
export function windowTitle(input: {
  readonly signedIn: boolean;
  readonly planName: string | undefined;
  readonly workspace: Pick<Workspace, "name"> | undefined;
}): string {
  if (!input.signedIn || input.workspace === undefined) return input.planName ?? "Luke";
  return input.planName === undefined
    ? input.workspace.name
    : `${input.planName} — ${input.workspace.name}`;
}

/** Keeps the document's title, and so the window's, on what the window shows. */
export function useWindowTitle(input: Parameters<typeof windowTitle>[0]): void {
  const title = windowTitle(input);
  useEffect(() => {
    document.title = title;
  }, [title]);
}
