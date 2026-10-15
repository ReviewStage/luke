import { PersonaSession } from "@keyframelabs/sdk";
import { LogLevel, setLogLevel } from "livekit-client";
import type { AvatarSessionModule } from "./contract";

/**
 * index.ts -- the avatar session's own bundle: Keyframe's session over LiveKit, set on `window` for the panel to open (`./contract.ts`).
 *
 * Note that LiveKit is held to warnings before any room exists, because a
 * renderer's console becomes Sentry breadcrumbs and LiveKit's chatter at its
 * default level says more about the room than a breadcrumb should.
 */

setLogLevel(LogLevel.warn);

window.lukeAvatarSession = {
  createSession: (options) => new PersonaSession(options),
} satisfies AvatarSessionModule;
