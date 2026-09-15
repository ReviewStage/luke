import { WINDOW_ROLE, type WindowRole } from "#shared/messages/session";

/** The two components a root can mount, one per role, handed in so the choice is testable on its own. */
export interface RoleSurfaces {
  readonly panel: React.ComponentType;
  readonly voice: React.ComponentType;
}

/**
 * The role branch, on its own: the hidden voice window mounts the voice
 * surface and every panel mounts the panel's. The role is main's answer for
 * the window that asked, so there is no third case and nothing here guesses.
 */
export function surfaceFor(role: WindowRole, surfaces: RoleSurfaces): React.JSX.Element {
  const Chosen = role === WINDOW_ROLE.VOICE ? surfaces.voice : surfaces.panel;
  return <Chosen />;
}
