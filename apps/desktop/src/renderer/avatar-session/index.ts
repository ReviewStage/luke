import { PersonaSession } from "@keyframelabs/sdk";
import type { AvatarSessionModule } from "@luke/ui/avatar-session-contract";
import { LogLevel, setLogLevel } from "livekit-client";

/**
 * index.ts -- the avatar session's own bundle: Keyframe's session over LiveKit, imported by the panel to open (`./contract.ts`).
 *
 * Note that LiveKit is held to warnings before any room exists, because a
 * renderer's console becomes Sentry breadcrumbs and LiveKit's chatter at its
 * default level says more about the room than a breadcrumb should.
 */

setLogLevel(LogLevel.warn);

export const avatarSession: AvatarSessionModule = {
  createSession: (options) => new PersonaSession(options),
};
